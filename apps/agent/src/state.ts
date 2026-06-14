import { resolveActiveContent } from '@signage/scheduler';
import type { PlayerPriorityRule, PlayerState, PlayerStateItem } from '@signage/shared';
import { canonicalJson, type ManifestPlaylist, type SyncManifest } from '@signage/sync-protocol';

export interface StateContext {
  paired: boolean;
  online: boolean;
  cachedMediaIds: Set<string>;
  now?: Date;
}

/**
 * Pure function: manifest + cache + clock -> what the player should show.
 * Runs entirely offline; this is the device-side half of the scheduling
 * contract (the backend uses the same @signage/scheduler resolver).
 *
 * Folder entries and priority rule assignments are already resolved to
 * concrete media by the backend at sync time; alphabetical playlists arrive
 * pre-sorted. The random order modes are passed through for the player to
 * shuffle locally (so a shuffle never causes a state revision).
 */
export function computePlayerState(
  manifest: SyncManifest | null,
  ctx: StateContext,
): Omit<PlayerState, 'revision'> {
  if (!manifest) {
    return {
      deviceName: 'Signage device',
      orientation: 'landscape',
      source: 'none',
      playlistId: null,
      playlistName: null,
      loop: false,
      playbackOrderMode: 'manual_order',
      items: [],
      priorityRules: [],
      statusMessage: ctx.paired
        ? 'Waiting for first content sync…'
        : 'Not paired. Add this screen in the dashboard and configure its pairing code.',
      paired: ctx.paired,
      online: ctx.online,
    };
  }

  const resolution = resolveActiveContent({
    schedules: manifest.schedules,
    emergency: manifest.emergency,
    defaultPlaylistId: manifest.settings.defaultPlaylistId,
    deviceTimezone: manifest.settings.timezone,
    now: ctx.now,
  });

  const mediaById = new Map(manifest.media.map((m) => [m.id, m]));
  const base = {
    deviceName: manifest.settings.name,
    orientation: manifest.settings.orientation,
    source: resolution.source,
    paired: ctx.paired,
    online: ctx.online,
  };

  // Emergency override pointing at a single media asset.
  if (resolution.source === 'emergency' && resolution.mediaAssetId) {
    const media = mediaById.get(resolution.mediaAssetId);
    if (media && ctx.cachedMediaIds.has(media.id)) {
      const item: PlayerStateItem = {
        id: `emergency-${media.id}`,
        mediaId: media.id,
        mediaType: media.type,
        url: `/media/${media.id}`,
        durationSeconds: media.type === 'image' ? 86400 : null,
        fitMode: 'contain',
        width: media.width,
        height: media.height,
        name: media.name,
      };
      return {
        ...base,
        playlistId: null,
        playlistName: 'Emergency override',
        loop: true,
        playbackOrderMode: 'manual_order',
        items: [item],
        priorityRules: [],
        statusMessage: null,
      };
    }
    return {
      ...base,
      playlistId: null,
      playlistName: 'Emergency override',
      loop: false,
      playbackOrderMode: 'manual_order',
      items: [],
      priorityRules: [],
      statusMessage: 'Emergency content is still downloading…',
    };
  }

  if (resolution.playlistId) {
    const playlist = manifest.playlists.find((p) => p.id === resolution.playlistId);
    if (playlist) {
      const items = buildPlaylistItems(playlist, mediaById, ctx.cachedMediaIds);
      const playbackOrderMode = playlist.playbackOrderMode ?? 'manual_order';
      const priorityRules =
        playbackOrderMode === 'random_with_priority_rules'
          ? buildPriorityRules(playlist, mediaById, ctx.cachedMediaIds)
          : [];
      return {
        ...base,
        playlistId: playlist.id,
        playlistName: playlist.name,
        loop: playlist.loop,
        playbackOrderMode,
        items,
        priorityRules,
        statusMessage:
          items.length > 0 || priorityRules.some((r) => r.items.length > 0)
            ? null
            : playlist.items.length > 0
              ? 'Content is still downloading…'
              : 'The active playlist is empty.',
      };
    }
  }

  return {
    ...base,
    playlistId: null,
    playlistName: null,
    loop: false,
    playbackOrderMode: 'manual_order',
    items: [],
    priorityRules: [],
    statusMessage: 'No content scheduled for this screen.',
  };
}

function buildPlaylistItems(
  playlist: ManifestPlaylist,
  mediaById: Map<string, SyncManifest['media'][number]>,
  cachedMediaIds: Set<string>,
): PlayerStateItem[] {
  const items: PlayerStateItem[] = [];
  for (const item of playlist.items) {
    if (!item.enabled) continue;
    const media = mediaById.get(item.mediaId);
    if (!media || !cachedMediaIds.has(media.id)) continue;
    items.push({
      id: item.id,
      mediaId: media.id,
      mediaType: media.type,
      url: `/media/${media.id}`,
      durationSeconds:
        item.durationSeconds ??
        (media.type === 'image' ? playlist.defaultImageDurationSeconds : null),
      fitMode: item.fitMode ?? 'contain',
      width: media.width,
      height: media.height,
      name: media.name,
    });
  }
  return items;
}

function buildPriorityRules(
  playlist: ManifestPlaylist,
  mediaById: Map<string, SyncManifest['media'][number]>,
  cachedMediaIds: Set<string>,
): PlayerPriorityRule[] {
  const rules: PlayerPriorityRule[] = [];
  for (const rule of playlist.priorityRules ?? []) {
    const items: PlayerStateItem[] = [];
    for (const mediaId of rule.mediaIds) {
      const media = mediaById.get(mediaId);
      if (!media || !cachedMediaIds.has(media.id)) continue;
      items.push({
        id: `prio-${rule.id}-${media.id}`,
        mediaId: media.id,
        mediaType: media.type,
        url: `/media/${media.id}`,
        durationSeconds: media.type === 'image' ? playlist.defaultImageDurationSeconds : null,
        fitMode: 'contain',
        width: media.width,
        height: media.height,
        name: media.name,
      });
    }
    // Empty rules are dropped here; the player never has to handle them.
    if (items.length > 0) {
      rules.push({
        id: rule.id,
        name: rule.name,
        intervalCount: rule.intervalCount,
        selectionMode: rule.selectionMode,
        position: rule.position,
        createdAt: rule.createdAt,
        items,
      });
    }
  }
  return rules;
}

/** Stable fingerprint used to decide whether the player needs a new revision. */
export function stateFingerprint(state: Omit<PlayerState, 'revision'>): string {
  return canonicalJson(state);
}
