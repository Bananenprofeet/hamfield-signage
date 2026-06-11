import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ManifestMedia, SyncManifest } from '@signage/sync-protocol';
import { ApiClient } from './api-client';
import { loadConfig, type AgentConfig } from './config';
import { AgentDb } from './db';
import { SyncEngine } from './sync';

interface StubBackend {
  server: http.Server;
  url: string;
  manifest: SyncManifest;
  files: Map<string, Buffer>;
  downloads: string[];
  syncStatuses: Array<Record<string, unknown>>;
  close: () => Promise<void>;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function mediaEntry(id: string, content: Buffer, type: 'image' | 'video' = 'image'): ManifestMedia {
  return {
    id,
    name: id,
    type,
    mimeType: type === 'image' ? 'image/jpeg' : 'video/mp4',
    checksum: sha256(content),
    sizeBytes: content.length,
    width: 1920,
    height: 1080,
    orientation: 'landscape',
    durationSeconds: type === 'video' ? 30 : null,
    downloadPath: `/api/v1/device/media/${id}/download`,
  };
}

function buildManifest(version: string, media: ManifestMedia[]): SyncManifest {
  return {
    protocolVersion: 1,
    version,
    generatedAt: new Date().toISOString(),
    deviceId: 'dev-1',
    settings: {
      name: 'Test screen',
      orientation: 'landscape',
      timezone: 'UTC',
      defaultPlaylistId: 'pl-1',
    },
    emergency: { active: false, playlistId: null, mediaAssetId: null, startedAt: null },
    schedules: [],
    playlists: [
      {
        id: 'pl-1',
        name: 'Playlist',
        loop: true,
        defaultImageDurationSeconds: 10,
        items: media.map((m, i) => ({
          id: `item-${m.id}`,
          mediaId: m.id,
          position: i,
          durationSeconds: null,
          fitMode: null,
          enabled: true,
        })),
      },
    ],
    media,
  };
}

async function startStubBackend(
  initial: SyncManifest,
  files: Map<string, Buffer>,
): Promise<StubBackend> {
  const downloads: string[] = [];
  const syncStatuses: Array<Record<string, unknown>> = [];

  const backend: Partial<StubBackend> = { manifest: initial, files, downloads, syncStatuses };

  const server = http.createServer((req, res) => {
    const url = req.url ?? '';
    if (req.method === 'GET' && url.startsWith('/api/v1/device/sync')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ manifest: backend.manifest, commands: [] }));
      return;
    }
    const download = url.match(/^\/api\/v1\/device\/media\/([^/]+)\/download$/);
    if (req.method === 'GET' && download) {
      const content = files.get(download[1]);
      if (!content) {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      downloads.push(download[1]);
      res.setHeader('content-type', 'application/octet-stream');
      res.end(content);
      return;
    }
    if (req.method === 'POST' && url === '/api/v1/device/sync-status') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        syncStatuses.push(JSON.parse(body) as Record<string, unknown>);
        res.statusCode = 204;
        res.end();
      });
      return;
    }
    res.statusCode = 404;
    res.end('unhandled');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  backend.server = server;
  backend.url = `http://127.0.0.1:${port}`;
  backend.close = () => new Promise((resolve) => server.close(() => resolve()));
  return backend as StubBackend;
}

describe('SyncEngine', () => {
  let dataDir: string;
  let backend: StubBackend;
  let db: AgentDb;
  let config: AgentConfig;
  let engine: SyncEngine;
  let applied: SyncManifest[];

  const imgContent = Buffer.from('fake jpeg bytes for the sync test');
  const vidContent = Buffer.from('fake mp4 bytes — somewhat longer so sizes differ');

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'signage-sync-test-'));
    const img = mediaEntry('img-1', imgContent);
    const vid = mediaEntry('vid-1', vidContent, 'video');
    backend = await startStubBackend(
      buildManifest('v1', [img, vid]),
      new Map([
        ['img-1', imgContent],
        ['vid-1', vidContent],
      ]),
    );

    config = loadConfig({
      SIGNAGE_SERVER_URL: backend.url,
      SIGNAGE_DATA_DIR: dataDir,
    } as NodeJS.ProcessEnv);
    db = new AgentDb(dataDir);
    const api = new ApiClient(config, 'test-token');
    applied = [];
    engine = new SyncEngine(config, db, api, pino({ level: 'silent' }), (m) => applied.push(m));
  });

  afterEach(async () => {
    db.close();
    await backend.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('downloads media, verifies checksums and applies the manifest atomically', async () => {
    await engine.syncNow('test');

    expect(db.getManifestVersion()).toBe('v1');
    expect(applied).toHaveLength(1);
    expect(backend.downloads.sort()).toEqual(['img-1', 'vid-1']);

    const cached = db.listCachedMedia();
    expect(cached.map((c) => c.mediaId).sort()).toEqual(['img-1', 'vid-1']);
    for (const entry of cached) {
      expect(existsSync(entry.filePath)).toBe(true);
    }
    expect(readFileSync(join(config.mediaDir, 'img-1'))).toEqual(imgContent);

    const final = backend.syncStatuses.at(-1);
    expect(final?.status).toBe('applied');
    expect(final?.manifestVersion).toBe('v1');
  });

  it('does nothing when the manifest version is unchanged', async () => {
    await engine.syncNow('first');
    const downloadsAfterFirst = backend.downloads.length;

    await engine.syncNow('second');
    expect(backend.downloads.length).toBe(downloadsAfterFirst);
    expect(applied).toHaveLength(1);
  });

  it('removes stale media only after the new manifest is committed', async () => {
    await engine.syncNow('initial');
    const stalePath = db.getCachedMedia('vid-1')?.filePath;
    expect(stalePath && existsSync(stalePath)).toBe(true);

    backend.manifest = buildManifest('v2', [mediaEntry('img-1', imgContent)]);
    await engine.syncNow('content changed');

    expect(db.getManifestVersion()).toBe('v2');
    expect(db.listCachedMedia().map((c) => c.mediaId)).toEqual(['img-1']);
    expect(stalePath && existsSync(stalePath)).toBe(false);
    // The kept file was not re-downloaded.
    expect(backend.downloads.filter((d) => d === 'img-1')).toHaveLength(1);
  });

  it('rejects a corrupted download and keeps the previous state', async () => {
    await engine.syncNow('initial');
    expect(db.getManifestVersion()).toBe('v1');

    const tampered = mediaEntry('img-2', Buffer.from('expected content'));
    backend.files.set('img-2', Buffer.from('actual different content'));
    backend.manifest = buildManifest('v3', [mediaEntry('img-1', imgContent), tampered]);

    await engine.syncNow('tampered update');

    // The corrupt manifest must not be applied; the old content keeps playing.
    expect(db.getManifestVersion()).toBe('v1');
    expect(db.getCachedMedia('img-2')).toBeNull();
    expect(existsSync(join(config.mediaDir, 'img-2'))).toBe(false);
    expect(backend.syncStatuses.some((s) => s.status === 'failed')).toBe(true);
    expect(db.takeLogs(10).some((l) => l.message.includes('sync failed'))).toBe(true);
  });
});
