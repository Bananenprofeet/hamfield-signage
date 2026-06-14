import { describe, expect, it } from 'vitest';
import {
  PlaybackQueueEngine,
  comparePriorityRules,
  seededRng,
  type QueueEntry,
  type QueuePriorityRule,
} from './playback-queue';
import { naturalCompare, naturalSortBy } from './natural-sort';

const entries = (...ids: string[]): QueueEntry[] => ids.map((id) => ({ id, mediaId: `m-${id}` }));

function rule(partial: Partial<QueuePriorityRule> & { id: string }): QueuePriorityRule {
  return {
    name: partial.id,
    intervalCount: 2,
    selectionMode: 'rotate',
    position: 0,
    entries: entries(`${partial.id}-1`),
    ...partial,
  };
}

function take(engine: PlaybackQueueEngine, count: number) {
  const results = [];
  for (let i = 0; i < count; i++) {
    const next = engine.next();
    if (!next) break;
    results.push(next);
  }
  return results;
}

describe('natural sort', () => {
  it('sorts numerically and case-insensitively', () => {
    const names = ['file10.jpg', 'File2.jpg', 'file1.jpg', 'apple.png'];
    expect(naturalSortBy(names, (n) => n)).toEqual([
      'apple.png',
      'file1.jpg',
      'File2.jpg',
      'file10.jpg',
    ]);
  });

  it('is deterministic for equal-ranking names', () => {
    expect(naturalCompare('a', 'A')).toBe(naturalCompare('a', 'A'));
    expect(naturalCompare('same', 'same')).toBe(0);
  });
});

describe('random playback', () => {
  it('plays every item exactly once per cycle and reshuffles', () => {
    const pool = entries('a', 'b', 'c', 'd', 'e');
    const engine = new PlaybackQueueEngine({ entries: pool, rng: seededRng(42) });

    const first = take(engine, 5).map((r) => r.entry.id);
    expect([...first].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);

    const second = take(engine, 5).map((r) => r.entry.id);
    expect([...second].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('avoids immediate repeats across cycle boundaries', () => {
    const pool = entries('a', 'b', 'c');
    for (let seed = 1; seed <= 25; seed++) {
      const engine = new PlaybackQueueEngine({ entries: pool, rng: seededRng(seed) });
      const played = take(engine, 30).map((r) => r.entry.mediaId);
      for (let i = 1; i < played.length; i++) {
        expect(played[i]).not.toBe(played[i - 1]);
      }
    }
  });

  it('repeats when only one item exists', () => {
    const engine = new PlaybackQueueEngine({ entries: entries('only'), rng: seededRng(1) });
    expect(take(engine, 3).map((r) => r.entry.id)).toEqual(['only', 'only', 'only']);
  });

  it('avoids repeating the last played media after a restart when possible', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const engine = new PlaybackQueueEngine({
        entries: entries('a', 'b', 'c'),
        rng: seededRng(seed),
        lastPlayedMediaId: 'm-a',
      });
      expect(engine.next()?.entry.mediaId).not.toBe('m-a');
    }
  });

  it('returns null with no content', () => {
    const engine = new PlaybackQueueEngine({ entries: [], rng: seededRng(1) });
    expect(engine.next()).toBeNull();
    expect(engine.hasContent()).toBe(false);
  });
});

describe('priority rules', () => {
  it('inserts one rule item after every X normal items', () => {
    const engine = new PlaybackQueueEngine({
      entries: entries('a', 'b', 'c', 'd', 'e', 'f'),
      priorityRules: [rule({ id: 'sponsor', intervalCount: 5, entries: entries('s1') })],
      rng: seededRng(7),
    });

    const played = take(engine, 12);
    expect(played.map((r) => r.playedAs)).toEqual([
      'normal',
      'normal',
      'normal',
      'normal',
      'normal',
      'priority',
      'normal',
      'normal',
      'normal',
      'normal',
      'normal',
      'priority',
    ]);
    expect(played[5].priorityRuleId).toBe('sponsor');
    expect(played[5].entry.id).toBe('s1');
  });

  it('rotate mode cycles assigned items in order', () => {
    const engine = new PlaybackQueueEngine({
      entries: entries('a', 'b'),
      priorityRules: [rule({ id: 'r', intervalCount: 2, entries: entries('s1', 's2', 's3') })],
      rng: seededRng(3),
    });
    const priorityPlays = take(engine, 18)
      .filter((r) => r.playedAs === 'priority')
      .map((r) => r.entry.id);
    expect(priorityPlays).toEqual(['s1', 's2', 's3', 's1', 's2', 's3']);
  });

  it('random mode picks from assigned items without immediate rule repeats', () => {
    const ruleEntries = entries('s1', 's2', 's3');
    const engine = new PlaybackQueueEngine({
      entries: entries('a', 'b'),
      priorityRules: [
        rule({ id: 'r', intervalCount: 1, selectionMode: 'random', entries: ruleEntries }),
      ],
      rng: seededRng(11),
    });
    const priorityPlays = take(engine, 40)
      .filter((r) => r.playedAs === 'priority')
      .map((r) => r.entry.id);
    expect(priorityPlays.length).toBe(20);
    for (const id of priorityPlays) expect(['s1', 's2', 's3']).toContain(id);
    for (let i = 1; i < priorityPlays.length; i++) {
      expect(priorityPlays[i]).not.toBe(priorityPlays[i - 1]);
    }
  });

  it('handles multiple rules; simultaneous triggers are deterministic', () => {
    const engine = new PlaybackQueueEngine({
      entries: entries('a', 'b', 'c', 'd', 'e', 'f', 'g'),
      priorityRules: [
        rule({ id: 'slow', intervalCount: 6, position: 0, entries: entries('slow1') }),
        rule({ id: 'fast', intervalCount: 3, position: 1, entries: entries('fast1') }),
      ],
      rng: seededRng(5),
    });

    const played = take(engine, 12);
    // After 3 normals: fast triggers. After 6 normals: both -> lowest interval first.
    expect(played[3].priorityRuleId).toBe('fast');
    expect(played[3].playedAs).toBe('priority');
    expect(played[7].priorityRuleId).toBe('fast');
    expect(played[8].priorityRuleId).toBe('slow');
  });

  it('does not starve normal content: pool items still all play each cycle', () => {
    const engine = new PlaybackQueueEngine({
      entries: entries('a', 'b', 'c'),
      priorityRules: [rule({ id: 'r', intervalCount: 1, entries: entries('s1', 's2') })],
      rng: seededRng(9),
    });
    const normals = take(engine, 12)
      .filter((r) => r.playedAs === 'normal')
      .map((r) => r.entry.id);
    expect([...normals.slice(0, 3)].sort()).toEqual(['a', 'b', 'c']);
    expect([...normals.slice(3, 6)].sort()).toEqual(['a', 'b', 'c']);
  });

  it('ignores empty and zero-interval rules', () => {
    const engine = new PlaybackQueueEngine({
      entries: entries('a', 'b'),
      priorityRules: [
        rule({ id: 'empty', intervalCount: 1, entries: [] }),
        rule({ id: 'zero', intervalCount: 0 }),
      ],
      rng: seededRng(2),
    });
    expect(take(engine, 6).every((r) => r.playedAs === 'normal')).toBe(true);
  });

  it('plays rule content when the normal pool is empty', () => {
    const engine = new PlaybackQueueEngine({
      entries: [],
      priorityRules: [rule({ id: 'r', intervalCount: 5, entries: entries('s1', 's2') })],
      rng: seededRng(4),
    });
    expect(engine.hasContent()).toBe(true);
    expect(take(engine, 4).map((r) => r.entry.id)).toEqual(['s1', 's2', 's1', 's2']);
  });
});

describe('comparePriorityRules', () => {
  it('orders by interval, then position, then createdAt, then id', () => {
    const rules: QueuePriorityRule[] = [
      rule({ id: 'd', intervalCount: 5, position: 1, createdAt: '2026-01-02' }),
      rule({ id: 'c', intervalCount: 5, position: 1, createdAt: '2026-01-01' }),
      rule({ id: 'b', intervalCount: 5, position: 0 }),
      rule({ id: 'a', intervalCount: 2, position: 9 }),
    ];
    expect([...rules].sort(comparePriorityRules).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
