import { describe, expect, it } from 'vitest';
import type { MediaAsset, MediaVariant } from '@signage/database';
import { selectVideoVariant } from './media-variant';

const media = {
  mediaType: 'video',
  processedStorageKey: 'org/1/media/v/processed/video.mp4',
  originalStorageKey: 'org/1/media/v/original',
  processedMimeType: 'video/mp4',
  originalMimeType: 'video/quicktime',
  checksumSha256: 'standard-checksum',
  processedSizeBytes: BigInt(6_000_000),
  sizeBytes: BigInt(50_000_000),
  width: 1920,
  height: 1080,
} as unknown as MediaAsset;

const lightVariant = {
  kind: 'video_light',
  storageKey: 'org/1/media/v/processed/video-light.mp4',
  mimeType: 'video/mp4',
  checksumSha256: 'light-checksum',
  sizeBytes: BigInt(2_000_000),
  width: 1280,
  height: 720,
} as unknown as MediaVariant;

describe('selectVideoVariant', () => {
  it('returns the processed columns for the standard tier', () => {
    const sel = selectVideoVariant(media, [lightVariant], 'standard');
    expect(sel.storageKey).toBe(media.processedStorageKey);
    expect(sel.checksum).toBe('standard-checksum');
    expect(sel.sizeBytes).toBe(6_000_000);
  });

  it('returns the tier variant when one exists', () => {
    const sel = selectVideoVariant(media, [lightVariant], 'light');
    expect(sel.storageKey).toBe(lightVariant.storageKey);
    expect(sel.checksum).toBe('light-checksum');
    expect(sel.sizeBytes).toBe(2_000_000);
    expect(sel.height).toBe(720);
  });

  it('falls back to the standard tier when the requested variant is missing', () => {
    const sel = selectVideoVariant(media, [], 'light');
    expect(sel.storageKey).toBe(media.processedStorageKey);
    expect(sel.checksum).toBe('standard-checksum');
  });

  it('falls back to the original when there is no processed file', () => {
    const noProcessed = { ...media, processedStorageKey: null, checksumSha256: null } as MediaAsset;
    const sel = selectVideoVariant(noProcessed, [], 'standard');
    expect(sel.storageKey).toBe(media.originalStorageKey);
  });

  it('ignores tiers for images', () => {
    const image = { ...media, mediaType: 'image' } as MediaAsset;
    const sel = selectVideoVariant(image, [lightVariant], 'light');
    expect(sel.storageKey).toBe(media.processedStorageKey);
  });
});
