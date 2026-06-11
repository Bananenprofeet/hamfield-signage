import os from 'node:os';
import { statfs } from 'node:fs/promises';
import type { HeartbeatInput } from '@signage/shared';
import type { AgentConfig } from './config';
import type { AgentDb } from './db';

export interface PlaybackPosition {
  currentPlaylistId: string | null;
  currentMediaId: string | null;
}

export async function collectMetrics(
  config: AgentConfig,
  db: AgentDb,
  position: PlaybackPosition,
  lastError: string | null,
): Promise<HeartbeatInput> {
  let diskFreeBytes: number | undefined;
  let diskTotalBytes: number | undefined;
  try {
    const fs = await statfs(config.dataDir);
    diskFreeBytes = fs.bavail * fs.bsize;
    diskTotalBytes = fs.blocks * fs.bsize;
  } catch {
    // statfs can fail on exotic filesystems; report without disk numbers.
  }

  const cores = os.cpus().length || 1;
  const cpuPercent = Math.min(100, Math.round((os.loadavg()[0] / cores) * 100));

  return {
    appVersion: config.appVersion,
    osInfo: `${os.type()} ${os.release()}`,
    archInfo: os.arch(),
    uptimeSeconds: Math.round(os.uptime()),
    cpuPercent,
    memUsedBytes: os.totalmem() - os.freemem(),
    memTotalBytes: os.totalmem(),
    diskFreeBytes,
    diskTotalBytes,
    cacheUsedBytes: db.cacheUsedBytes(),
    currentPlaylistId: position.currentPlaylistId,
    currentMediaId: position.currentMediaId,
    manifestVersion: db.getManifestVersion(),
    lastError,
  };
}
