import { describe, expect, it } from 'vitest';
import { bytesToDownload, canonicalJson, computeManifestVersion, diffManifest } from './manifest';
import type { ManifestMedia, SyncManifest } from './types';

function makeMedia(overrides: Partial<ManifestMedia> = {}): ManifestMedia {
  return {
    id: 'media-1',
    name: 'demo.jpg',
    type: 'image',
    mimeType: 'image/jpeg',
    checksum: 'abc123',
    sizeBytes: 1000,
    width: 1920,
    height: 1080,
    orientation: 'landscape',
    durationSeconds: null,
    downloadPath: '/api/v1/device/media/media-1/file',
    ...overrides,
  };
}

function makeManifestContent(): Omit<SyncManifest, 'version' | 'generatedAt'> {
  return {
    protocolVersion: 1,
    deviceId: 'dev-1',
    settings: {
      name: 'Lobby Screen',
      orientation: 'landscape',
      timezone: 'Europe/Amsterdam',
      defaultPlaylistId: null,
    },
    emergency: { active: false, playlistId: null, mediaAssetId: null, startedAt: null },
    schedules: [],
    playlists: [],
    media: [makeMedia()],
  };
}

describe('canonicalJson', () => {
  it('sorts keys recursively so key order does not affect output', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalJson({ a: { c: 3, d: 2 }, b: 1 })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('preserves array order', () => {
    expect(canonicalJson([2, 1])).toBe('[2,1]');
  });
});

describe('computeManifestVersion', () => {
  it('is stable for identical content regardless of key order', () => {
    const a = makeManifestContent();
    const b = JSON.parse(canonicalJson(makeManifestContent()));
    expect(computeManifestVersion(a)).toBe(computeManifestVersion(b));
  });

  it('changes when content changes', () => {
    const a = makeManifestContent();
    const b = makeManifestContent();
    b.settings.orientation = 'portrait';
    expect(computeManifestVersion(a)).not.toBe(computeManifestVersion(b));
  });

  it('changes when a media checksum changes', () => {
    const a = makeManifestContent();
    const b = makeManifestContent();
    b.media = [makeMedia({ checksum: 'different' })];
    expect(computeManifestVersion(a)).not.toBe(computeManifestVersion(b));
  });
});

describe('v2 manifest content (folders, order modes, priority rules)', () => {
  function makeV2Content(): Omit<SyncManifest, 'version' | 'generatedAt'> {
    const content = makeManifestContent();
    content.protocolVersion = 2;
    content.playlists = [
      {
        id: 'pl-1',
        name: 'Random playlist',
        loop: true,
        defaultImageDurationSeconds: 10,
        playbackOrderMode: 'random_with_priority_rules',
        items: [
          {
            id: 'item-1',
            mediaId: 'media-1',
            position: 0,
            durationSeconds: null,
            fitMode: null,
            enabled: true,
          },
          {
            id: 'item-2:media-1',
            mediaId: 'media-1',
            position: 1,
            durationSeconds: null,
            fitMode: null,
            enabled: true,
            source: 'folder',
            sourceFolderId: 'folder-1',
            sourceFolderPath: 'Campaigns / Summer',
          },
        ],
        priorityRules: [
          {
            id: 'rule-1',
            name: 'Sponsors',
            intervalCount: 5,
            selectionMode: 'rotate',
            position: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            mediaIds: ['media-1'],
          },
        ],
      },
    ];
    return content;
  }

  it('versions are stable for identical v2 content', () => {
    expect(computeManifestVersion(makeV2Content())).toBe(computeManifestVersion(makeV2Content()));
  });

  it('version changes when a folder-resolved item set changes', () => {
    const a = makeV2Content();
    const b = makeV2Content();
    b.playlists[0].items = b.playlists[0].items.slice(0, 1);
    expect(computeManifestVersion(a)).not.toBe(computeManifestVersion(b));
  });

  it('version changes when a priority rule changes', () => {
    const a = makeV2Content();
    const b = makeV2Content();
    b.playlists[0].priorityRules![0].intervalCount = 3;
    expect(computeManifestVersion(a)).not.toBe(computeManifestVersion(b));
  });

  it('version changes when the playback order mode changes', () => {
    const a = makeV2Content();
    const b = makeV2Content();
    b.playlists[0].playbackOrderMode = 'alphabetical';
    expect(computeManifestVersion(a)).not.toBe(computeManifestVersion(b));
  });

  it('keeps v1-shaped playlists valid (fields are optional)', () => {
    const content = makeManifestContent();
    content.playlists = [
      {
        id: 'pl-1',
        name: 'Legacy playlist',
        loop: true,
        defaultImageDurationSeconds: 10,
        items: [
          {
            id: 'item-1',
            mediaId: 'media-1',
            position: 0,
            durationSeconds: null,
            fitMode: null,
            enabled: true,
          },
        ],
      },
    ];
    expect(computeManifestVersion(content)).toBeTruthy();
  });
});

describe('diffManifest', () => {
  it('downloads everything when cache is empty', () => {
    const media = [makeMedia({ id: 'm1' }), makeMedia({ id: 'm2' })];
    const diff = diffManifest([], media);
    expect(diff.toDownload.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(diff.toDelete).toEqual([]);
    expect(diff.unchanged).toEqual([]);
  });

  it('skips media with matching checksum', () => {
    const media = [makeMedia({ id: 'm1', checksum: 'aaa' })];
    const diff = diffManifest([{ mediaId: 'm1', checksum: 'aaa', sizeBytes: 1000 }], media);
    expect(diff.toDownload).toEqual([]);
    expect(diff.unchanged.map((m) => m.id)).toEqual(['m1']);
  });

  it('re-downloads media whose checksum changed (reprocessed)', () => {
    const media = [makeMedia({ id: 'm1', checksum: 'new' })];
    const diff = diffManifest([{ mediaId: 'm1', checksum: 'old', sizeBytes: 1000 }], media);
    expect(diff.toDownload.map((m) => m.id)).toEqual(['m1']);
  });

  it('marks unreferenced cached media for deletion', () => {
    const diff = diffManifest(
      [
        { mediaId: 'stale', checksum: 'x', sizeBytes: 5 },
        { mediaId: 'm1', checksum: 'aaa', sizeBytes: 1000 },
      ],
      [makeMedia({ id: 'm1', checksum: 'aaa' })],
    );
    expect(diff.toDelete).toEqual(['stale']);
  });

  it('computes total download size', () => {
    const diff = diffManifest(
      [],
      [makeMedia({ id: 'm1', sizeBytes: 100 }), makeMedia({ id: 'm2', sizeBytes: 250 })],
    );
    expect(bytesToDownload(diff)).toBe(350);
  });
});
