import type { PrismaClient } from '@signage/database';
import { superadminPasswordSchema } from '@signage/shared';
import { hashPassword } from './auth';

export type BootstrapResult =
  | { status: 'created'; email: string }
  | { status: 'exists' }
  | { status: 'skipped'; reason: string }
  | { status: 'invalid'; reason: string };

/**
 * Creates the initial superadmin account when none exists yet.
 * Idempotent: an existing superadmin is never overwritten. The password is
 * never logged — callers must only log the returned status.
 */
export async function bootstrapSuperadmin(
  prisma: PrismaClient,
  input: { email?: string; password?: string; name?: string },
): Promise<BootstrapResult> {
  const existing = await prisma.user.findFirst({
    where: { globalRole: 'superadmin' },
    select: { id: true },
  });
  if (existing) return { status: 'exists' };

  if (!input.email || !input.password || !input.name) {
    return {
      status: 'skipped',
      reason: 'no superadmin exists and INITIAL_SUPERADMIN_EMAIL/_PASSWORD/_NAME are not (all) set',
    };
  }

  const password = superadminPasswordSchema.safeParse(input.password);
  if (!password.success) {
    return { status: 'invalid', reason: 'superadmin password must be at least 12 characters' };
  }

  const passwordHash = await hashPassword(input.password);
  const emailTaken = await prisma.user.findUnique({ where: { email: input.email } });
  if (emailTaken) {
    // Promote the existing account instead of failing the install.
    await prisma.user.update({
      where: { id: emailTaken.id },
      data: { globalRole: 'superadmin' },
    });
    return { status: 'created', email: input.email };
  }

  await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash,
      globalRole: 'superadmin',
      mustChangePassword: false,
    },
  });
  return { status: 'created', email: input.email };
}

/** Sets a new password for the superadmin with the given email. */
export async function resetSuperadminPassword(
  prisma: PrismaClient,
  email: string,
  newPassword: string,
): Promise<void> {
  const parsed = superadminPasswordSchema.safeParse(newPassword);
  if (!parsed.success) throw new Error('Password must be at least 12 characters');
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.globalRole !== 'superadmin') {
    throw new Error(`No superadmin account exists with email ${email}`);
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword), disabledAt: null },
  });
}
