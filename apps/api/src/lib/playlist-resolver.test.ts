import { describe, expect, it } from 'vitest';
import type { MediaAsset, PlaylistItem, PlaylistPriorityRuleAssignment } from '@signage/database';
import {
  computeFolderPaths,
  collectDescendantIds,
  wouldCreateCycle,
  expandFolderIds,
  type FolderNode,
} from './folders';
import {
  applyOrderMode,
  expandPlaylistItems,
  isPlayable,
  resolvePriorityRuleMedia,
} from './playlist-resolver';

// ------------------------------------------------------------ fixtures

const folders: FolderNode[] = [
  { id: 'root-a', parentFolderId: null, name: 'Campaigns' },
  { id: 'sub-a1', parentFolderId: 'root-a', name: 'Summer' },
  { id: 'sub-a2', parentFolderId: 'root-a', name: 'Winter' },
  { id: 'root-b', parentFolderId: null, name: 'Logos' },
];

function media(overrides: Partial<MediaAsset> & { id: string }): MediaAsset {
  return {
    organizationId: 'org-1',
    folderId: null,
    name: overrides.id,
    originalFilename: `${overrides.id}.jpg`,
    mediaType: 'image',
    originalMimeType: 'image/jpeg',
    processedMimeType: 'image/jpeg',
    originalStorageKey: 'k',
    processedStorageKey: 'k-processed',
    thumbnailStorageKey: null,
    durationSeconds: null,
    width: 1920,
    height: 1080,
    orientation: 'landscape',
    processingStatus: 'ready',
    processingError: null,
    sizeBytes: null,
    processedSizeBytes: null,
    checksumSha256: 'checksum',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    ...overrides,
  } as MediaAsset;
}

function item(
  overrides: Partial<PlaylistItem & { mediaAsset: MediaAsset | null }> & { id: string },
): PlaylistItem & { mediaAsset: MediaAsset | null } {
  return {
    playlistId: 'pl-1',
    type: 'media',
    mediaAssetId: null,
    folderId: null,
    position: 0,
    durationSeconds: null,
    fitMode: null,
    enabled: true,
    includeSubfolders: false,
    filterMediaType: null,
    filterOrientation: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    mediaAsset: null,
    ...overrides,
  } as PlaylistItem & { mediaAsset: MediaAsset | null };
}

const folderPaths = computeFolderPaths(folders);

// ------------------------------------------------------------- folders

describe('folder helpers', () => {
  it('computes display paths from parent relationships', () => {
    expect(folderPaths.get('sub-a1')).toBe('Campaigns / Summer');
    expect(folderPaths.get('root-b')).toBe('Logos');
  });

  it('collects descendants transitively', () => {
    expect(collectDescendantIds(folders, 'root-a').sort()).toEqual(['root-a', 'sub-a1', 'sub-a2']);
    expect(collectDescendantIds(folders, 'sub-a1')).toEqual(['sub-a1']);
  });

  it('detects move cycles', () => {
    expect(wouldCreateCycle(folders, 'root-a', 'sub-a1')).toBe(true);
    expect(wouldCreateCycle(folders, 'root-a', 'root-a')).toBe(true);
    expect(wouldCreateCycle(folders, 'sub-a1', 'root-b')).toBe(false);
  });

  it('expands folder ids per the includeSubfolders flag', () => {
    expect(expandFolderIds(folders, 'root-a', false)).toEqual(['root-a']);
    expect(expandFolderIds(folders, 'root-a', true).sort()).toEqual(['root-a', 'sub-a1', 'sub-a2']);
    expect(expandFolderIds(folders, 'deleted-folder', true)).toEqual([]);
  });
});

// ----------------------------------------------------------- expansion

describe('expandPlaylistItems', () => {
  const pool = [
    media({ id: 'file10', name: 'file10', folderId: 'root-a' }),
    media({ id: 'file2', name: 'file2', folderId: 'root-a' }),
    media({ id: 'nested', name: 'nested', folderId: 'sub-a1' }),
    media({ id: 'video', name: 'a-video', folderId: 'root-a', mediaType: 'video' }),
    media({ id: 'portrait', name: 'portrait', folderId: 'root-a', orientation: 'portrait' }),
  ];

  it('expands a folder entry alphabetically (natural sort) at its position', () => {
    const direct = media({ id: 'direct' });
    const entries = expandPlaylistItems(
      [
        item({ id: 'i1', mediaAssetId: 'direct', mediaAsset: direct, position: 0 }),
        item({ id: 'i2', type: 'folder', folderId: 'root-a', position: 1 }),
      ],
      folders,
      pool,
      folderPaths,
    );
    expect(entries.map((e) => e.media.name)).toEqual([
      'direct',
      'a-video',
      'file2',
      'file10',
      'portrait',
    ]);
    expect(entries[1].source).toBe('folder');
    expect(entries[1].sourceFolderPath).toBe('Campaigns');
    expect(entries[1].entryId).toBe('i2:video');
  });

  it('includes nested media only when includeSubfolders is set', () => {
    const without = expandPlaylistItems(
      [item({ id: 'i1', type: 'folder', folderId: 'root-a' })],
      folders,
      pool,
      folderPaths,
    );
    expect(without.some((e) => e.media.id === 'nested')).toBe(false);

    const withSub = expandPlaylistItems(
      [item({ id: 'i1', type: 'folder', folderId: 'root-a', includeSubfolders: true })],
      folders,
      pool,
      folderPaths,
    );
    expect(withSub.some((e) => e.media.id === 'nested')).toBe(true);
  });

  it('applies media type and orientation filters', () => {
    const imagesOnly = expandPlaylistItems(
      [item({ id: 'i1', type: 'folder', folderId: 'root-a', filterMediaType: 'image' })],
      folders,
      pool,
      folderPaths,
    );
    expect(imagesOnly.every((e) => e.media.mediaType === 'image')).toBe(true);

    const portraitOnly = expandPlaylistItems(
      [item({ id: 'i1', type: 'folder', folderId: 'root-a', filterOrientation: 'portrait' })],
      folders,
      pool,
      folderPaths,
    );
    expect(portraitOnly.map((e) => e.media.id)).toEqual(['portrait']);
  });

  it('skips disabled entries and deleted media', () => {
    const deleted = media({ id: 'gone', deletedAt: new Date() });
    const entries = expandPlaylistItems(
      [
        item({ id: 'i1', mediaAssetId: 'gone', mediaAsset: deleted }),
        item({ id: 'i2', type: 'folder', folderId: 'root-a', enabled: false }),
      ],
      folders,
      pool,
      folderPaths,
    );
    expect(entries).toEqual([]);
  });

  it('reflects media added to / removed from the folder on re-resolution', () => {
    const items = [item({ id: 'i1', type: 'folder', folderId: 'root-b' })];
    expect(expandPlaylistItems(items, folders, pool, folderPaths)).toHaveLength(0);

    const updatedPool = [...pool, media({ id: 'new-logo', folderId: 'root-b' })];
    expect(expandPlaylistItems(items, folders, updatedPool, folderPaths)).toHaveLength(1);
  });
});

describe('applyOrderMode', () => {
  it('sorts globally for alphabetical mode, case-insensitive and natural', () => {
    const entries = expandPlaylistItems(
      [
        item({
          id: 'i1',
          mediaAssetId: 'B10',
          mediaAsset: media({ id: 'B10', name: 'B10' }),
          position: 0,
        }),
        item({
          id: 'i2',
          mediaAssetId: 'b2',
          mediaAsset: media({ id: 'b2', name: 'b2' }),
          position: 1,
        }),
        item({
          id: 'i3',
          mediaAssetId: 'a',
          mediaAsset: media({ id: 'a', name: 'apple' }),
          position: 2,
        }),
      ],
      folders,
      [],
      folderPaths,
    );
    expect(applyOrderMode(entries, 'alphabetical').map((e) => e.media.name)).toEqual([
      'apple',
      'b2',
      'B10',
    ]);
    // manual keeps expansion order
    expect(applyOrderMode(entries, 'manual_order').map((e) => e.media.name)).toEqual([
      'B10',
      'b2',
      'apple',
    ]);
  });
});

// -------------------------------------------------------- priority rules

describe('resolvePriorityRuleMedia', () => {
  function assignment(
    overrides: Partial<PlaylistPriorityRuleAssignment & { mediaAsset: MediaAsset | null }> & {
      id: string;
    },
  ): PlaylistPriorityRuleAssignment & { mediaAsset: MediaAsset | null } {
    return {
      organizationId: 'org-1',
      priorityRuleId: 'rule-1',
      mediaAssetId: null,
      folderId: null,
      includeSubfolders: false,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      mediaAsset: null,
      ...overrides,
    } as PlaylistPriorityRuleAssignment & { mediaAsset: MediaAsset | null };
  }

  it('keeps assignment order for direct media and dedupes', () => {
    const s1 = media({ id: 's1' });
    const s2 = media({ id: 's2' });
    const result = resolvePriorityRuleMedia(
      [
        assignment({ id: 'a1', mediaAssetId: 's2', mediaAsset: s2, createdAt: new Date(1) }),
        assignment({ id: 'a2', mediaAssetId: 's1', mediaAsset: s1, createdAt: new Date(2) }),
        assignment({ id: 'a3', mediaAssetId: 's2', mediaAsset: s2, createdAt: new Date(3) }),
      ],
      folders,
      [],
    );
    expect(result.map((m) => m.id)).toEqual(['s2', 's1']);
  });

  it('expands folder assignments alphabetically and skips deleted media', () => {
    const pool = [
      media({ id: 'z', name: 'zeta', folderId: 'root-b' }),
      media({ id: 'a', name: 'alpha', folderId: 'root-b' }),
      media({ id: 'gone', name: 'gone', folderId: 'root-b', deletedAt: new Date() }),
    ];
    const result = resolvePriorityRuleMedia(
      [assignment({ id: 'a1', folderId: 'root-b' })],
      folders,
      pool,
    );
    expect(result.map((m) => m.name)).toEqual(['alpha', 'zeta']);
  });
});

describe('isPlayable', () => {
  it('requires ready status, checksum and a processed file', () => {
    expect(isPlayable(media({ id: 'ok' }))).toBe(true);
    expect(isPlayable(media({ id: 'x', processingStatus: 'processing' }))).toBe(false);
    expect(isPlayable(media({ id: 'x', checksumSha256: null }))).toBe(false);
    expect(isPlayable(media({ id: 'x', processedStorageKey: null }))).toBe(false);
    expect(isPlayable(media({ id: 'x', deletedAt: new Date() }))).toBe(false);
  });
});
