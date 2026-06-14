import { buildServer } from './server';
import { getEnv } from './env';
import { closeRedis } from './lib/redis';
import { closeQueues } from './lib/queues';
import { bootstrapSuperadmin } from './lib/superadmin';

async function main(): Promise<void> {
  const env = getEnv();
  const app = await buildServer();

  // Install-time superadmin bootstrap. Only the outcome is logged — never
  // the password.
  const bootstrap = await bootstrapSuperadmin(app.prisma, {
    email: env.INITIAL_SUPERADMIN_EMAIL,
    password: env.INITIAL_SUPERADMIN_PASSWORD,
    name: env.INITIAL_SUPERADMIN_NAME,
  });
  if (bootstrap.status === 'created') {
    app.log.info({ email: bootstrap.email }, 'superadmin bootstrap: account created');
  } else if (bootstrap.status === 'invalid') {
    app.log.error(`superadmin bootstrap failed: ${bootstrap.reason}`);
  } else {
    app.log.info(
      `superadmin bootstrap skipped (${bootstrap.status === 'exists' ? 'superadmin already exists' : bootstrap.reason})`,
    );
  }

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
