import type { FastifyInstance } from 'fastify';
import { createFolderSchema, deleteFolderSchema, updateFolderSchema } from '@signage/shared';
import { authenticateUser, requireOrgRole } from '../plugins/auth';
import { badRequest, conflict, notFound } from '../lib/errors';
import { writeAudit } from '../lib/audit';
import { computeFolderPaths, loadFolders, wouldCreateCycle } from '../lib/folders';
import { computeFolderUsage } from '../lib/usage';
import { serializeFolder } from '../lib/serializers';

type OrgParams = { Params: { orgId: string } };
type FolderParams = { Params: { orgId: string; folderId: string } };

export async function mediaFolderRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, wsHub } = app;
  app.addHook('preHandler', authenticateUser);

  async function getFolder(orgId: string, folderId: string) {
    const folder = await prisma.mediaFolder.findFirst({
      where: { id: folderId, organizationId: orgId, deletedAt: null },
    });
    if (!folder) throw notFound('Folder not found');
    return folder;
  }

  async function assertNameFree(
    orgId: string,
    parentFolderId: string | null,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const clash = await prisma.mediaFolder.findFirst({
      where: {
        organizationId: orgId,
        parentFolderId,
        deletedAt: null,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (clash) throw conflict('A folder with this name already exists here');
  }

  // Flat folder list with computed paths and content counts; the dashboard
  // builds the tree client-side.
  app.get<OrgParams>('/orgs/:orgId/media/folders', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'viewer');
    const folders = await prisma.mediaFolder.findMany({
      where: { organizationId: req.params.orgId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
    const paths = computeFolderPaths(folders);

    const [mediaCounts, subfolderCounts] = await Promise.all([
      prisma.mediaAsset.groupBy({
        by: ['folderId'],
        where: { organizationId: req.params.orgId, deletedAt: null, folderId: { not: null } },
        _count: { _all: true },
      }),
      prisma.mediaFolder.groupBy({
        by: ['parentFolderId'],
        where: { organizationId: req.params.orgId, deletedAt: null, parentFolderId: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const mediaCountBy = new Map(mediaCounts.map((c) => [c.folderId, c._count._all]));
    const subfolderCountBy = new Map(subfolderCounts.map((c) => [c.parentFolderId, c._count._all]));

    return folders.map((folder) =>
      serializeFolder(folder, {
        path: paths.get(folder.id) ?? folder.name,
        mediaCount: mediaCountBy.get(folder.id) ?? 0,
        subfolderCount: subfolderCountBy.get(folder.id) ?? 0,
      }),
    );
  });

  app.post<OrgParams>('/orgs/:orgId/media/folders', async (req, reply) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'editor');
    const body = createFolderSchema.parse(req.body);

    const parentFolderId = body.parentFolderId ?? null;
    if (parentFolderId) await getFolder(req.params.orgId, parentFolderId);
    await assertNameFree(req.params.orgId, parentFolderId, body.name);

    const folder = await prisma.mediaFolder.create({
      data: {
        organizationId: req.params.orgId,
        parentFolderId,
        name: body.name,
        createdByUserId: req.user!.id,
      },
    });
    const paths = computeFolderPaths(await loadFolders(prisma, req.params.orgId));
    return reply
      .status(201)
      .send(serializeFolder(folder, { path: paths.get(folder.id) ?? folder.name }));
  });

  // Rename and/or move. Playlists reference folders by id, so neither
  // operation affects playlist content.
  app.patch<FolderParams>('/orgs/:orgId/media/folders/:folderId', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'editor');
    const body = updateFolderSchema.parse(req.body);
    const folder = await getFolder(req.params.orgId, req.params.folderId);

    let parentFolderId = folder.parentFolderId;
    if (body.parentFolderId !== undefined) {
      parentFolderId = body.parentFolderId;
      if (parentFolderId) {
        await getFolder(req.params.orgId, parentFolderId);
        const folders = await loadFolders(prisma, req.params.orgId);
        if (wouldCreateCycle(folders, folder.id, parentFolderId)) {
          throw badRequest('Cannot move a folder into itself or one of its subfolders');
        }
      }
    }
    const name = body.name ?? folder.name;
    await assertNameFree(req.params.orgId, parentFolderId, name, folder.id);

    const updated = await prisma.mediaFolder.update({
      where: { id: folder.id },
      data: { name, parentFolderId },
    });
    const paths = computeFolderPaths(await loadFolders(prisma, req.params.orgId));
    return serializeFolder(updated, { path: paths.get(updated.id) ?? updated.name });
  });

  // Safe-delete information shown in the confirmation dialog.
  app.get<FolderParams>('/orgs/:orgId/media/folders/:folderId/usage', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'viewer');
    await getFolder(req.params.orgId, req.params.folderId);
    const { descendantIds: _descendants, ...usage } = await computeFolderUsage(
      prisma,
      req.params.orgId,
      req.params.folderId,
    );
    return usage;
  });

  app.delete<FolderParams>('/orgs/:orgId/media/folders/:folderId', async (req, reply) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'editor');
    const body = deleteFolderSchema.parse(req.body ?? {});
    const folder = await getFolder(req.params.orgId, req.params.folderId);

    const usage = await computeFolderUsage(prisma, req.params.orgId, folder.id);
    const { descendantIds } = usage;

    let targetFolderId: string | null = null;
    if (body.strategy === 'move_to_folder') {
      if (!body.targetFolderId) throw badRequest('targetFolderId is required for move_to_folder');
      if (descendantIds.includes(body.targetFolderId)) {
        throw badRequest('Cannot move media into a folder that is being deleted');
      }
      targetFolderId = (await getFolder(req.params.orgId, body.targetFolderId)).id;
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      if (body.strategy === 'delete_media') {
        const mediaInside = await tx.mediaAsset.findMany({
          where: {
            organizationId: req.params.orgId,
            deletedAt: null,
            folderId: { in: descendantIds },
          },
          select: { id: true },
        });
        const mediaIds = mediaInside.map((m) => m.id);
        if (mediaIds.length > 0) {
          // Same conservative semantics as single media delete: soft delete,
          // drop direct playlist references, keep storage objects.
          await tx.mediaAsset.updateMany({
            where: { id: { in: mediaIds } },
            data: { deletedAt: now },
          });
          await tx.playlistItem.deleteMany({ where: { mediaAssetId: { in: mediaIds } } });
          await tx.playlistPriorityRuleAssignment.deleteMany({
            where: { mediaAssetId: { in: mediaIds } },
          });
        }
      } else {
        await tx.mediaAsset.updateMany({
          where: {
            organizationId: req.params.orgId,
            deletedAt: null,
            folderId: { in: descendantIds },
          },
          data: { folderId: targetFolderId },
        });
      }

      // Folder-based playlist entries and rule assignments lose their target.
      await tx.playlistItem.deleteMany({ where: { folderId: { in: descendantIds } } });
      await tx.playlistPriorityRuleAssignment.deleteMany({
        where: { folderId: { in: descendantIds } },
      });
      await tx.mediaFolder.updateMany({
        where: { id: { in: descendantIds } },
        data: { deletedAt: now },
      });
    });

    await writeAudit(prisma, req, {
      action: 'folder.delete',
      targetType: 'media_folder',
      targetId: folder.id,
      organizationId: req.params.orgId,
      metadata: {
        name: folder.name,
        strategy: body.strategy,
        targetFolderId,
        mediaCount: usage.mediaCount,
        subfolderCount: usage.subfolderCount,
        playlistRefs: usage.directPlaylistRefs.length,
      },
    });
    await wsHub.notifyOrgSyncRequired(req.params.orgId, 'folder deleted');
    req.log.info({ folderId: folder.id, strategy: body.strategy }, 'folder soft-deleted');
    return reply.status(204).send();
  });
}
