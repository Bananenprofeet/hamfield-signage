import { createHash } from 'node:crypto';
import type { CachedMediaEntry, ManifestDiff, ManifestMedia, SyncManifest } from './types';

/** Serializes a value to JSON with object keys sorted recursively. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Computes the manifest content version. `version` and `generatedAt` are
 * excluded so that regenerating an identical manifest yields an identical
 * version — devices use this to skip no-op syncs.
 */
export function computeManifestVersion(
  manifest: Omit<SyncManifest, 'version' | 'generatedAt'>,
): string {
  const { ...content } = manifest;
  return createHash('sha256').update(canonicalJson(content)).digest('hex').slice(0, 32);
}

/**
 * Compares the device's cached media against a manifest.
 * A cached entry counts as valid only when its checksum matches exactly.
 */
export function diffManifest(
  cached: CachedMediaEntry[],
  manifestMedia: ManifestMedia[],
): ManifestDiff {
  const cachedByMedia = new Map(cached.map((c) => [c.mediaId, c]));
  const manifestIds = new Set(manifestMedia.map((m) => m.id));

  const toDownload: ManifestMedia[] = [];
  const unchanged: ManifestMedia[] = [];

  for (const media of manifestMedia) {
    const entry = cachedByMedia.get(media.id);
    if (entry && entry.checksum === media.checksum) {
      unchanged.push(media);
    } else {
      toDownload.push(media);
    }
  }

  const toDelete = cached.filter((c) => !manifestIds.has(c.mediaId)).map((c) => c.mediaId);

  return { toDownload, toDelete, unchanged };
}

/** Total bytes the device still needs to download for this manifest. */
export function bytesToDownload(diff: ManifestDiff): number {
  return diff.toDownload.reduce((sum, m) => sum + m.sizeBytes, 0);
}
