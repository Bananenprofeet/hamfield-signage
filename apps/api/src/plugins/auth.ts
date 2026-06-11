import type { FastifyReply, FastifyRequest } from 'fastify';
import type { OrgRole } from '@signage/shared';
import type { Device, PrismaClient } from '@signage/database';
import { roleSatisfies, verifyUserToken } from '../lib/auth';
import { hashDeviceToken } from '../lib/tokens';
import { forbidden, unauthorized } from '../lib/errors';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; email: string };
    device?: Device;
  }
}

/** preHandler: requires a valid user JWT (Authorization: Bearer ...). */
export async function authenticateUser(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized('Missing bearer token');
  const payload = verifyUserToken(header.slice(7));
  if (!payload) throw unauthorized('Invalid or expired token');
  req.user = { id: payload.sub, email: payload.email };
}

/**
 * Asserts the authenticated user is a member of the organization with at
 * least the given role. Returns the membership role.
 */
export async function requireOrgRole(
  prisma: PrismaClient,
  req: FastifyRequest,
  organizationId: string,
  minRole: OrgRole,
): Promise<OrgRole> {
  if (!req.user) throw unauthorized();
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId: req.user.id } },
  });
  if (!membership) throw forbidden('Not a member of this organization');
  if (!roleSatisfies(membership.role as OrgRole, minRole)) {
    throw forbidden(`Requires ${minRole} role`);
  }
  return membership.role as OrgRole;
}

/** preHandler factory: requires a valid, non-revoked device token. */
export function makeDeviceAuth(prisma: PrismaClient) {
  return async function authenticateDevice(req: FastifyRequest): Promise<void> {
    const header = req.headers.authorization;
    const queryToken = (req.query as Record<string, unknown> | undefined)?.token;
    const raw = header?.startsWith('Bearer ')
      ? header.slice(7)
      : typeof queryToken === 'string'
        ? queryToken
        : null;
    if (!raw) throw unauthorized('Missing device token');

    const tokenRecord = await prisma.deviceToken.findUnique({
      where: { tokenHash: hashDeviceToken(raw) },
      include: { device: true },
    });
    if (!tokenRecord || tokenRecord.revokedAt || tokenRecord.device.deletedAt) {
      throw unauthorized('Invalid or revoked device token');
    }

    // Touch lastUsedAt at most once a minute to avoid write amplification.
    if (!tokenRecord.lastUsedAt || Date.now() - tokenRecord.lastUsedAt.getTime() > 60_000) {
      await prisma.deviceToken.update({
        where: { id: tokenRecord.id },
        data: { lastUsedAt: new Date() },
      });
    }

    req.device = tokenRecord.device;
  };
}
