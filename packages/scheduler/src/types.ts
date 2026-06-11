export interface SchedulerSchedule {
  id: string;
  playlistId: string;
  enabled: boolean;
  /** Higher wins. */
  priority: number;
  /** Inclusive ISO date (yyyy-MM-dd), interpreted in the effective timezone. */
  startDate: string | null;
  /** Inclusive ISO date (yyyy-MM-dd). */
  endDate: string | null;
  /** ISO weekday numbers, 1 = Monday ... 7 = Sunday. Empty = every day. */
  daysOfWeek: number[];
  /** Wall-clock "HH:mm". null = all day. */
  startTime: string | null;
  /** Wall-clock "HH:mm". May be earlier than startTime for overnight windows. */
  endTime: string | null;
  /** IANA timezone. null = interpret in the device's timezone. */
  timezone: string | null;
  /** ISO timestamp used to break priority ties (newer wins). */
  createdAt?: string;
}

export interface SchedulerEmergency {
  active: boolean;
  playlistId: string | null;
  mediaAssetId: string | null;
}

export interface ResolveInput {
  schedules: SchedulerSchedule[];
  emergency?: SchedulerEmergency | null;
  /** Fallback playlist when no schedule matches. */
  defaultPlaylistId?: string | null;
  deviceTimezone: string;
  now?: Date;
}

export type ResolutionSource = 'emergency' | 'schedule' | 'default' | 'none';

export interface Resolution {
  source: ResolutionSource;
  playlistId: string | null;
  /** Set when an emergency override targets a single media asset. */
  mediaAssetId: string | null;
  scheduleId: string | null;
  /** All matching schedule ids in precedence order (winner first). */
  matchedScheduleIds: string[];
}
