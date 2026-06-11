import { describe, expect, it } from 'vitest';
import type { SyncManifest } from '@signage/sync-protocol';
import { computePlayerState, stateFingerprint } from './state';

function manifest(overrides: Partial<SyncManifest> = {}): SyncManifest {
  return {
    protocolVersion: 1,
    version: 'v1',
    generatedAt: '2026-01-01T00:00:00.000Z',
    deviceId: 'dev-1',
    settings: {
      name: 'Lobby screen',
      orientation: 'landscape',
      timezone: 'Europe/Amsterdam',
      defaultPlaylistId: 'pl-1',
    },
    emergency: { active: false, playlistId: null, mediaAssetId: null, startedAt: null },
    schedules: [],
    playlists: [
      {
        id: 'pl-1',
        name: 'Default playlist',
        loop: true,
        defaultImageDurationSeconds: 10,
        items: [
          {
            id: 'item-1',
            mediaId: 'img-1',
            position: 0,
            durationSeconds: null,
            fitMode: null,
            enabled: true,
          },
          {
            id: 'item-2',
            mediaId: 'vid-1',
            position: 1,
            durationSeconds: null,
            fitMode: 'cover',
            enabled: true,
          },
          {
            id: 'item-3',
            mediaId: 'img-1',
            position: 2,
            durationSeconds: 5,
            fitMode: null,
            enabled: false,
          },
        ],
      },
    ],
    media: [
      {
        id: 'img-1',
        name: 'Poster',
        type: 'image',
        mimeType: 'image/jpeg',
        checksum: 'a'.repeat(64),
        sizeBytes: 100,
        width: 1920,
        height: 1080,
        orientation: 'landscape',
        durationSeconds: null,
        downloadPath: '/api/v1/device/media/img-1/download',
      },
      {
        id: 'vid-1',
        name: 'Promo video',
        type: 'video',
        mimeType: 'video/mp4',
        checksum: 'b'.repeat(64),
        sizeBytes: 5000,
        width: 1920,
        height: 1080,
        orientation: 'landscape',
        durationSeconds: 30,
        downloadPath: '/api/v1/device/media/vid-1/download',
      },
    ],
    ...overrides,
  };
}

const allCached = new Set(['img-1', 'vid-1']);

describe('computePlayerState', () => {
  it('shows pairing instructions when there is no manifest and no pairing', () => {
    const state = computePlayerState(null, {
      paired: false,
      online: false,
      cachedMediaIds: new Set(),
    });
    expect(state.items).toHaveLength(0);
    expect(state.statusMessage).toMatch(/not paired/i);
  });

  it('shows a waiting message when paired but never synced', () => {
    const state = computePlayerState(null, {
      paired: true,
      online: true,
      cachedMediaIds: new Set(),
    });
    expect(state.statusMessage).toMatch(/first content sync/i);
  });

  it('plays the default playlist with cached, enabled items only', () => {
    const state = computePlayerState(manifest(), {
      paired: true,
      online: true,
      cachedMediaIds: allCached,
    });
    expect(state.source).toBe('default');
    expect(state.playlistId).toBe('pl-1');
    expect(state.loop).toBe(true);
    expect(state.items.map((i) => i.id)).toEqual(['item-1', 'item-2']);
    expect(state.statusMessage).toBeNull();
  });

  it('applies the playlist default duration to images and natural duration to videos', () => {
    const state = computePlayerState(manifest(), {
      paired: true,
      online: true,
      cachedMediaIds: allCached,
    });
    expect(state.items[0].durationSeconds).toBe(10); // image inherits playlist default
    expect(state.items[1].durationSeconds).toBeNull(); // video plays its natural length
    expect(state.items[0].fitMode).toBe('contain'); // platform default fit
    expect(state.items[1].fitMode).toBe('cover'); // explicit per-item override
  });

  it('skips media that is not cached yet and explains why', () => {
    const state = computePlayerState(manifest(), {
      paired: true,
      online: true,
      cachedMediaIds: new Set(['img-1']),
    });
    expect(state.items.map((i) => i.mediaId)).toEqual(['img-1']);

    const nothingCached = computePlayerState(manifest(), {
      paired: true,
      online: true,
      cachedMediaIds: new Set(),
    });
    expect(nothingCached.items).toHaveLength(0);
    expect(nothingCached.statusMessage).toMatch(/downloading/i);
  });

  it('plays a single emergency media asset on loop when cached', () => {
    const m = manifest({
      emergency: {
        active: true,
        playlistId: null,
        mediaAssetId: 'img-1',
        startedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    const state = computePlayerState(m, { paired: true, online: true, cachedMediaIds: allCached });
    expect(state.source).toBe('emergency');
    expect(state.loop).toBe(true);
    expect(state.items).toHaveLength(1);
    expect(state.items[0].mediaId).toBe('img-1');

    const notCached = computePlayerState(m, {
      paired: true,
      online: true,
      cachedMediaIds: new Set(),
    });
    expect(notCached.items).toHaveLength(0);
    expect(notCached.statusMessage).toMatch(/downloading/i);
  });

  it('reports when nothing is scheduled', () => {
    const m = manifest({
      settings: {
        name: 'Lobby screen',
        orientation: 'landscape',
        timezone: 'Europe/Amsterdam',
        defaultPlaylistId: null,
      },
    });
    const state = computePlayerState(m, { paired: true, online: true, cachedMediaIds: allCached });
    expect(state.source).toBe('none');
    expect(state.items).toHaveLength(0);
    expect(state.statusMessage).toMatch(/no content scheduled/i);
  });
});

describe('stateFingerprint', () => {
  it('is stable for identical states and differs when content changes', () => {
    const ctx = { paired: true, online: true, cachedMediaIds: allCached };
    const a = stateFingerprint(computePlayerState(manifest(), ctx));
    const b = stateFingerprint(computePlayerState(manifest(), ctx));
    expect(a).toBe(b);

    const offline = stateFingerprint(computePlayerState(manifest(), { ...ctx, online: false }));
    expect(offline).not.toBe(a);
  });
});
