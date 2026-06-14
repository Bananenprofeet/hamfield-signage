import type { PlayedAs, PrioritySelectionMode } from './enums';

/**
 * Offline playback queue for the random order modes. The pool and the
 * priority rules are already resolved (folders expanded, unavailable media
 * removed) by the time this engine runs — on devices that happens at sync
 * time on the backend, in the dashboard preview it happens in the preview
 * endpoint. The engine itself is pure and runs identically in the kiosk
 * player, in tests and in preview sampling (with a seeded RNG).
 */

export interface QueueEntry {
  /** Unique id of the playable entry (playlist item id or synthetic id). */
  id: string;
  mediaId: string;
}

export interface QueuePriorityRule {
  id: string;
  name: string;
  /** One rule item plays after every `intervalCount` normal items. */
  intervalCount: number;
  selectionMode: PrioritySelectionMode;
  /** Manual order of the rule inside the playlist (tie-breaker). */
  position: number;
  /** ISO timestamp, used as a deterministic tie-breaker. */
  createdAt?: string;
  entries: QueueEntry[];
}

export interface QueueOptions {
  entries: QueueEntry[];
  priorityRules?: QueuePriorityRule[];
  /** Returns [0, 1); injectable for deterministic tests and previews. */
  rng?: () => number;
  /** Media id played before this engine existed (reboot recovery). */
  lastPlayedMediaId?: string | null;
}

export interface QueueResult {
  entry: QueueEntry;
  playedAs: PlayedAs;
  priorityRuleId?: string;
  priorityRuleName?: string;
}

/**
 * Deterministic order for rules that trigger at the same time:
 * lowest interval first, then rule position, then creation time, then id.
 */
export function comparePriorityRules(a: QueuePriorityRule, b: QueuePriorityRule): number {
  if (a.intervalCount !== b.intervalCount) return a.intervalCount - b.intervalCount;
  if (a.position !== b.position) return a.position - b.position;
  const createdA = a.createdAt ?? '';
  const createdB = b.createdAt ?? '';
  if (createdA !== createdB) return createdA < createdB ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

interface RuleState {
  rule: QueuePriorityRule;
  normalsSinceLast: number;
  rotateIndex: number;
  lastMediaId: string | null;
}

export class PlaybackQueueEngine {
  private pool: QueueEntry[] = [];
  private cycle: QueueEntry[] = [];
  private cycleIndex = 0;
  private lastMediaId: string | null;
  private rng: () => number;
  private rules: RuleState[];
  /** Rules whose interval elapsed and that still owe a priority item. */
  private pendingRuleIds: string[] = [];

  constructor(options: QueueOptions) {
    this.pool = options.entries.filter((e) => Boolean(e.mediaId));
    this.rng = options.rng ?? Math.random;
    this.lastMediaId = options.lastPlayedMediaId ?? null;
    this.rules = (options.priorityRules ?? [])
      .filter((rule) => rule.intervalCount > 0 && rule.entries.length > 0)
      .sort(comparePriorityRules)
      .map((rule) => ({ rule, normalsSinceLast: 0, rotateIndex: 0, lastMediaId: null }));
    this.reshuffle();
  }

  hasContent(): boolean {
    return this.pool.length > 0 || this.rules.length > 0;
  }

  /** Returns the next item to play, or null when there is nothing playable. */
  next(): QueueResult | null {
    // Serve owed priority items first (deterministic rule order is kept by
    // the order in which ids were queued).
    const pendingRuleId = this.pendingRuleIds.shift();
    if (pendingRuleId) {
      const state = this.rules.find((r) => r.rule.id === pendingRuleId);
      const entry = state ? this.pickRuleEntry(state) : null;
      if (state && entry) {
        state.normalsSinceLast = 0;
        state.lastMediaId = entry.mediaId;
        this.lastMediaId = entry.mediaId;
        return {
          entry,
          playedAs: 'priority',
          priorityRuleId: state.rule.id,
          priorityRuleName: state.rule.name,
        };
      }
      // Rule became unplayable; fall through to normal content.
      return this.next();
    }

    if (this.pool.length === 0) {
      // Priority-only playlist: degrade gracefully by cycling rule content.
      const state = this.rules[0];
      const entry = state ? this.pickRuleEntry(state) : null;
      if (state && entry) {
        this.lastMediaId = entry.mediaId;
        return {
          entry,
          playedAs: 'priority',
          priorityRuleId: state.rule.id,
          priorityRuleName: state.rule.name,
        };
      }
      return null;
    }

    if (this.cycleIndex >= this.cycle.length) this.reshuffle();
    const entry = this.cycle[this.cycleIndex++];
    this.lastMediaId = entry.mediaId;

    // A finished normal item advances every rule counter; rules whose
    // interval elapsed are queued in deterministic order.
    const triggered: RuleState[] = [];
    for (const state of this.rules) {
      state.normalsSinceLast++;
      if (state.normalsSinceLast >= state.rule.intervalCount) triggered.push(state);
    }
    for (const state of triggered) {
      if (!this.pendingRuleIds.includes(state.rule.id)) {
        this.pendingRuleIds.push(state.rule.id);
      }
    }

    return { entry, playedAs: 'normal' };
  }

  private reshuffle(): void {
    this.cycle = shuffle(this.pool, this.rng);
    // Avoid an immediate repeat across the cycle boundary when possible.
    if (this.cycle.length > 1 && this.lastMediaId && this.cycle[0].mediaId === this.lastMediaId) {
      const swap = 1 + Math.floor(this.rng() * (this.cycle.length - 1));
      [this.cycle[0], this.cycle[swap]] = [this.cycle[swap], this.cycle[0]];
    }
    this.cycleIndex = 0;
  }

  private pickRuleEntry(state: RuleState): QueueEntry | null {
    const entries = state.rule.entries;
    if (entries.length === 0) return null;
    if (state.rule.selectionMode === 'rotate') {
      const entry = entries[state.rotateIndex % entries.length];
      state.rotateIndex = (state.rotateIndex + 1) % entries.length;
      return entry;
    }
    // random selection; avoid repeating the rule's previous pick when possible
    if (entries.length === 1) return entries[0];
    let entry = entries[Math.floor(this.rng() * entries.length)];
    if (entry.mediaId === state.lastMediaId || entry.mediaId === this.lastMediaId) {
      const alternatives = entries.filter(
        (e) => e.mediaId !== state.lastMediaId && e.mediaId !== this.lastMediaId,
      );
      if (alternatives.length > 0) {
        entry = alternatives[Math.floor(this.rng() * alternatives.length)];
      }
    }
    return entry;
  }
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Small deterministic RNG (mulberry32) for previews and tests. */
export function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
