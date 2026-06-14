/**
 * Resets the password of an existing superadmin account.
 *
 * Usage:
 *   pnpm app:reset-superadmin-password -- <email> <new-password>
 */
import { getPrisma, disconnectPrisma } from '@signage/database';
import { resetSuperadminPassword } from '../lib/superadmin';

async function main(): Promise<void> {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Usage: pnpm app:reset-superadmin-password -- <email> <new-password>');
    process.exitCode = 1;
    return;
  }
  await resetSuperadminPassword(getPrisma(), email, password);
  console.log(`Password updated for superadmin ${email}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
