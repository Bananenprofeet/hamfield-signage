import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { diffManifest, bytesToDownload, type SyncManifest } from '@signage/sync-protocol';
import type { ApiClient } from './api-client';
import type { AgentConfig } from './config';
import type { AgentDb } from './db';

/**
 * Transactional content sync:
 *  1. fetch the manifest and skip if the version is unchanged
 *  2. download new/changed media to temp files, verify checksums
 *  3. commit manifest + cache index atomically in SQLite
 *  4. delete stale files only after the commit
 *
 * The currently playing content keeps running from the old cache until the
 * commit, so the screen never goes blank during a sync.
 */
export class SyncEngine {
  private syncing = false;
  private queued = false;

  constructor(
    private config: AgentConfig,
    private db: AgentDb,
    private api: ApiClient,
    private log: Logger,
    private onApplied: (manifest: SyncManifest) => void,
  ) {}

  async syncNow(reason: string): Promise<void> {
    if (this.syncing) {
      this.queued = true;
      return;
    }
    this.syncing = true;
    try {
      await this.runSync(reason);
    } catch (err) {
      this.log.warn({ err, reason }, 'sync failed');
      this.db.bufferLog('warn', `sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.syncing = false;
      if (this.queued) {
        this.queued = false;
        void this.syncNow('queued during previous sync');
      }
    }
  }

  private async runSync(reason: string): Promise<void> {
    const { manifest } = await this.api.getSync(false);
    const currentVersion = this.db.getManifestVersion();
    if (manifest.version === currentVersion) {
      this.log.debug({ reason, version: manifest.version }, 'sync: manifest unchanged');
      return;
    }
    this.log.info(
      { reason, from: currentVersion, to: manifest.version, media: manifest.media.length },
      'sync: applying new manifest',
    );

    const cached = this.db.listCachedMedia();
    const diff = diffManifest(cached, manifest.media);

    if (diff.toDownload.length > 0) {
      this.log.info(
        { files: diff.toDownload.length, bytes: bytesToDownload(diff) },
        'sync: downloading media',
      );
      await this.api
        .reportSyncStatus({
          manifestVersion: manifest.version,
          status: 'downloading',
          cacheUsedBytes: this.db.cacheUsedBytes(),
        })
        .catch(() => undefined);
    }

    await mkdir(this.config.mediaDir, { recursive: true });
    const upserts: Array<{
      mediaId: string;
      checksum: string;
      sizeBytes: number;
      mimeType: string;
      filePath: string;
    }> = [];
    try {
      for (const media of diff.toDownload) {
        const filePath = join(this.config.mediaDir, media.id);
        await this.api.downloadMedia(media, filePath);
        upserts.push({
          mediaId: media.id,
          checksum: media.checksum,
          sizeBytes: media.sizeBytes,
          mimeType: media.mimeType,
          filePath,
        });
        this.log.debug({ mediaId: media.id, name: media.name }, 'sync: downloaded');
      }
    } catch (err) {
      await this.api
        .reportSyncStatus({
          manifestVersion: manifest.version,
          status: 'failed',
          error: err instanceof Error ? err.message.slice(0, 2000) : String(err),
          cacheUsedBytes: this.db.cacheUsedBytes(),
        })
        .catch(() => undefined);
      throw err;
    }

    // Collect stale file paths before the index rows disappear.
    const staleFiles = diff.toDelete
      .map((id) => this.db.getCachedMedia(id)?.filePath)
      .filter((p): p is string => Boolean(p));

    this.db.applyManifest(manifest, upserts, diff.toDelete);

    for (const filePath of staleFiles) {
      await rm(filePath, { force: true }).catch(() => undefined);
    }

    await this.api
      .reportSyncStatus({
        manifestVersion: manifest.version,
        status: 'applied',
        cachedMediaIds: manifest.media.map((m) => m.id),
        cacheUsedBytes: this.db.cacheUsedBytes(),
      })
      .catch(() => undefined);

    this.log.info({ version: manifest.version }, 'sync: applied');
    this.onApplied(manifest);
  }

  async clearCacheAndResync(): Promise<void> {
    const cached = this.db.listCachedMedia();
    this.db.clearCache();
    for (const entry of cached) {
      await rm(entry.filePath, { force: true }).catch(() => undefined);
    }
    this.log.info('cache cleared');
    await this.syncNow('cache cleared');
  }
}
