import type { PrismaClient } from '@signage/database';
import { API_PREFIX, SYNC_PROTOCOL_VERSION } from '@signage/shared';
import {
  computeManifestVersion,
  type ManifestEmergency,
  type ManifestMedia,
  type ManifestPlaylist,
  type ManifestSchedule,
  type SyncManifest,
} from '@signage/sync-protocol';
import { notFound } from './errors';

/**
 * Builds the complete sync manifest for one device: settings, assigned
 * schedules (direct + via groups), referenced playlists, the active emergency
 * override and the media set the device must cache.
 *
 * Only `ready` media with a checksum is included — a playlist item whose
 * media is still processing is silently skipped until it becomes ready.
 */
export async function buildSyncManifest(
  prisma: PrismaClient,
  deviceId: string,
): Promise<SyncManifest> {
  const device = await prisma.device.findFirst({
    where: { id: deviceId, deletedAt: null },
    include: { groupMemberships: true },
  });
  if (!device) throw notFound('Device not found');

  const groupIds = device.groupMemberships.map((m) => m.groupId);

  const schedules = await prisma.schedule.findMany({
    where: {
      organizationId: device.organizationId,
      deletedAt: null,
      enabled: true,
      OR: [
        { deviceAssignments: { some: { deviceId: device.id } } },
        ...(groupIds.length > 0
          ? [{ groupAssignments: { some: { groupId: { in: groupIds } } } }]
          : []),
      ],
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
  });

  const activeOverride = await prisma.emergencyOverride.findFirst({
    where: {
      organizationId: device.organizationId,
      active: true,
      OR: [
        { appliesToAll: true },
        { devices: { some: { deviceId: device.id } } },
        ...(groupIds.length > 0 ? [{ groups: { some: { groupId: { in: groupIds } } } }] : []),
      ],
    },
    orderBy: { startedAt: 'desc' },
  });

  const playlistIds = new Set<string>(schedules.map((s) => s.playlistId));
  if (device.defaultPlaylistId) playlistIds.add(device.defaultPlaylistId);
  if (activeOverride?.playlistId) playlistIds.add(activeOverride.playlistId);

  const playlists = await prisma.playlist.findMany({
    where: { id: { in: [...playlistIds] }, deletedAt: null },
    include: {
      items: {
        where: { enabled: true },
        orderBy: { position: 'asc' },
        include: { mediaAsset: true },
      },
    },
  });
  const existingPlaylistIds = new Set(playlists.map((p) => p.id));

  const mediaMap = new Map<string, ManifestMedia>();
  const manifestPlaylists: ManifestPlaylist[] = [];

  for (const playlist of playlists) {
    const items = playlist.items.filter(
      (item) =>
        item.mediaAsset.deletedAt == null &&
        item.mediaAsset.processingStatus === 'ready' &&
        item.mediaAsset.checksumSha256 != null &&
        item.mediaAsset.processedStorageKey != null,
    );
    manifestPlaylists.push({
      id: playlist.id,
      name: playlist.name,
      loop: playlist.loop,
      defaultImageDurationSeconds: playlist.defaultImageDurationSeconds,
      items: items.map((item) => ({
        id: item.id,
        mediaId: item.mediaAssetId,
        position: item.position,
        durationSeconds: item.durationSeconds,
        fitMode: item.fitMode as ManifestPlaylist['items'][number]['fitMode'],
        enabled: item.enabled,
      })),
    });
    for (const item of items) addMedia(mediaMap, item.mediaAsset);
  }

  // Emergency override targeting a single media asset.
  if (activeOverride?.mediaAssetId) {
    const media = await prisma.mediaAsset.findFirst({
      where: {
        id: activeOverride.mediaAssetId,
        organizationId: device.organizationId,
        deletedAt: null,
        processingStatus: 'ready',
      },
    });
    if (media) addMedia(mediaMap, media);
  }

  const manifestSchedules: ManifestSchedule[] = schedules
    .filter((s) => existingPlaylistIds.has(s.playlistId))
    .map((s) => ({
      id: s.id,
      playlistId: s.playlistId,
      enabled: s.enabled,
      priority: s.priority,
      startDate: s.startDate,
      endDate: s.endDate,
      daysOfWeek: s.daysOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
      timezone: s.timezone,
      createdAt: s.createdAt.toISOString(),
      name: s.name,
    }));

  const emergency: ManifestEmergency = activeOverride
    ? {
        active: true,
        playlistId:
          activeOverride.playlistId && existingPlaylistIds.has(activeOverride.playlistId)
            ? activeOverride.playlistId
            : null,
        mediaAssetId:
          activeOverride.mediaAssetId && mediaMap.has(activeOverride.mediaAssetId)
            ? activeOverride.mediaAssetId
            : null,
        startedAt: activeOverride.startedAt.toISOString(),
      }
    : { active: false, playlistId: null, mediaAssetId: null, startedAt: null };

  const content: Omit<SyncManifest, 'version' | 'generatedAt'> = {
    protocolVersion: SYNC_PROTOCOL_VERSION,
    deviceId: device.id,
    settings: {
      name: device.name,
      orientation: device.orientation as SyncManifest['settings']['orientation'],
      timezone: device.timezone,
      defaultPlaylistId:
        device.defaultPlaylistId && existingPlaylistIds.has(device.defaultPlaylistId)
          ? device.defaultPlaylistId
          : null,
    },
    emergency,
    schedules: manifestSchedules,
    playlists: manifestPlaylists,
    media: [...mediaMap.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };

  return {
    ...content,
    version: computeManifestVersion(content),
    generatedAt: new Date().toISOString(),
  };
}

interface MediaRow {
  id: string;
  name: string;
  mediaType: string;
  processedMimeType: string | null;
  originalMimeType: string;
  checksumSha256: string | null;
  processedSizeBytes: bigint | null;
  sizeBytes: bigint | null;
  width: number | null;
  height: number | null;
  orientation: string | null;
  durationSeconds: number | null;
}

function addMedia(map: Map<string, ManifestMedia>, media: MediaRow): void {
  if (map.has(media.id) || !media.checksumSha256) return;
  map.set(media.id, {
    id: media.id,
    name: media.name,
    type: media.mediaType as ManifestMedia['type'],
    mimeType: media.processedMimeType ?? media.originalMimeType,
    checksum: media.checksumSha256,
    sizeBytes: Number(media.processedSizeBytes ?? media.sizeBytes ?? 0),
    width: media.width,
    height: media.height,
    orientation: media.orientation as ManifestMedia['orientation'],
    durationSeconds: media.durationSeconds,
    downloadPath: `${API_PREFIX}/device/media/${media.id}/file`,
  });
}

/** Returns the set of media ids a device is currently allowed to download. */
export async function allowedMediaIdsForDevice(
  prisma: PrismaClient,
  deviceId: string,
): Promise<Set<string>> {
  const manifest = await buildSyncManifest(prisma, deviceId);
  return new Set(manifest.media.map((m) => m.id));
}
