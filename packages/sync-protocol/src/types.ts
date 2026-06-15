import type {
  DeviceOrientation,
  FitMode,
  MediaOrientation,
  MediaType,
  PlaybackOrderMode,
  PositionMode,
  PrioritySelectionMode,
} from '@signage/shared';

export interface ManifestDeviceSettings {
  name: string;
  orientation: DeviceOrientation;
  timezone: string;
  defaultPlaylistId: string | null;
}

export interface ManifestSchedule {
  id: string;
  playlistId: string;
  enabled: boolean;
  priority: number;
  startDate: string | null;
  endDate: string | null;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  timezone: string | null;
  createdAt: string;
  name: string;
}

export interface ManifestPlaylistItem {
  id: string;
  mediaId: string;
  position: number;
  /** null = natural duration for video / playlist default for image. */
  durationSeconds: number | null;
  /**
   * Resolved (effective) display settings — the backend applies item → playlist
   * default → platform precedence at sync time so devices render correctly
   * offline. `fitMode` may be null only in pre-display manifests (→ contain).
   */
  fitMode: FitMode | null;
  backgroundColor?: string | null;
  positionMode?: PositionMode | null;
  enabled: boolean;
  /**
   * Where this entry came from. Dynamic folder entries are resolved into
   * concrete media at sync time so devices never need folder data offline.
   * Absent/'item' = direct playlist item (v1 compatible).
   */
  source?: 'item' | 'folder';
  /** Folder metadata for display/debugging when source = 'folder'. */
  sourceFolderId?: string;
  sourceFolderPath?: string;
}

export interface ManifestPriorityRule {
  id: string;
  name: string;
  /** One rule item plays after every `intervalCount` normal items. */
  intervalCount: number;
  selectionMode: PrioritySelectionMode;
  /** Manual order of the rule (deterministic tie-breaking). */
  position: number;
  createdAt: string;
  /** Assignments resolved to concrete, ready media ids at sync time. */
  mediaIds: string[];
}

export interface ManifestPlaylist {
  id: string;
  name: string;
  loop: boolean;
  defaultImageDurationSeconds: number;
  /** Absent (v1 backends) = manual_order. */
  playbackOrderMode?: PlaybackOrderMode;
  /** Display defaults; used by the device for priority-rule items (which have no per-item display). */
  defaultFitMode?: FitMode | null;
  defaultBackgroundColor?: string | null;
  defaultPositionMode?: PositionMode | null;
  items: ManifestPlaylistItem[];
  /** Active only when playbackOrderMode is random_with_priority_rules. */
  priorityRules?: ManifestPriorityRule[];
}

export interface ManifestMedia {
  id: string;
  name: string;
  type: MediaType;
  mimeType: string;
  /** sha256 of the processed file the device should download. */
  checksum: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  orientation: MediaOrientation | null;
  durationSeconds: number | null;
  /** Path relative to the backend base URL; device adds its auth token. */
  downloadPath: string;
}

export interface ManifestEmergency {
  active: boolean;
  playlistId: string | null;
  mediaAssetId: string | null;
  startedAt: string | null;
  /** Display settings for a single-media override (resolved; optional). */
  fitMode?: FitMode | null;
  backgroundColor?: string | null;
  positionMode?: PositionMode | null;
}

export interface SyncManifest {
  /** Protocol version for forward compatibility. */
  protocolVersion: number;
  /** Content hash; identical content always yields the identical version. */
  version: string;
  generatedAt: string;
  deviceId: string;
  settings: ManifestDeviceSettings;
  emergency: ManifestEmergency;
  schedules: ManifestSchedule[];
  playlists: ManifestPlaylist[];
  media: ManifestMedia[];
}

export interface CachedMediaEntry {
  mediaId: string;
  checksum: string;
  sizeBytes: number;
}

export interface ManifestDiff {
  /** Media present in the manifest but missing or stale in the cache. */
  toDownload: ManifestMedia[];
  /** Cached media ids no longer referenced by the manifest. */
  toDelete: string[];
  /** Media already cached with matching checksums. */
  unchanged: ManifestMedia[];
}

export interface SyncRequestInfo {
  manifestVersion: string | null;
  appVersion: string;
  cachedChecksums: Record<string, string>;
  freeDiskBytes: number | null;
  orientation: DeviceOrientation;
  timezone: string;
  capabilities: string[];
}
