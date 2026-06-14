import type { FastifyInstance } from 'fastify';
import {
  createPriorityRuleSchema,
  replacePriorityRuleAssignmentsSchema,
  updatePriorityRuleSchema,
} from '@signage/shared';
import type { z } from 'zod';
import { authenticateUser, requireOrgRole } from '../plugins/auth';
import { badRequest, notFound } from '../lib/errors';
import { writeAudit } from '../lib/audit';
import { computeFolderPaths, loadFolders } from '../lib/folders';
import { serializePriorityRule } from '../lib/serializers';

type PlaylistParams = { Params: { orgId: string; playlistId: string } };
type RuleParams = { Params: { orgId: string; playlistId: string; ruleId: string } };

const ruleInclude = {
  assignments: {
    orderBy: { createdAt: 'asc' as const },
    include: { mediaAsset: true, folder: true },
  },
};

export async function priorityRuleRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, wsHub } = app;
  app.addHook('preHandler', authenticateUser);

  async function getPlaylist(orgId: string, playlistId: string) {
    const playlist = await prisma.playlist.findFirst({
      where: { id: playlistId, organizationId: orgId, deletedAt: null },
    });
    if (!playlist) throw notFound('Playlist not found');
    return playlist;
  }

  async function getRule(orgId: string, playlistId: string, ruleId: string) {
    const rule = await prisma.playlistPriorityRule.findFirst({
      where: { id: ruleId, playlistId, organizationId: orgId, deletedAt: null },
    });
    if (!rule) throw notFound('Priority rule not found');
    return rule;
  }

  type AssignmentInput = z.infer<
    typeof replacePriorityRuleAssignmentsSchema
  >['assignments'][number];

  async function assertAssignmentsInOrg(
    orgId: string,
    assignments: AssignmentInput[],
  ): Promise<void> {
    const mediaIds = assignments.map((a) => a.mediaAssetId).filter((id): id is string => !!id);
    const folderIds = assignments.map((a) => a.folderId).filter((id): id is string => !!id);
    if (mediaIds.length > 0) {
      const count = await prisma.mediaAsset.count({
        where: { id: { in: mediaIds }, organizationId: orgId, deletedAt: null },
      });
      if (count !== new Set(mediaIds).size) {
        throw badRequest('One or more media items do not exist in this organization');
      }
    }
    if (folderIds.length > 0) {
      const count = await prisma.mediaFolder.count({
        where: { id: { in: folderIds }, organizationId: orgId, deletedAt: null },
      });
      if (count !== new Set(folderIds).size) {
        throw badRequest('One or more folders do not exist in this organization');
      }
    }
  }

  async function serializeWithPaths(orgId: string, ruleId: string) {
    const rule = await prisma.playlistPriorityRule.findUniqueOrThrow({
      where: { id: ruleId },
      include: ruleInclude,
    });
    const folderPaths = computeFolderPaths(await loadFolders(prisma, orgId));
    return serializePriorityRule(rule, folderPaths);
  }

  app.get<PlaylistParams>('/orgs/:orgId/playlists/:playlistId/priority-rules', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'viewer');
    await getPlaylist(req.params.orgId, req.params.playlistId);
    const rules = await prisma.playlistPriorityRule.findMany({
      where: {
        playlistId: req.params.playlistId,
        organizationId: req.params.orgId,
        deletedAt: null,
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: ruleInclude,
    });
    const folderPaths = computeFolderPaths(await loadFolders(prisma, req.params.orgId));
    return rules.map((rule) => serializePriorityRule(rule, folderPaths));
  });

  app.post<PlaylistParams>(
    '/orgs/:orgId/playlists/:playlistId/priority-rules',
    async (req, reply) => {
      await requireOrgRole(prisma, req, req.params.orgId, 'editor');
      const body = createPriorityRuleSchema.parse(req.body);
      const playlist = await getPlaylist(req.params.orgId, req.params.playlistId);
      await assertAssignmentsInOrg(req.params.orgId, body.assignments ?? []);

      const maxPosition = await prisma.playlistPriorityRule.aggregate({
        where: { playlistId: playlist.id, deletedAt: null },
        _max: { position: true },
      });
      const rule = await prisma.playlistPriorityRule.create({
        data: {
          organizationId: req.params.orgId,
          playlistId: playlist.id,
          name: body.name,
          intervalCount: body.intervalCount,
          selectionMode: body.selectionMode,
          enabled: body.enabled,
          position: body.position ?? (maxPosition._max.position ?? -1) + 1,
          assignments: body.assignments?.length
            ? {
                create: body.assignments.map((a) => ({
                  organizationId: req.params.orgId,
                  mediaAssetId: a.mediaAssetId ?? null,
                  folderId: a.folderId ?? null,
                  includeSubfolders: a.includeSubfolders,
                })),
              }
            : undefined,
        },
      });
      await writeAudit(prisma, req, {
        action: 'priority_rule.create',
        targetType: 'playlist_priority_rule',
        targetId: rule.id,
        organizationId: req.params.orgId,
        metadata: { playlistId: playlist.id, name: rule.name, intervalCount: rule.intervalCount },
      });
      await wsHub.notifyOrgSyncRequired(req.params.orgId, 'priority rules updated');
      return reply.status(201).send(await serializeWithPaths(req.params.orgId, rule.id));
    },
  );

  app.patch<RuleParams>(
    '/orgs/:orgId/playlists/:playlistId/priority-rules/:ruleId',
    async (req) => {
      await requireOrgRole(prisma, req, req.params.orgId, 'editor');
      const body = updatePriorityRuleSchema.parse(req.body);
      const rule = await getRule(req.params.orgId, req.params.playlistId, req.params.ruleId);

      await prisma.playlistPriorityRule.update({
        where: { id: rule.id },
        data: {
          name: body.name,
          intervalCount: body.intervalCount,
          selectionMode: body.selectionMode,
          enabled: body.enabled,
          position: body.position,
        },
      });
      await writeAudit(prisma, req, {
        action: 'priority_rule.update',
        targetType: 'playlist_priority_rule',
        targetId: rule.id,
        organizationId: req.params.orgId,
        metadata: { changes: body as Record<string, unknown> },
      });
      await wsHub.notifyOrgSyncRequired(req.params.orgId, 'priority rules updated');
      return serializeWithPaths(req.params.orgId, rule.id);
    },
  );

  app.delete<RuleParams>(
    '/orgs/:orgId/playlists/:playlistId/priority-rules/:ruleId',
    async (req, reply) => {
      await requireOrgRole(prisma, req, req.params.orgId, 'editor');
      const rule = await getRule(req.params.orgId, req.params.playlistId, req.params.ruleId);
      await prisma.playlistPriorityRule.update({
        where: { id: rule.id },
        data: { deletedAt: new Date() },
      });
      await writeAudit(prisma, req, {
        action: 'priority_rule.delete',
        targetType: 'playlist_priority_rule',
        targetId: rule.id,
        organizationId: req.params.orgId,
        metadata: { name: rule.name },
      });
      await wsHub.notifyOrgSyncRequired(req.params.orgId, 'priority rules updated');
      return reply.status(204).send();
    },
  );

  // Replaces the rule's assignments. The dashboard uses this to assign many
  // selected media files (or folders) to a rule in one call.
  app.put<RuleParams>(
    '/orgs/:orgId/playlists/:playlistId/priority-rules/:ruleId/assignments',
    async (req) => {
      await requireOrgRole(prisma, req, req.params.orgId, 'editor');
      const body = replacePriorityRuleAssignmentsSchema.parse(req.body);
      const rule = await getRule(req.params.orgId, req.params.playlistId, req.params.ruleId);
      await assertAssignmentsInOrg(req.params.orgId, body.assignments);

      await prisma.$transaction(async (tx) => {
        await tx.playlistPriorityRuleAssignment.deleteMany({
          where: { priorityRuleId: rule.id },
        });
        // Sequential creates keep createdAt ordering = rotation order.
        for (const assignment of body.assignments) {
          await tx.playlistPriorityRuleAssignment.create({
            data: {
              organizationId: req.params.orgId,
              priorityRuleId: rule.id,
              mediaAssetId: assignment.mediaAssetId ?? null,
              folderId: assignment.folderId ?? null,
              includeSubfolders: assignment.includeSubfolders,
            },
          });
        }
      });
      await writeAudit(prisma, req, {
        action: 'priority_rule.assignments_update',
        targetType: 'playlist_priority_rule',
        targetId: rule.id,
        organizationId: req.params.orgId,
        metadata: { assignmentCount: body.assignments.length },
      });
      await wsHub.notifyOrgSyncRequired(req.params.orgId, 'priority rules updated');
      return serializeWithPaths(req.params.orgId, rule.id);
    },
  );
}
