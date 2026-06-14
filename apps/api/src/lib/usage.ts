import type { MediaAsset, PrismaClient } from '@signage/database';
import type { FolderUsageDto, MediaUsageDto, UsageRef } from '@signage/shared';
import { collectDescendantIds, expandFolderIds, loadFolders } from './folders';

/**
 * Usage lookups backing the safe-delete warnings. These intentionally
 * over-approximate slightly (e.g. a folder entry whose filters exclude a
 * media item today may include it after a reprocess), because a warning too
 * many is better than silently breaking live signage.
 */

/** Devices that play any of the given playlists (schedules, groups, defaults). */
async function affectedDeviceCount(
  prisma: PrismaClient,
  organizationId: string,
  playlistIds: string[],
): Promise<number> {
  if (playlistIds.length === 0) return 0;
  const schedules = await prisma.schedule.findMany({
    where: {
      organizationId,
      deletedAt: null,
      enabled: true,
      playlistId: { in: playlistIds },
    },
    include: { deviceAssignments: true, groupAssignments: true },
  });
  const deviceIds = new Set<string>();
  const groupIds = new Set<string>();
  for (const schedule of schedules) {
    for (const assignment of schedule.deviceAssignments) deviceIds.add(assignment.deviceId);
    for (const assignment of schedule.groupAssignments) groupIds.add(assignment.groupId);
  }
  if (groupIds.size > 0) {
    const memberships = await prisma.deviceGroupMembership.findMany({
      where: { groupId: { in: [...groupIds] } },
      select: { deviceId: true },
    });
    for (const membership of memberships) deviceIds.add(membership.deviceId);
  }
  const defaults = await prisma.device.findMany({
    where: { organizationId, deletedAt: null, defaultPlaylistId: { in: playlistIds } },
    select: { id: true },
  });
  for (const device of defaults) deviceIds.add(device.id);
  return deviceIds.size;
}

async function activeSchedulesFor(
  prisma: PrismaClient,
  organizationId: string,
  playlistIds: string[],
): Promise<UsageRef[]> {
  if (playlistIds.length === 0) return [];
  const schedules = await prisma.schedule.findMany({
    where: { organizationId, deletedAt: null, enabled: true, playlistId: { in: playlistIds } },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  return schedules;
}

export async function computeMediaUsage(
  prisma: PrismaClient,
  media: MediaAsset,
): Promise<MediaUsageDto> {
  const organizationId = media.organizationId;

  const directItems = await prisma.playlistItem.findMany({
    where: { mediaAssetId: media.id, playlist: { deletedAt: null } },
    include: { playlist: { select: { id: true, name: true } } },
  });
  const directPlaylists = dedupeRefs(directItems.map((i) => i.playlist));

  // Folder entries that currently include this media (folder reach + filters).
  const folderPlaylists: UsageRef[] = [];
  if (media.folderId) {
    const folders = await loadFolders(prisma, organizationId);
    const folderItems = await prisma.playlistItem.findMany({
      where: {
        type: 'folder',
        folderId: { not: null },
        playlist: { organizationId, deletedAt: null },
      },
      include: { playlist: { select: { id: true, name: true } } },
    });
    for (const item of folderItems) {
      const reach = expandFolderIds(folders, item.folderId!, item.includeSubfolders);
      if (!reach.includes(media.folderId)) continue;
      if (item.filterMediaType && item.filterMediaType !== media.mediaType) continue;
      if (item.filterOrientation && media.orientation !== item.filterOrientation) continue;
      folderPlaylists.push(item.playlist);
    }
  }

  // Priority rules: direct media assignments + folder assignments that reach it.
  const ruleWhere = media.folderId
    ? { OR: [{ mediaAssetId: media.id }, { folderId: { not: null } }] }
    : { mediaAssetId: media.id };
  const assignments = await prisma.playlistPriorityRuleAssignment.findMany({
    where: { organizationId, ...ruleWhere },
    include: {
      priorityRule: {
        include: { playlist: { select: { id: true, name: true, deletedAt: true } } },
      },
    },
  });
  const folders = media.folderId ? await loadFolders(prisma, organizationId) : [];
  const priorityRules: MediaUsageDto['priorityRules'] = [];
  const seenRules = new Set<string>();
  for (const assignment of assignments) {
    const rule = assignment.priorityRule;
    if (rule.deletedAt || rule.playlist.deletedAt || seenRules.has(rule.id)) continue;
    const matches =
      assignment.mediaAssetId === media.id ||
      (assignment.folderId != null &&
        media.folderId != null &&
        expandFolderIds(folders, assignment.folderId, assignment.includeSubfolders).includes(
          media.folderId,
        ));
    if (!matches) continue;
    seenRules.add(rule.id);
    priorityRules.push({
      id: rule.id,
      name: rule.name,
      playlistId: rule.playlist.id,
      playlistName: rule.playlist.name,
    });
  }

  const allPlaylistIds = [
    ...new Set([
      ...directPlaylists.map((p) => p.id),
      ...folderPlaylists.map((p) => p.id),
      ...priorityRules.map((r) => r.playlistId),
    ]),
  ];

  const [activeSchedules, deviceCount, playCount] = await Promise.all([
    activeSchedulesFor(prisma, organizationId, allPlaylistIds),
    affectedDeviceCount(prisma, organizationId, allPlaylistIds),
    prisma.playbackEvent.count({ where: { mediaAssetId: media.id, eventType: 'start' } }),
  ]);

  return {
    directPlaylists,
    folderPlaylists: dedupeRefs(folderPlaylists),
    priorityRules,
    activeSchedules,
    affectedDeviceCount: deviceCount,
    playCount,
  };
}

export async function computeFolderUsage(
  prisma: PrismaClient,
  organizationId: string,
  folderId: string,
): Promise<FolderUsageDto & { descendantIds: string[] }> {
  const folders = await loadFolders(prisma, organizationId);
  const descendantIds = collectDescendantIds(folders, folderId);

  const [mediaCount, mediaInside] = await Promise.all([
    prisma.mediaAsset.count({
      where: { organizationId, deletedAt: null, folderId: { in: descendantIds } },
    }),
    prisma.mediaAsset.findMany({
      where: { organizationId, deletedAt: null, folderId: { in: descendantIds } },
      select: { id: true },
    }),
  ]);
  const mediaIds = mediaInside.map((m) => m.id);

  // Folder entries anywhere in the org whose reach intersects this subtree.
  const folderItems = await prisma.playlistItem.findMany({
    where: {
      type: 'folder',
      folderId: { not: null },
      playlist: { organizationId, deletedAt: null },
    },
    include: { playlist: { select: { id: true, name: true } } },
  });
  const directPlaylistRefs: UsageRef[] = [];
  for (const item of folderItems) {
    const reach = expandFolderIds(folders, item.folderId!, item.includeSubfolders);
    if (reach.some((id) => descendantIds.includes(id))) directPlaylistRefs.push(item.playlist);
  }

  // Direct media items pointing at media stored inside the subtree.
  const mediaItems =
    mediaIds.length > 0
      ? await prisma.playlistItem.findMany({
          where: { mediaAssetId: { in: mediaIds }, playlist: { deletedAt: null } },
          include: { playlist: { select: { id: true, name: true } } },
        })
      : [];
  const mediaPlaylistRefs = dedupeRefs(mediaItems.map((i) => i.playlist));

  // Priority rule assignments referencing the subtree (folder or media inside).
  const assignments = await prisma.playlistPriorityRuleAssignment.findMany({
    where: {
      organizationId,
      OR: [
        { folderId: { not: null } },
        ...(mediaIds.length > 0 ? [{ mediaAssetId: { in: mediaIds } }] : []),
      ],
    },
    include: {
      priorityRule: {
        include: { playlist: { select: { id: true, name: true, deletedAt: true } } },
      },
    },
  });
  const priorityRuleRefs: FolderUsageDto['priorityRuleRefs'] = [];
  const seenRules = new Set<string>();
  for (const assignment of assignments) {
    const rule = assignment.priorityRule;
    if (rule.deletedAt || rule.playlist.deletedAt || seenRules.has(rule.id)) continue;
    const matches = assignment.mediaAssetId
      ? mediaIds.includes(assignment.mediaAssetId)
      : expandFolderIds(folders, assignment.folderId!, assignment.includeSubfolders).some((id) =>
          descendantIds.includes(id),
        );
    if (!matches) continue;
    seenRules.add(rule.id);
    priorityRuleRefs.push({
      id: rule.id,
      name: rule.name,
      playlistId: rule.playlist.id,
      playlistName: rule.playlist.name,
    });
  }

  const allPlaylistIds = [
    ...new Set([
      ...directPlaylistRefs.map((p) => p.id),
      ...mediaPlaylistRefs.map((p) => p.id),
      ...priorityRuleRefs.map((r) => r.playlistId),
    ]),
  ];
  const [activeSchedules, deviceCount] = await Promise.all([
    activeSchedulesFor(prisma, organizationId, allPlaylistIds),
    affectedDeviceCount(prisma, organizationId, allPlaylistIds),
  ]);

  return {
    mediaCount,
    subfolderCount: descendantIds.length - 1,
    directPlaylistRefs: dedupeRefs(directPlaylistRefs),
    mediaPlaylistRefs,
    priorityRuleRefs,
    activeSchedules,
    affectedDeviceCount: deviceCount,
    descendantIds,
  };
}

function dedupeRefs(refs: UsageRef[]): UsageRef[] {
  const seen = new Map<string, UsageRef>();
  for (const ref of refs) if (!seen.has(ref.id)) seen.set(ref.id, ref);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
