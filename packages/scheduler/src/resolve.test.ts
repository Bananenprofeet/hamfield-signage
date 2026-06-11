import { describe, expect, it } from 'vitest';
import { resolveActiveContent, scheduleMatchesAt, sortByPrecedence } from './resolve';
import type { SchedulerSchedule } from './types';

function makeSchedule(overrides: Partial<SchedulerSchedule> = {}): SchedulerSchedule {
  return {
    id: 'sched-1',
    playlistId: 'pl-1',
    enabled: true,
    priority: 0,
    startDate: null,
    endDate: null,
    daysOfWeek: [],
    startTime: null,
    endTime: null,
    timezone: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Builds a UTC Date from ISO string. */
const at = (iso: string) => new Date(iso);

describe('scheduleMatchesAt', () => {
  it('always-active schedule matches any time', () => {
    const s = makeSchedule();
    expect(scheduleMatchesAt(s, 'UTC', at('2026-06-15T03:00:00Z'))).toBe(true);
    expect(scheduleMatchesAt(s, 'UTC', at('2026-12-31T23:59:00Z'))).toBe(true);
  });

  it('disabled schedule never matches', () => {
    const s = makeSchedule({ enabled: false });
    expect(scheduleMatchesAt(s, 'UTC', at('2026-06-15T03:00:00Z'))).toBe(false);
  });

  it('respects date ranges inclusively in device timezone', () => {
    const s = makeSchedule({ startDate: '2026-07-01', endDate: '2026-07-31' });
    expect(scheduleMatchesAt(s, 'UTC', at('2026-06-30T23:59:00Z'))).toBe(false);
    expect(scheduleMatchesAt(s, 'UTC', at('2026-07-01T00:00:00Z'))).toBe(true);
    expect(scheduleMatchesAt(s, 'UTC', at('2026-07-31T23:59:00Z'))).toBe(true);
    expect(scheduleMatchesAt(s, 'UTC', at('2026-08-01T00:00:00Z'))).toBe(false);
  });

  it('date range boundary follows the device timezone, not UTC', () => {
    const s = makeSchedule({ startDate: '2026-07-01', endDate: '2026-07-31' });
    // 2026-06-30 23:30 UTC is already 2026-07-01 01:30 in Amsterdam (UTC+2 in summer)
    expect(scheduleMatchesAt(s, 'Europe/Amsterdam', at('2026-06-30T23:30:00Z'))).toBe(true);
    // ...but still 2026-06-30 in UTC
    expect(scheduleMatchesAt(s, 'UTC', at('2026-06-30T23:30:00Z'))).toBe(false);
  });

  it('weekday schedule: Mon-Fri 09:00-17:00 in device timezone', () => {
    const s = makeSchedule({ daysOfWeek: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' });
    // Monday 2026-06-15 10:00 Amsterdam (08:00 UTC)
    expect(scheduleMatchesAt(s, 'Europe/Amsterdam', at('2026-06-15T08:00:00Z'))).toBe(true);
    // Monday 08:59 local: not yet
    expect(scheduleMatchesAt(s, 'Europe/Amsterdam', at('2026-06-15T06:59:00Z'))).toBe(false);
    // Monday 17:00 local: end is exclusive
    expect(scheduleMatchesAt(s, 'Europe/Amsterdam', at('2026-06-15T15:00:00Z'))).toBe(false);
    // Saturday 2026-06-20 10:00 local: wrong day
    expect(scheduleMatchesAt(s, 'Europe/Amsterdam', at('2026-06-20T08:00:00Z'))).toBe(false);
  });

  it('weekend schedule matches Saturday and Sunday', () => {
    const s = makeSchedule({ daysOfWeek: [6, 7] });
    expect(scheduleMatchesAt(s, 'UTC', at('2026-06-20T12:00:00Z'))).toBe(true); // Sat
    expect(scheduleMatchesAt(s, 'UTC', at('2026-06-21T12:00:00Z'))).toBe(true); // Sun
    expect(scheduleMatchesAt(s, 'UTC', at('2026-06-22T12:00:00Z'))).toBe(false); // Mon
  });

  it('overnight window 22:00-02:00 belongs to the day it started', () => {
    // Friday-only overnight schedule
    const s = makeSchedule({ daysOfWeek: [5], startTime: '22:00', endTime: '02:00' });
    // Friday 2026-06-19 23:00 UTC: active
    expect(scheduleMatchesAt(s, 'UTC', at('2026-06-19T23:00:00Z'))).toBe(true);
    // Saturday 01:00 UTC: still active (started Friday)
    expect(scheduleMatchesAt(s, 'UTC', at('2026-06-20T01:00:00Z'))).toBe(true);
    // Saturday 03:00: over
    expect(scheduleMatchesAt(s, 'UTC', at('2026-06-20T03:00:00Z'))).toBe(false);
    // Saturday 23:00: wrong day (schedule is Friday-only)
    expect(scheduleMatchesAt(s, 'UTC', at('2026-06-20T23:00:00Z'))).toBe(false);
    // Friday 21:00: not started yet
    expect(scheduleMatchesAt(s, 'UTC', at('2026-06-19T21:00:00Z'))).toBe(false);
  });

  it('overnight window respects the date range of the starting day', () => {
    const s = makeSchedule({
      startTime: '22:00',
      endTime: '02:00',
      startDate: '2026-06-19',
      endDate: '2026-06-19',
    });
    // June 20 01:00 — window started June 19, in range
    expect(scheduleMatchesAt(s, 'UTC', at('2026-06-20T01:00:00Z'))).toBe(true);
    // June 21 01:00 — window started June 20, out of range
    expect(scheduleMatchesAt(s, 'UTC', at('2026-06-21T01:00:00Z'))).toBe(false);
  });

  it('explicit schedule timezone overrides device timezone', () => {
    const s = makeSchedule({ startTime: '09:00', endTime: '17:00', timezone: 'America/New_York' });
    // 14:00 UTC = 10:00 New York (summer, UTC-4) = matches even though device is UTC
    expect(scheduleMatchesAt(s, 'UTC', at('2026-06-15T14:00:00Z'))).toBe(true);
    // 12:00 UTC = 08:00 New York = no match
    expect(scheduleMatchesAt(s, 'UTC', at('2026-06-15T12:00:00Z'))).toBe(false);
  });

  describe('DST transitions (Europe/Amsterdam)', () => {
    // Spring forward: 2026-03-29, 02:00 -> 03:00 local
    it('schedule still matches on spring-forward day using wall-clock times', () => {
      const s = makeSchedule({ startTime: '09:00', endTime: '17:00' });
      // 2026-03-29 10:00 local = 08:00 UTC (now UTC+2)
      expect(scheduleMatchesAt(s, 'Europe/Amsterdam', at('2026-03-29T08:00:00Z'))).toBe(true);
    });

    it('window spanning the skipped hour still behaves sanely', () => {
      const s = makeSchedule({ startTime: '01:00', endTime: '05:00' });
      // 01:30 local (still UTC+1): inside
      expect(scheduleMatchesAt(s, 'Europe/Amsterdam', at('2026-03-29T00:30:00Z'))).toBe(true);
      // 03:30 local (now UTC+2): inside, even though 02:xx never existed
      expect(scheduleMatchesAt(s, 'Europe/Amsterdam', at('2026-03-29T01:30:00Z'))).toBe(true);
      // 05:30 local: outside
      expect(scheduleMatchesAt(s, 'Europe/Amsterdam', at('2026-03-29T03:30:00Z'))).toBe(false);
    });

    // Fall back: 2026-10-25, 03:00 -> 02:00 local
    it('fall-back day: schedule matches through the repeated hour', () => {
      const s = makeSchedule({ startTime: '02:00', endTime: '04:00' });
      // First 02:30 local (UTC+2): 00:30 UTC
      expect(scheduleMatchesAt(s, 'Europe/Amsterdam', at('2026-10-25T00:30:00Z'))).toBe(true);
      // Second 02:30 local (UTC+1): 01:30 UTC
      expect(scheduleMatchesAt(s, 'Europe/Amsterdam', at('2026-10-25T01:30:00Z'))).toBe(true);
    });
  });
});

describe('sortByPrecedence', () => {
  it('orders by priority desc, then newest createdAt, then id', () => {
    const a = makeSchedule({ id: 'a', priority: 1, createdAt: '2026-01-01T00:00:00Z' });
    const b = makeSchedule({ id: 'b', priority: 5, createdAt: '2026-01-01T00:00:00Z' });
    const c = makeSchedule({ id: 'c', priority: 5, createdAt: '2026-02-01T00:00:00Z' });
    const d = makeSchedule({ id: 'd', priority: 5, createdAt: '2026-02-01T00:00:00Z' });
    expect(sortByPrecedence([a, b, c, d]).map((s) => s.id)).toEqual(['c', 'd', 'b', 'a']);
  });
});

describe('resolveActiveContent', () => {
  it('emergency override always wins', () => {
    const res = resolveActiveContent({
      schedules: [makeSchedule({ priority: 1000 })],
      emergency: { active: true, playlistId: null, mediaAssetId: 'media-emergency' },
      defaultPlaylistId: 'pl-default',
      deviceTimezone: 'UTC',
      now: at('2026-06-15T12:00:00Z'),
    });
    expect(res.source).toBe('emergency');
    expect(res.mediaAssetId).toBe('media-emergency');
    expect(res.playlistId).toBeNull();
  });

  it('highest priority matching schedule wins', () => {
    const low = makeSchedule({ id: 'low', playlistId: 'pl-low', priority: 1 });
    const high = makeSchedule({ id: 'high', playlistId: 'pl-high', priority: 10 });
    const res = resolveActiveContent({
      schedules: [low, high],
      deviceTimezone: 'UTC',
      now: at('2026-06-15T12:00:00Z'),
    });
    expect(res.source).toBe('schedule');
    expect(res.scheduleId).toBe('high');
    expect(res.playlistId).toBe('pl-high');
    expect(res.matchedScheduleIds).toEqual(['high', 'low']);
  });

  it('non-matching high priority schedule is ignored', () => {
    const weekday = makeSchedule({
      id: 'weekday',
      playlistId: 'pl-weekday',
      priority: 10,
      daysOfWeek: [1, 2, 3, 4, 5],
    });
    const always = makeSchedule({ id: 'always', playlistId: 'pl-always', priority: 0 });
    // Saturday
    const res = resolveActiveContent({
      schedules: [weekday, always],
      deviceTimezone: 'UTC',
      now: at('2026-06-20T12:00:00Z'),
    });
    expect(res.scheduleId).toBe('always');
  });

  it('falls back to default playlist when nothing matches', () => {
    const res = resolveActiveContent({
      schedules: [makeSchedule({ daysOfWeek: [1] })],
      defaultPlaylistId: 'pl-default',
      deviceTimezone: 'UTC',
      now: at('2026-06-20T12:00:00Z'), // Saturday
    });
    expect(res.source).toBe('default');
    expect(res.playlistId).toBe('pl-default');
  });

  it('returns none when nothing matches and no default exists', () => {
    const res = resolveActiveContent({
      schedules: [],
      deviceTimezone: 'UTC',
      now: at('2026-06-20T12:00:00Z'),
    });
    expect(res.source).toBe('none');
    expect(res.playlistId).toBeNull();
  });

  it('inactive emergency does not override schedules', () => {
    const res = resolveActiveContent({
      schedules: [makeSchedule()],
      emergency: { active: false, playlistId: 'pl-e', mediaAssetId: null },
      deviceTimezone: 'UTC',
      now: at('2026-06-15T12:00:00Z'),
    });
    expect(res.source).toBe('schedule');
  });
});
