import type {
  MediaAsset,
  MediaFolder,
  Playlist,
  PlaylistItem,
  PlaylistPriorityRule,
  PlaylistPriorityRuleAssignment,
  PrismaClient,
} from '@signage/database';
import { naturalCompare, naturalSortBy } from '@signage/shared';
import { computeFolderPaths, expandFolderIds, type FolderNode } from './folders';

/**
 * Shared resolution of playlist content: expands dynamic folder entries into
 * concrete media, applies folder filters, resolves priority rule assignments
 * and applies the playlist's playback order mode where it is deterministic
 * (alphabetical). Used by the sync manifest builder (ready media only) and
 * the dashboard's resolved preview (all media, with warnings).
 */

export interface ResolvedEntry {
  /** Stable playable id: the item id, suffixed per media for folder entries. */
  entryId: string;
  itemId: string;
  media: MediaAsset;
  durationSeconds: number | null;
  /** Raw item-level display overrides (folder entries inherit the entry's). */
  fitMode: PlaylistItem['fitMode'];
  backgroundColor: PlaylistItem['backgroundColor'];
  positionMode: PlaylistItem['positionMode'];
  source: 'item' | 'folder';
  sourceFolderId?: string;
  sourceFolderPath?: string;
}

export interface ResolvedPriorityRule {
  rule: PlaylistPriorityRule;
  /** Deduplicated playable media, in deterministic rotation order. */
  media: MediaAsset[];
}

export interface PlaylistResolution {
  playlist: Playlist;
  items: (PlaylistItem & { mediaAsset: MediaAsset | null; folder: MediaFolder | null })[];
  entries: ResolvedEntry[];
  priorityRules: ResolvedPriorityRule[];
  folderPaths: Map<string, string>;
}

/** A media asset that can actually play on a device right now. */
export function isPlayable(media: MediaAsset): boolean {
  return (
    media.deletedAt == null &&
    media.processingStatus === 'ready' &&
    media.checksumSha256 != null &&
    media.processedStorageKey != null
  );
}

function matchesFilters(media: MediaAsset, item: PlaylistItem): boolean {
  if (item.filterMediaType && media.mediaType !== item.filterMediaType) return false;
  if (item.filterOrientation && media.orientation !== item.filterOrientation) return false;
  return true;
}

/**
 * Expands playlist items into resolved entries (pure part). `mediaPool` must
 * contain every non-deleted media asset of the folders referenced by folder
 * entries; direct items carry their own mediaAsset relation.
 */
export function expandPlaylistItems(
  items: (PlaylistItem & { mediaAsset: MediaAsset | null })[],
  folders: FolderNode[],
  mediaPool: MediaAsset[],
  folderPaths: Map<string, string>,
): ResolvedEntry[] {
  const mediaByFolder = new Map<string, MediaAsset[]>();
  for (const media of mediaPool) {
    if (media.deletedAt) continue;
    const key = media.folderId ?? '';
    const list = mediaByFolder.get(key) ?? [];
    list.push(media);
    mediaByFolder.set(key, list);
  }

  const entries: ResolvedEntry[] = [];
  for (const item of [...items].sort((a, b) => a.position - b.position)) {
    if (!item.enabled) continue;

    if (item.type === 'media') {
      if (!item.mediaAsset || item.mediaAsset.deletedAt) continue;
      entries.push({
        entryId: item.id,
        itemId: item.id,
        media: item.mediaAsset,
        durationSeconds: item.durationSeconds,
        fitMode: item.fitMode,
        backgroundColor: item.backgroundColor,
        positionMode: item.positionMode,
        source: 'item',
      });
      continue;
    }

    if (!item.folderId) continue;
    const folderIds = expandFolderIds(folders, item.folderId, item.includeSubfolders);
    const folderMedia: MediaAsset[] = [];
    for (const folderId of folderIds) {
      for (const media of mediaByFolder.get(folderId) ?? []) {
        if (matchesFilters(media, item)) folderMedia.push(media);
      }
    }
    // Folder entries expand alphabetically (natural sort) at their position.
    folderMedia.sort((a, b) => naturalCompare(a.name, b.name) || a.id.localeCompare(b.id));
    for (const media of folderMedia) {
      entries.push({
        entryId: `${item.id}:${media.id}`,
        itemId: item.id,
        media,
        durationSeconds: item.durationSeconds,
        fitMode: item.fitMode,
        backgroundColor: item.backgroundColor,
        positionMode: item.positionMode,
        source: 'folder',
        sourceFolderId: item.folderId,
        sourceFolderPath: folderPaths.get(item.folderId) ?? undefined,
      });
    }
  }
  return entries;
}

/** Resolves priority rule assignments to a deduplicated, ordered media list. */
export function resolvePriorityRuleMedia(
  assignments: (PlaylistPriorityRuleAssignment & { mediaAsset: MediaAsset | null })[],
  folders: FolderNode[],
  mediaPool: MediaAsset[],
): MediaAsset[] {
  const mediaByFolder = new Map<string, MediaAsset[]>();
  for (const media of mediaPool) {
    if (media.deletedAt) continue;
    const key = media.folderId ?? '';
    const list = mediaByFolder.get(key) ?? [];
    list.push(media);
    mediaByFolder.set(key, list);
  }

  const result: MediaAsset[] = [];
  const seen = new Set<string>();
  const push = (media: MediaAsset) => {
    if (media.deletedAt || seen.has(media.id)) return;
    seen.add(media.id);
    result.push(media);
  };

  // Assignment creation order defines the rotation order; folder assignments
  // expand alphabetically in place.
  for (const assignment of [...assignments].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  )) {
    if (assignment.mediaAssetId) {
      if (assignment.mediaAsset) push(assignment.mediaAsset);
      continue;
    }
    if (!assignment.folderId) continue;
    const folderIds = expandFolderIds(folders, assignment.folderId, assignment.includeSubfolders);
    const folderMedia: MediaAsset[] = [];
    for (const folderId of folderIds) folderMedia.push(...(mediaByFolder.get(folderId) ?? []));
    for (const media of naturalSortBy(folderMedia, (m) => m.name)) push(media);
  }
  return result;
}

/** Applies the playlist's order mode where deterministic (alphabetical). */
export function applyOrderMode(
  entries: ResolvedEntry[],
  mode: Playlist['playbackOrderMode'],
): ResolvedEntry[] {
  if (mode === 'alphabetical') {
    return [...entries].sort(
      (a, b) => naturalCompare(a.media.name, b.media.name) || a.entryId.localeCompare(b.entryId),
    );
  }
  // manual_order keeps expansion order; random modes shuffle on the device.
  return entries;
}

/**
 * Loads a playlist and resolves its dynamic content from the database.
 * Returns null when the playlist does not exist (or is deleted).
 */
export async function resolvePlaylist(
  prisma: PrismaClient,
  organizationId: string,
  playlistId: string,
): Promise<PlaylistResolution | null> {
  const playlist = await prisma.playlist.findFirst({
    where: { id: playlistId, organizationId, deletedAt: null },
    include: {
      items: { orderBy: { position: 'asc' }, include: { mediaAsset: true, folder: true } },
      priorityRules: {
        where: { deletedAt: null },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        include: { assignments: { include: { mediaAsset: true } } },
      },
    },
  });
  if (!playlist) return null;

  const folders: FolderNode[] = await prisma.mediaFolder.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, parentFolderId: true, name: true },
  });
  const folderPaths = computeFolderPaths(folders);

  // Collect every folder id any folder entry / folder assignment can reach,
  // then load that media in one query.
  const wantedFolderIds = new Set<string>();
  for (const item of playlist.items) {
    if (item.type === 'folder' && item.folderId && item.enabled) {
      for (const id of expandFolderIds(folders, item.folderId, item.includeSubfolders)) {
        wantedFolderIds.add(id);
      }
    }
  }
  for (const rule of playlist.priorityRules) {
    for (const assignment of rule.assignments) {
      if (assignment.folderId) {
        for (const id of expandFolderIds(
          folders,
          assignment.folderId,
          assignment.includeSubfolders,
        )) {
          wantedFolderIds.add(id);
        }
      }
    }
  }

  const mediaPool =
    wantedFolderIds.size > 0
      ? await prisma.mediaAsset.findMany({
          where: { organizationId, deletedAt: null, folderId: { in: [...wantedFolderIds] } },
        })
      : [];

  const entries = applyOrderMode(
    expandPlaylistItems(playlist.items, folders, mediaPool, folderPaths),
    playlist.playbackOrderMode,
  );

  const priorityRules: ResolvedPriorityRule[] = playlist.priorityRules.map((rule) => ({
    rule,
    media: resolvePriorityRuleMedia(rule.assignments, folders, mediaPool),
  }));

  return { playlist, items: playlist.items, entries, priorityRules, folderPaths };
}
