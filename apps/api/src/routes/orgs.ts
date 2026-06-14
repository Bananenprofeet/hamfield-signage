import type { FastifyInstance } from 'fastify';
import {
  addMemberSchema,
  createOrgSchema,
  updateMemberSchema,
  updateOrgSchema,
} from '@signage/shared';
import { authenticateUser, requireOrgRole, requireSuperadmin } from '../plugins/auth';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { writeAudit } from '../lib/audit';
import { serializeMember, serializeOrg } from '../lib/serializers';

export async function orgRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = app;
  app.addHook('preHandler', authenticateUser);

  app.get('/orgs', async (req) => {
    const memberships = await prisma.organizationMember.findMany({
      where: { userId: req.user!.id, organization: { deletedAt: null } },
      include: { organization: true },
    });
    return memberships.map((m) => serializeOrg(m.organization, m.role));
  });

  // Self-service organization signup was removed in v2: only superadmins
  // create organizations (see also the /superadmin routes).
  app.post('/orgs', async (req, reply) => {
    await requireSuperadmin(prisma, req);
    const body = createOrgSchema.parse(req.body);
    const slug = `${body.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)}-${Math.random().toString(36).slice(2, 8)}`;
    const org = await prisma.organization.create({
      data: {
        name: body.name,
        slug,
        members: { create: { userId: req.user!.id, role: 'owner' } },
      },
    });
    await writeAudit(prisma, req, {
      action: 'organization.create',
      targetType: 'organization',
      targetId: org.id,
      organizationId: org.id,
      actorGlobalRole: 'superadmin',
      metadata: { name: org.name },
    });
    return reply.status(201).send(serializeOrg(org, 'owner'));
  });

  app.get<{ Params: { orgId: string } }>('/orgs/:orgId', async (req) => {
    const role = await requireOrgRole(prisma, req, req.params.orgId, 'viewer');
    const org = await prisma.organization.findFirst({
      where: { id: req.params.orgId, deletedAt: null },
    });
    if (!org) throw notFound('Organization not found');
    return serializeOrg(org, role);
  });

  app.patch<{ Params: { orgId: string } }>('/orgs/:orgId', async (req) => {
    const role = await requireOrgRole(prisma, req, req.params.orgId, 'admin');
    const body = updateOrgSchema.parse(req.body);
    const org = await prisma.organization.update({
      where: { id: req.params.orgId },
      data: { name: body.name },
    });
    return serializeOrg(org, role);
  });

  app.get<{ Params: { orgId: string } }>('/orgs/:orgId/members', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'viewer');
    const members = await prisma.organizationMember.findMany({
      where: { organizationId: req.params.orgId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return members.map(serializeMember);
  });

  app.post<{ Params: { orgId: string } }>('/orgs/:orgId/members', async (req, reply) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'admin');
    const body = addMemberSchema.parse(req.body);
    if (body.role === 'owner')
      throw badRequest('Cannot grant the owner role; transfer ownership instead');

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user)
      throw notFound('No user exists with this email — ask a superadmin to create the account');

    const existing = await prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: req.params.orgId, userId: user.id } },
    });
    if (existing) throw conflict('User is already a member');

    const member = await prisma.organizationMember.create({
      data: { organizationId: req.params.orgId, userId: user.id, role: body.role },
      include: { user: true },
    });
    req.log.info(
      { orgId: req.params.orgId, userId: user.id, role: body.role },
      'org: member added',
    );
    return reply.status(201).send(serializeMember(member));
  });

  app.patch<{ Params: { orgId: string; memberId: string } }>(
    '/orgs/:orgId/members/:memberId',
    async (req) => {
      const actorRole = await requireOrgRole(prisma, req, req.params.orgId, 'admin');
      const body = updateMemberSchema.parse(req.body);

      const member = await prisma.organizationMember.findFirst({
        where: { id: req.params.memberId, organizationId: req.params.orgId },
        include: { user: true },
      });
      if (!member) throw notFound('Member not found');
      if (member.role === 'owner') throw forbidden('Cannot change the owner role');
      if (body.role === 'owner' && actorRole !== 'owner') {
        throw forbidden('Only the owner can transfer ownership');
      }

      const updated = await prisma.organizationMember.update({
        where: { id: member.id },
        data: { role: body.role },
        include: { user: true },
      });
      return serializeMember(updated);
    },
  );

  app.delete<{ Params: { orgId: string; memberId: string } }>(
    '/orgs/:orgId/members/:memberId',
    async (req, reply) => {
      await requireOrgRole(prisma, req, req.params.orgId, 'admin');
      const member = await prisma.organizationMember.findFirst({
        where: { id: req.params.memberId, organizationId: req.params.orgId },
      });
      if (!member) throw notFound('Member not found');
      if (member.role === 'owner') throw forbidden('Cannot remove the owner');
      await prisma.organizationMember.delete({ where: { id: member.id } });
      return reply.status(204).send();
    },
  );
}
