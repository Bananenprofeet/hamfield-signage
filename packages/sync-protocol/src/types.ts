import type { DeviceOrientation, FitMode, MediaOrientation, MediaType } from '@signage/shared';

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
  fitMode: FitMode | null;
  enabled: boolean;
}

export interface ManifestPlaylist {
  id: string;
  name: string;
  loop: boolean;
  defaultImageDurationSeconds: number;
  items: ManifestPlaylistItem[];
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
