import type { MediaAsset, MediaVariant } from '@signage/database';
import { videoVariantKindForProfile, type PlaybackProfile } from '@signage/shared';

/** The concrete file a device should download for its tier. */
export interface SelectedVariant {
  storageKey: string;
  checksum: string | null;
  sizeBytes: number | null;
  mimeType: string;
  width: number | null;
  height: number | null;
}

type MediaCols = Pick<
  MediaAsset,
  | 'mediaType'
  | 'processedStorageKey'
  | 'originalStorageKey'
  | 'processedMimeType'
  | 'originalMimeType'
  | 'checksumSha256'
  | 'processedSizeBytes'
  | 'sizeBytes'
  | 'width'
  | 'height'
>;

type VariantCols = Pick<
  MediaVariant,
  'kind' | 'storageKey' | 'mimeType' | 'checksumSha256' | 'sizeBytes' | 'width' | 'height'
>;

/**
 * Picks the file to serve/advertise for a device's playback profile.
 *
 * Fallback chain: requested tier variant → standard (the processed columns) →
 * original. The `standard` tier is never stored as a variant — it *is* the
 * processed file — so a `standard` device always resolves to the processed
 * columns directly. Images have no tiers and resolve the same way.
 *
 * Single source of truth used by both the sync manifest (so the advertised
 * checksum/size match the device's tier) and the device file endpoint (so the
 * served file matches that checksum).
 */
export function selectVideoVariant(
  media: MediaCols,
  variants: VariantCols[],
  profile: PlaybackProfile,
): SelectedVariant {
  if (media.mediaType === 'video' && profile !== 'standard') {
    const kind = videoVariantKindForProfile(profile);
    const v = variants.find((x) => x.kind === kind);
    if (v) {
      return {
        storageKey: v.storageKey,
        checksum: v.checksumSha256,
        sizeBytes: Number(v.sizeBytes),
        mimeType: v.mimeType,
        width: v.width,
        height: v.height,
      };
    }
  }
  return {
    storageKey: media.processedStorageKey ?? media.originalStorageKey,
    checksum: media.checksumSha256,
    sizeBytes:
      media.processedSizeBytes != null
        ? Number(media.processedSizeBytes)
        : media.sizeBytes != null
          ? Number(media.sizeBytes)
          : null,
    mimeType: media.processedMimeType ?? media.originalMimeType,
    width: media.width,
    height: media.height,
  };
}
