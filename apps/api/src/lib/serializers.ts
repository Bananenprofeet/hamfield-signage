import type {
  Device,
  DeviceCommand,
  DeviceGroup,
  DeviceLog,
  EmergencyOverride,
  MediaAsset,
  Organization,
  OrganizationMember,
  Playlist,
  PlaylistItem,
  Schedule,
  User,
} from '@signage/database';
import type {
  DeviceCommandDto,
  DeviceDto,
  DeviceGroupDto,
  DeviceLogDto,
  EmergencyOverrideDto,
  MediaAssetDto,
  OrganizationDto,
  OrganizationMemberDto,
  PlaylistDto,
  PlaylistItemDto,
  ScheduleDto,
  UserDto,
} from '@signage/shared';
import { OFFLINE_THRESHOLD_SECONDS } from '@signage/shared';

const num = (v: bigint | number | null | undefined): number | null =>
  v == null ? null : Number(v);

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function serializeUser(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
  };
}

export function serializeOrg(org: Organization, role?: string): OrganizationDto {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    role: role as OrganizationDto['role'],
    createdAt: org.createdAt.toISOString(),
  };
}

export function serializeMember(
  member: OrganizationMember & { user: User },
): OrganizationMemberDto {
  return {
    id: member.id,
    userId: member.userId,
    email: member.user.email,
    name: member.user.name,
    role: member.role as OrganizationMemberDto['role'],
    createdAt: member.createdAt.toISOString(),
  };
}

export function isDeviceOnline(device: Device): boolean {
  if (!device.lastSeenAt) return false;
  return Date.now() - device.lastSeenAt.getTime() < OFFLINE_THRESHOLD_SECONDS * 1000;
}

export function serializeDevice(
  device: Device & {
    groupMemberships?: { groupId: string }[];
  },
  extras?: { currentPlaylistName?: string | null; currentMediaName?: string | null },
): DeviceDto {
  const pairingValid =
    device.pairingCode != null &&
    device.pairingCodeExpiresAt != null &&
    device.pairingCodeExpiresAt.getTime() > Date.now();
  return {
    id: device.id,
    organizationId: device.organizationId,
    name: device.name,
    description: device.description,
    orientation: device.orientation as DeviceDto['orientation'],
    timezone: device.timezone,
    online: isDeviceOnline(device),
    paired: device.pairedAt != null,
    pairingCode: pairingValid ? device.pairingCode : null,
    pairingCodeExpiresAt: pairingValid ? iso(device.pairingCodeExpiresAt) : null,
    lastSeenAt: iso(device.lastSeenAt),
    lastIp: device.lastIp,
    appVersion: device.appVersion,
    osInfo: device.osInfo,
    archInfo: device.archInfo,
    syncStatus: device.syncStatus as DeviceDto['syncStatus'],
    lastSyncAt: iso(device.lastSyncAt),
    manifestVersion: device.manifestVersion,
    currentPlaylistId: device.currentPlaylistId,
    currentPlaylistName: extras?.currentPlaylistName ?? null,
    currentMediaId: device.currentMediaId,
    currentMediaName: extras?.currentMediaName ?? null,
    defaultPlaylistId: device.defaultPlaylistId,
    metrics: {
      uptimeSeconds: device.uptimeSeconds,
      cpuPercent: device.cpuPercent,
      memUsedBytes: num(device.memUsedBytes),
      memTotalBytes: num(device.memTotalBytes),
      diskFreeBytes: num(device.diskFreeBytes),
      diskTotalBytes: num(device.diskTotalBytes),
      cacheUsedBytes: num(device.cacheUsedBytes),
      screenWidth: device.screenWidth,
      screenHeight: device.screenHeight,
      networkType: device.networkType,
    },
    lastError: device.lastError,
    groupIds: device.groupMemberships?.map((m) => m.groupId) ?? [],
    createdAt: device.createdAt.toISOString(),
    updatedAt: device.updatedAt.toISOString(),
  };
}

export function serializeGroup(
  group: DeviceGroup & { _count?: { memberships: number } },
): DeviceGroupDto {
  return {
    id: group.id,
    organizationId: group.organizationId,
    name: group.name,
    description: group.description,
    deviceCount: group._count?.memberships ?? 0,
    createdAt: group.createdAt.toISOString(),
  };
}

export function serializeMedia(
  media: MediaAsset,
  urls?: { thumbnailUrl?: string | null; previewUrl?: string | null },
): MediaAssetDto {
  return {
    id: media.id,
    organizationId: media.organizationId,
    name: media.name,
    originalFilename: media.originalFilename,
    mediaType: media.mediaType as MediaAssetDto['mediaType'],
    originalMimeType: media.originalMimeType,
    processedMimeType: media.processedMimeType,
    durationSeconds: media.durationSeconds,
    width: media.width,
    height: media.height,
    orientation: media.orientation as MediaAssetDto['orientation'],
    processingStatus: media.processingStatus as MediaAssetDto['processingStatus'],
    processingError: media.processingError,
    sizeBytes: num(media.sizeBytes),
    processedSizeBytes: num(media.processedSizeBytes),
    checksumSha256: media.checksumSha256,
    thumbnailUrl: urls?.thumbnailUrl ?? null,
    previewUrl: urls?.previewUrl ?? null,
    createdAt: media.createdAt.toISOString(),
    updatedAt: media.updatedAt.toISOString(),
  };
}

export function serializePlaylistItem(
  item: PlaylistItem & { mediaAsset?: MediaAsset },
  mediaUrls?: { thumbnailUrl?: string | null },
): PlaylistItemDto {
  return {
    id: item.id,
    playlistId: item.playlistId,
    mediaAssetId: item.mediaAssetId,
    position: item.position,
    durationSeconds: item.durationSeconds,
    fitMode: item.fitMode as PlaylistItemDto['fitMode'],
    enabled: item.enabled,
    media: item.mediaAsset ? serializeMedia(item.mediaAsset, mediaUrls) : undefined,
  };
}

export function playlistTotalDuration(
  items: (PlaylistItem & { mediaAsset?: MediaAsset })[],
  defaultImageDurationSeconds: number,
): number | null {
  let total = 0;
  for (const item of items) {
    if (!item.enabled) continue;
    if (item.durationSeconds != null) {
      total += item.durationSeconds;
    } else if (item.mediaAsset?.mediaType === 'video' && item.mediaAsset.durationSeconds != null) {
      total += item.mediaAsset.durationSeconds;
    } else if (item.mediaAsset?.mediaType === 'image') {
      total += defaultImageDurationSeconds;
    } else {
      return null; // unknown durations involved
    }
  }
  return Math.round(total);
}

export function serializePlaylist(
  playlist: Playlist & {
    items?: (PlaylistItem & { mediaAsset?: MediaAsset })[];
    _count?: { items: number };
  },
  options?: { includeItems?: boolean },
): PlaylistDto {
  const items = playlist.items
    ? [...playlist.items].sort((a, b) => a.position - b.position)
    : undefined;
  return {
    id: playlist.id,
    organizationId: playlist.organizationId,
    name: playlist.name,
    description: playlist.description,
    loop: playlist.loop,
    defaultImageDurationSeconds: playlist.defaultImageDurationSeconds,
    itemCount: playlist._count?.items ?? items?.length ?? 0,
    totalDurationSeconds: items
      ? playlistTotalDuration(items, playlist.defaultImageDurationSeconds)
      : null,
    items: options?.includeItems && items ? items.map((i) => serializePlaylistItem(i)) : undefined,
    createdAt: playlist.createdAt.toISOString(),
    updatedAt: playlist.updatedAt.toISOString(),
  };
}

export function serializeSchedule(
  schedule: Schedule & {
    playlist?: Playlist;
    deviceAssignments?: { deviceId: string }[];
    groupAssignments?: { groupId: string }[];
  },
): ScheduleDto {
  return {
    id: schedule.id,
    organizationId: schedule.organizationId,
    name: schedule.name,
    playlistId: schedule.playlistId,
    playlistName: schedule.playlist?.name,
    enabled: schedule.enabled,
    priority: schedule.priority,
    startDate: schedule.startDate,
    endDate: schedule.endDate,
    daysOfWeek: schedule.daysOfWeek,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    timezone: schedule.timezone,
    deviceIds: schedule.deviceAssignments?.map((a) => a.deviceId) ?? [],
    groupIds: schedule.groupAssignments?.map((a) => a.groupId) ?? [],
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
  };
}

export function serializeEmergency(
  override: EmergencyOverride & {
    devices?: { deviceId: string }[];
    groups?: { groupId: string }[];
  },
): EmergencyOverrideDto {
  return {
    id: override.id,
    organizationId: override.organizationId,
    name: override.name,
    playlistId: override.playlistId,
    mediaAssetId: override.mediaAssetId,
    active: override.active,
    appliesToAll: override.appliesToAll,
    deviceIds: override.devices?.map((d) => d.deviceId) ?? [],
    groupIds: override.groups?.map((g) => g.groupId) ?? [],
    startedAt: override.startedAt.toISOString(),
    stoppedAt: iso(override.stoppedAt),
    createdAt: override.createdAt.toISOString(),
  };
}

export function serializeCommand(command: DeviceCommand): DeviceCommandDto {
  return {
    id: command.id,
    deviceId: command.deviceId,
    type: command.type as DeviceCommandDto['type'],
    payload: (command.payload ?? {}) as Record<string, unknown>,
    status: command.status as DeviceCommandDto['status'],
    result: (command.result ?? null) as Record<string, unknown> | null,
    createdAt: command.createdAt.toISOString(),
    sentAt: iso(command.sentAt),
    ackedAt: iso(command.ackedAt),
    completedAt: iso(command.completedAt),
  };
}

export function serializeDeviceLog(log: DeviceLog): DeviceLogDto {
  return {
    id: log.id,
    deviceId: log.deviceId,
    level: log.level,
    message: log.message,
    context: (log.context ?? null) as Record<string, unknown> | null,
    loggedAt: log.loggedAt.toISOString(),
  };
}
