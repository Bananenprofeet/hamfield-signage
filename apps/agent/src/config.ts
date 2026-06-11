import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const configSchema = z.object({
  /** Base URL of the backend, e.g. https://signage.example.com */
  SIGNAGE_SERVER_URL: z.string().url().default('http://localhost:4000'),
  /** Where credentials, the SQLite state db and the media cache live. */
  SIGNAGE_DATA_DIR: z.string().optional(),
  /** Port of the local player HTTP/WS server the kiosk browser connects to. */
  SIGNAGE_PLAYER_PORT: z.coerce.number().int().default(8080),
  /** One-time pairing code; used only while the device is not yet paired. */
  SIGNAGE_PAIRING_CODE: z.string().optional(),
  /** Directory containing the built player UI (apps/player/dist). */
  SIGNAGE_PLAYER_UI_DIR: z.string().optional(),
  /** Shell command that writes a screenshot to the path given as $1. */
  SIGNAGE_SCREENSHOT_CMD: z.string().optional(),
  /** Shell command executed for the software_update remote command. */
  SIGNAGE_UPDATE_CMD: z.string().optional(),
  /** Allow reboot_device to actually reboot the host. */
  SIGNAGE_ALLOW_REBOOT: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  /** systemd unit restarted by the restart_player command, if any. */
  SIGNAGE_PLAYER_SERVICE: z.string().optional(),
  SIGNAGE_LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  SIGNAGE_APP_VERSION: z.string().default('0.1.0'),
});

export interface AgentConfig {
  serverUrl: string;
  apiBase: string;
  wsUrl: string;
  dataDir: string;
  mediaDir: string;
  tmpDir: string;
  playerPort: number;
  pairingCode: string | null;
  playerUiDir: string | null;
  screenshotCmd: string | null;
  updateCmd: string | null;
  allowReboot: boolean;
  playerService: string | null;
  logLevel: string;
  appVersion: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const parsed = configSchema.parse(env);
  const serverUrl = parsed.SIGNAGE_SERVER_URL.replace(/\/+$/, '');
  const dataDir =
    parsed.SIGNAGE_DATA_DIR ??
    (process.platform === 'linux' ? '/var/lib/signage' : join(homedir(), '.signage'));

  const wsBase = serverUrl.replace(/^http/, 'ws');
  return {
    serverUrl,
    apiBase: `${serverUrl}/api/v1`,
    wsUrl: `${wsBase}/api/v1/device/ws`,
    dataDir,
    mediaDir: join(dataDir, 'media'),
    tmpDir: join(dataDir, 'tmp'),
    playerPort: parsed.SIGNAGE_PLAYER_PORT,
    pairingCode: parsed.SIGNAGE_PAIRING_CODE || null,
    playerUiDir: parsed.SIGNAGE_PLAYER_UI_DIR || null,
    screenshotCmd: parsed.SIGNAGE_SCREENSHOT_CMD || null,
    updateCmd: parsed.SIGNAGE_UPDATE_CMD || null,
    allowReboot: parsed.SIGNAGE_ALLOW_REBOOT,
    playerService: parsed.SIGNAGE_PLAYER_SERVICE || null,
    logLevel: parsed.SIGNAGE_LOG_LEVEL,
    appVersion: parsed.SIGNAGE_APP_VERSION,
  };
}
