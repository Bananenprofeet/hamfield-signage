import { join } from 'node:path';
import { startAgent } from '@signage/agent';

/**
 * A simulated signage device: the real agent with mock-friendly defaults.
 * Maps MOCK_DEVICE_* env vars onto the agent's SIGNAGE_* config so the same
 * code path runs in CI / docker compose as on a Raspberry Pi.
 */
const env: NodeJS.ProcessEnv = {
  ...process.env,
  SIGNAGE_SERVER_URL: process.env.MOCK_DEVICE_BACKEND_URL ?? process.env.SIGNAGE_SERVER_URL,
  SIGNAGE_PAIRING_CODE: process.env.MOCK_DEVICE_PAIRING_CODE ?? process.env.SIGNAGE_PAIRING_CODE,
  SIGNAGE_PLAYER_PORT: process.env.MOCK_DEVICE_PORT ?? process.env.SIGNAGE_PLAYER_PORT,
  SIGNAGE_DATA_DIR:
    process.env.MOCK_DEVICE_DATA_DIR ??
    process.env.SIGNAGE_DATA_DIR ??
    join(process.cwd(), '.mock-device-data'),
  SIGNAGE_APP_VERSION: process.env.SIGNAGE_APP_VERSION ?? '0.1.0-mock',
};

startAgent(env)
  .then((agent) => {
    const shutdown = () => {
      void agent.stop().then(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  })
  .catch((err) => {
    console.error('mock device failed to start', err);
    process.exit(1);
  });
