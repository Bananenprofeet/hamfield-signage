/**
 * Creates the initial superadmin account.
 *
 * Usage:
 *   pnpm app:create-superadmin -- <email> <password> [name]
 * or with environment variables:
 *   INITIAL_SUPERADMIN_EMAIL / INITIAL_SUPERADMIN_PASSWORD / INITIAL_SUPERADMIN_NAME
 */
import { getPrisma, disconnectPrisma } from '@signage/database';
import { bootstrapSuperadmin } from '../lib/superadmin';

async function main(): Promise<void> {
  const [email, password, name] = process.argv.slice(2);
  const prisma = getPrisma();
  const result = await bootstrapSuperadmin(prisma, {
    email: email ?? process.env.INITIAL_SUPERADMIN_EMAIL,
    password: password ?? process.env.INITIAL_SUPERADMIN_PASSWORD,
    name: name ?? process.env.INITIAL_SUPERADMIN_NAME ?? 'Superadmin',
  });

  switch (result.status) {
    case 'created':
      console.log(`Superadmin account ready: ${result.email}`);
      break;
    case 'exists':
      console.log('A superadmin already exists — nothing to do.');
      break;
    case 'skipped':
      console.error(`Skipped: ${result.reason}`);
      process.exitCode = 1;
      break;
    case 'invalid':
      console.error(`Invalid input: ${result.reason}`);
      process.exitCode = 1;
      break;
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
