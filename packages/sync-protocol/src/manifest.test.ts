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
