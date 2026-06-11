import type { FastifyInstance } from 'fastify';
import { createDeviceGroupSchema, updateDeviceGroupSchema } from '@signage/shared';
import { authenticateUser, requireOrgRole } from '../plugins/auth';
import { notFound } from '../lib/errors';
import { serializeGroup } from '../lib/serializers';

type OrgParams = { Params: { orgId: string } };
type GroupParams = { Params: { orgId: string; groupId: string } };

export async function deviceGroupRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, wsHub } = app;
  app.addHook('preHandler', authenticateUser);

  app.get<OrgParams>('/orgs/:orgId/device-groups', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'viewer');
    const groups = await prisma.deviceGroup.findMany({
      where: { organizationId: req.params.orgId, deletedAt: null },
      include: { _count: { select: { memberships: true } } },
      orderBy: { name: 'asc' },
    });
    return groups.map(serializeGroup);
  });

  app.post<OrgParams>('/orgs/:orgId/device-groups', async (req, reply) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'editor');
    const body = createDeviceGroupSchema.parse(req.body);

    const validDeviceIds = body.deviceIds?.length
      ? (
          await prisma.device.findMany({
            where: {
              id: { in: body.deviceIds },
              organizationId: req.params.orgId,
              deletedAt: null,
            },
            select: { id: true },
          })
        ).map((d) => d.id)
      : [];

    const group = await prisma.deviceGroup.create({
      data: {
        organizationId: req.params.orgId,
        name: body.name,
        description: body.description,
        memberships: { create: validDeviceIds.map((deviceId) => ({ deviceId })) },
      },
      include: { _count: { select: { memberships: true } } },
    });
    return reply.status(201).send(serializeGroup(group));
  });

  app.get<GroupParams>('/orgs/:orgId/device-groups/:groupId', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'viewer');
    const group = await prisma.deviceGroup.findFirst({
      where: { id: req.params.groupId, organizationId: req.params.orgId, deletedAt: null },
      include: {
        _count: { select: { memberships: true } },
        memberships: { select: { deviceId: true } },
      },
    });
    if (!group) throw notFound('Group not found');
    return { ...serializeGroup(group), deviceIds: group.memberships.map((m) => m.deviceId) };
  });

  app.patch<GroupParams>('/orgs/:orgId/device-groups/:groupId', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'editor');
    const body = updateDeviceGroupSchema.parse(req.body);
    const group = await prisma.deviceGroup.findFirst({
      where: { id: req.params.groupId, organizationId: req.params.orgId, deletedAt: null },
    });
    if (!group) throw notFound('Group not found');

    const updated = await prisma.$transaction(async (tx) => {
      if (body.deviceIds) {
        const valid = await tx.device.findMany({
          where: { id: { in: body.deviceIds }, organizationId: req.params.orgId, deletedAt: null },
          select: { id: true },
        });
        await tx.deviceGroupMembership.deleteMany({ where: { groupId: group.id } });
        await tx.deviceGroupMembership.createMany({
          data: valid.map((d) => ({ groupId: group.id, deviceId: d.id })),
        });
      }
      return tx.deviceGroup.update({
        where: { id: group.id },
        data: { name: body.name, description: body.description },
        include: { _count: { select: { memberships: true } } },
      });
    });

    await wsHub.notifyOrgSyncRequired(req.params.orgId, 'device group changed');
    return serializeGroup(updated);
  });

  app.delete<GroupParams>('/orgs/:orgId/device-groups/:groupId', async (req, reply) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'editor');
    const group = await prisma.deviceGroup.findFirst({
      where: { id: req.params.groupId, organizationId: req.params.orgId, deletedAt: null },
    });
    if (!group) throw notFound('Group not found');
    await prisma.deviceGroup.update({
      where: { id: group.id },
      data: { deletedAt: new Date() },
    });
    await prisma.deviceGroupMembership.deleteMany({ where: { groupId: group.id } });
    await wsHub.notifyOrgSyncRequired(req.params.orgId, 'device group deleted');
    return reply.status(204).send();
  });
}
