import { buildServer } from './server';
import { getEnv } from './env';
import { closeRedis } from './lib/redis';
import { closeQueues } from './lib/queues';

async function main(): Promise<void> {
  const env = getEnv();
  const app = await buildServer();

  // Redis-backed cross-instance command fanout.
  await app.wsHub.start();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      await closeQueues();
      await closeRedis();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  app.log.info(`API listening on http://${env.API_HOST}:${env.API_PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
