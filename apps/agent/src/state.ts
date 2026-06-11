import { resolveActiveContent } from '@signage/scheduler';
import type { PlayerState, PlayerStateItem } from '@signage/shared';
import { canonicalJson, type SyncManifest } from '@signage/sync-protocol';

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
      items: [],
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
        items: [item],
        statusMessage: null,
      };
    }
    return {
      ...base,
      playlistId: null,
      playlistName: 'Emergency override',
      loop: false,
      items: [],
      statusMessage: 'Emergency content is still downloading…',
    };
  }

  if (resolution.playlistId) {
    const playlist = manifest.playlists.find((p) => p.id === resolution.playlistId);
    if (playlist) {
      const items: PlayerStateItem[] = [];
      for (const item of playlist.items) {
        if (!item.enabled) continue;
        const media = mediaById.get(item.mediaId);
        if (!media || !ctx.cachedMediaIds.has(media.id)) continue;
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
      return {
        ...base,
        playlistId: playlist.id,
        playlistName: playlist.name,
        loop: playlist.loop,
        items,
        statusMessage:
          items.length > 0
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
    items: [],
    statusMessage: 'No content scheduled for this screen.',
  };
}

/** Stable fingerprint used to decide whether the player needs a new revision. */
export function stateFingerprint(state: Omit<PlayerState, 'revision'>): string {
  return canonicalJson(state);
}
