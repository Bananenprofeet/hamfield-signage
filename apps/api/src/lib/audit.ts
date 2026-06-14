import type { FastifyRequest } from 'fastify';
import type { Prisma, PrismaClient } from '@signage/database';

export interface AuditEntry {
  action: string;
  targetType: string;
  targetId?: string | null;
  organizationId?: string | null;
  actorUserId?: string | null;
  actorGlobalRole?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Records an audit log entry. Audit logging must never break the action it
 * documents, so failures are logged and swallowed. Never put passwords or
 * tokens in `metadata`.
 */
export async function writeAudit(
  prisma: PrismaClient,
  req: FastifyRequest,
  entry: AuditEntry,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        organizationId: entry.organizationId ?? null,
        actorUserId: entry.actorUserId ?? req.user?.id ?? null,
        actorGlobalRole: entry.actorGlobalRole ?? null,
        metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
        ipAddress: req.ip ?? null,
        userAgent: (req.headers['user-agent'] ?? '').slice(0, 500) || null,
      },
    });
  } catch (err) {
    req.log.warn({ err, action: entry.action }, 'audit log write failed');
  }
}
