import { DateTime } from 'luxon';
import type { Resolution, ResolveInput, SchedulerSchedule } from './types';

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function dayMatches(schedule: SchedulerSchedule, local: DateTime): boolean {
  if (schedule.daysOfWeek.length === 0) return true;
  return schedule.daysOfWeek.includes(local.weekday);
}

function dateInRange(schedule: SchedulerSchedule, local: DateTime): boolean {
  const dateStr = local.toISODate();
  if (!dateStr) return false;
  if (schedule.startDate && dateStr < schedule.startDate) return false;
  if (schedule.endDate && dateStr > schedule.endDate) return false;
  return true;
}

/**
 * Determines whether a schedule is active at the given instant.
 *
 * Time windows are wall-clock based: "09:00-17:00" means local wall-clock
 * time between 09:00 and 17:00 regardless of DST transitions, which is what
 * signage operators expect. Overnight windows (startTime > endTime, e.g.
 * 22:00-02:00) belong to the day they started: at Saturday 01:00 a
 * Friday-only 22:00-02:00 schedule is still active.
 */
export function scheduleMatchesAt(
  schedule: SchedulerSchedule,
  deviceTimezone: string,
  now: Date,
): boolean {
  if (!schedule.enabled) return false;

  const zone = schedule.timezone ?? deviceTimezone;
  const local = DateTime.fromJSDate(now, { zone });
  if (!local.isValid) return false;

  // All-day schedule (no time window, or degenerate equal start/end = full day).
  const hasWindow =
    schedule.startTime != null &&
    schedule.endTime != null &&
    schedule.startTime !== schedule.endTime;

  if (!hasWindow) {
    return dayMatches(schedule, local) && dateInRange(schedule, local);
  }

  const startMin = parseTimeToMinutes(schedule.startTime as string);
  const endMin = parseTimeToMinutes(schedule.endTime as string);
  const nowMin = local.hour * 60 + local.minute;

  if (startMin < endMin) {
    // Same-day window: [start, end)
    return (
      nowMin >= startMin &&
      nowMin < endMin &&
      dayMatches(schedule, local) &&
      dateInRange(schedule, local)
    );
  }

  // Overnight window, e.g. 22:00 - 02:00.
  // Part 1: tonight's portion (now >= start), attributed to today.
  if (nowMin >= startMin && dayMatches(schedule, local) && dateInRange(schedule, local)) {
    return true;
  }
  // Part 2: this morning's portion (now < end), attributed to yesterday.
  if (nowMin < endMin) {
    const yesterday = local.minus({ days: 1 });
    return dayMatches(schedule, yesterday) && dateInRange(schedule, yesterday);
  }
  return false;
}

/**
 * Sorts matching schedules by precedence: priority desc, then newest
 * createdAt, then id (for full determinism).
 */
export function sortByPrecedence(schedules: SchedulerSchedule[]): SchedulerSchedule[] {
  return [...schedules].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const ca = a.createdAt ?? '';
    const cb = b.createdAt ?? '';
    if (ca !== cb) return cb.localeCompare(ca);
    return a.id.localeCompare(b.id);
  });
}

/**
 * Resolves what a device should be playing right now.
 *
 * Precedence: emergency override > highest-priority matching schedule >
 * device default playlist > nothing.
 *
 * This function is pure and is used both by the backend (sync manifest and
 * dashboard preview) and by the device agent (offline schedule evaluation),
 * guaranteeing identical behavior online and offline.
 */
export function resolveActiveContent(input: ResolveInput): Resolution {
  const now = input.now ?? new Date();

  if (input.emergency?.active) {
    return {
      source: 'emergency',
      playlistId: input.emergency.playlistId ?? null,
      mediaAssetId: input.emergency.mediaAssetId ?? null,
      scheduleId: null,
      matchedScheduleIds: [],
    };
  }

  const matching = sortByPrecedence(
    input.schedules.filter((s) => scheduleMatchesAt(s, input.deviceTimezone, now)),
  );

  if (matching.length > 0) {
    const winner = matching[0];
    return {
      source: 'schedule',
      playlistId: winner.playlistId,
      mediaAssetId: null,
      scheduleId: winner.id,
      matchedScheduleIds: matching.map((s) => s.id),
    };
  }

  if (input.defaultPlaylistId) {
    return {
      source: 'default',
      playlistId: input.defaultPlaylistId,
      mediaAssetId: null,
      scheduleId: null,
      matchedScheduleIds: [],
    };
  }

  return {
    source: 'none',
    playlistId: null,
    mediaAssetId: null,
    scheduleId: null,
    matchedScheduleIds: [],
  };
}
