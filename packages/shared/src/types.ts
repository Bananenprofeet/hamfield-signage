import type {
  CommandStatus,
  CommandType,
  DeviceOrientation,
  FitMode,
  MediaOrientation,
  MediaType,
  OrgRole,
  PlaybackEventType,
  ProcessingStatus,
  SyncStatus,
} from './enums';

export interface UserDto {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface OrganizationDto {
  id: string;
  name: string;
  slug: string;
  role?: OrgRole;
  createdAt: string;
}

export interface OrganizationMemberDto {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: OrgRole;
  createdAt: string;
}

export interface DeviceMetrics {
  uptimeSeconds?: number | null;
  cpuPercent?: number | null;
  memUsedBytes?: number | null;
  memTotalBytes?: number | null;
  diskFreeBytes?: number | null;
  diskTotalBytes?: number | null;
  cacheUsedBytes?: number | null;
  screenWidth?: number | null;
  screenHeight?: number | null;
  networkType?: string | null;
}

export interface DeviceDto {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  orientation: DeviceOrientation;
  timezone: string;
  online: boolean;
  paired: boolean;
  pairingCode: string | null;
  pairingCodeExpiresAt: string | null;
  lastSeenAt: string | null;
  lastIp: string | null;
  appVersion: string | null;
  osInfo: string | null;
  archInfo: string | null;
  syncStatus: SyncStatus;
  lastSyncAt: string | null;
  manifestVersion: string | null;
  currentPlaylistId: string | null;
  currentPlaylistName?: string | null;
  currentMediaId: string | null;
  currentMediaName?: string | null;
  defaultPlaylistId: string | null;
  metrics: DeviceMetrics;
  lastError: string | null;
  groupIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DeviceGroupDto {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  deviceCount: number;
  createdAt: string;
}

export interface MediaAssetDto {
  id: string;
  organizationId: string;
  name: string;
  originalFilename: string;
  mediaType: MediaType;
  originalMimeType: string;
  processedMimeType: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  orientation: MediaOrientation | null;
  processingStatus: ProcessingStatus;
  processingError: string | null;
  sizeBytes: number | null;
  processedSizeBytes: number | null;
  checksumSha256: string | null;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistItemDto {
  id: string;
  playlistId: string;
  mediaAssetId: string;
  position: number;
  durationSeconds: number | null;
  fitMode: FitMode | null;
  enabled: boolean;
  media?: MediaAssetDto;
}

export interface PlaylistDto {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  loop: boolean;
  defaultImageDurationSeconds: number;
  itemCount: number;
  totalDurationSeconds: number | null;
  items?: PlaylistItemDto[];
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleDto {
  id: string;
  organizationId: string;
  name: string;
  playlistId: string;
  playlistName?: string;
  enabled: boolean;
  priority: number;
  /** ISO date (yyyy-MM-dd) or null for open-ended */
  startDate: string | null;
  endDate: string | null;
  /** ISO weekday numbers 1 (Mon) - 7 (Sun); empty = every day */
  daysOfWeek: number[];
  /** "HH:mm" in the schedule/device timezone, or null for all day */
  startTime: string | null;
  endTime: string | null;
  /** IANA zone; null = interpret in each device's own timezone */
  timezone: string | null;
  deviceIds: string[];
  groupIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface EmergencyOverrideDto {
  id: string;
  organizationId: string;
  name: string | null;
  playlistId: string | null;
  mediaAssetId: string | null;
  active: boolean;
  appliesToAll: boolean;
  deviceIds: string[];
  groupIds: string[];
  startedAt: string;
  stoppedAt: string | null;
  createdAt: string;
}

export interface DeviceCommandDto {
  id: string;
  deviceId: string;
  type: CommandType;
  payload: Record<string, unknown>;
  status: CommandStatus;
  result: Record<string, unknown> | null;
  createdAt: string;
  sentAt: string | null;
  ackedAt: string | null;
  completedAt: string | null;
}

export interface DeviceLogDto {
  id: string;
  deviceId: string;
  level: string;
  message: string;
  context: Record<string, unknown> | null;
  loggedAt: string;
}

export interface PlaybackEventDto {
  id: string;
  deviceId: string;
  mediaAssetId: string | null;
  playlistId: string | null;
  eventType: PlaybackEventType;
  detail: Record<string, unknown> | null;
  occurredAt: string;
}

export interface PairResponse {
  deviceId: string;
  deviceToken: string;
  deviceName: string;
  organizationId: string;
  settings: {
    orientation: DeviceOrientation;
    timezone: string;
  };
}

export interface AuthResponse {
  token: string;
  user: UserDto;
  organizations: OrganizationDto[];
}

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
}
