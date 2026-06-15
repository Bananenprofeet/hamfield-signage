import type { FastifyInstance } from 'fastify';
import {
  clonePlaylistSchema,
  createPlaylistSchema,
  replacePlaylistItemsSchema,
  updatePlaylistSchema,
  PlaybackQueueEngine,
  resolveDisplaySettings,
  seededRng,
  type PreviewWarning,
  type ResolvedPreviewDto,
  type ResolvedPreviewItem,
  type ResolvedSampleEntry,
} from '@signage/shared';
import { z } from 'zod';
import { authenticateUser, requireOrgRole } from '../plugins/auth';
import { badRequest, conflict, notFound } from '../lib/errors';
import { presignDownload } from '../lib/s3';
import { writeAudit } from '../lib/audit';
import { isPlayable, resolvePlaylist } from '../lib/playlist-resolver';
import { serializePlaylist, serializePlaylistItem } from '../lib/serializers';

type OrgParams = { Params: { orgId: string } };
type PlaylistParams = { Params: { orgId: string; playlistId: string } };

const playlistInclude = {
  items: { include: { mediaAsset: true, folder: true }, orderBy: { position: 'asc' as const } },
  _count: { select: { items: true } },
};

export async function playlistRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, wsHub } = app;
  app.addHook('preHandler', authenticateUser);

  async function assertMediaInOrg(orgId: string, mediaIds: string[]): Promise<void> {
    if (mediaIds.length === 0) return;
    const count = await prisma.mediaAsset.count({
      where: { id: { in: mediaIds }, organizationId: orgId, deletedAt: null },
    });
    if (count !== new Set(mediaIds).size) {
      throw badRequest('One or more media items do not exist in this organization');
    }
  }

  async function assertFoldersInOrg(orgId: string, folderIds: string[]): Promise<void> {
    if (folderIds.length === 0) return;
    const count = await prisma.mediaFolder.count({
      where: { id: { in: folderIds }, organizationId: orgId, deletedAt: null },
    });
    if (count !== new Set(folderIds).size) {
      throw badRequest('One or more folders do not exist in this organization');
    }
  }

  type ItemInput = z.infer<typeof replacePlaylistItemsSchema>['items'][number];

  async function assertItemsInOrg(orgId: string, items: ItemInput[]): Promise<void> {
    await assertMediaInOrg(
      orgId,
      items.filter((i) => i.type === 'media').map((i) => i.mediaAssetId!),
    );
    await assertFoldersInOrg(
      orgId,
      items.filter((i) => i.type === 'folder').map((i) => i.folderId!),
    );
  }

  function itemCreateData(item: ItemInput, index: number) {
    return {
      type: item.type,
      mediaAssetId: item.type === 'media' ? item.mediaAssetId : null,
      folderId: item.type === 'folder' ? item.folderId : null,
      position: index,
      durationSeconds: item.durationSeconds,
      fitMode: item.fitMode,
      backgroundColor: item.backgroundColor ?? null,
      positionMode: item.positionMode ?? null,
      enabled: item.enabled,
      includeSubfolders: item.type === 'folder' ? item.includeSubfolders : false,
      filterMediaType: item.type === 'folder' ? (item.filterMediaType ?? null) : null,
      filterOrientation: item.type === 'folder' ? (item.filterOrientation ?? null) : null,
    };
  }

  app.get<OrgParams>('/orgs/:orgId/playlists', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'viewer');
    const playlists = await prisma.playlist.findMany({
      where: { organizationId: req.params.orgId, deletedAt: null },
      include: playlistInclude,
      orderBy: { name: 'asc' },
    });
    return playlists.map((p) => serializePlaylist(p));
  });

  app.post<OrgParams>('/orgs/:orgId/playlists', async (req, reply) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'editor');
    const body = createPlaylistSchema.parse(req.body);
    await assertItemsInOrg(req.params.orgId, body.items ?? []);

    const playlist = await prisma.playlist.create({
      data: {
        organizationId: req.params.orgId,
        name: body.name,
        description: body.description,
        loop: body.loop,
        defaultImageDurationSeconds: body.defaultImageDurationSeconds,
        playbackOrderMode: body.playbackOrderMode,
        defaultFitMode: body.defaultFitMode ?? null,
        defaultBackgroundColor: body.defaultBackgroundColor ?? null,
        defaultPositionMode: body.defaultPositionMode ?? null,
        createdByUserId: req.user!.id,
        items: body.items?.length
          ? { create: body.items.map((item, index) => itemCreateData(item, index)) }
          : undefined,
      },
      include: playlistInclude,
    });
    await wsHub.notifyOrgSyncRequired(req.params.orgId, 'playlist created');
    return reply.status(201).send(serializePlaylist(playlist, { includeItems: true }));
  });

  app.get<PlaylistParams>('/orgs/:orgId/playlists/:playlistId', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'viewer');
    const playlist = await prisma.playlist.findFirst({
      where: { id: req.params.playlistId, organizationId: req.params.orgId, deletedAt: null },
      include: playlistInclude,
    });
    if (!playlist) throw notFound('Playlist not found');

    const dto = serializePlaylist(playlist, { includeItems: true });
    // Attach thumbnails for the editor UI.
    if (dto.items) {
      dto.items = await Promise.all(
        playlist.items.map(async (item) =>
          serializePlaylistItem(item, {
            thumbnailUrl: item.mediaAsset?.thumbnailStorageKey
              ? await presignDownload(item.mediaAsset.thumbnailStorageKey)
              : null,
          }),
        ),
      );
    }
    return dto;
  });

  app.patch<PlaylistParams>('/orgs/:orgId/playlists/:playlistId', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'editor');
    const body = updatePlaylistSchema.parse(req.body);
    const playlist = await prisma.playlist.findFirst({
      where: { id: req.params.playlistId, organizationId: req.params.orgId, deletedAt: null },
    });
    if (!playlist) throw notFound('Playlist not found');

    const updated = await prisma.playlist.update({
      where: { id: playlist.id },
      data: {
        name: body.name,
        description: body.description,
        loop: body.loop,
        defaultImageDurationSeconds: body.defaultImageDurationSeconds,
        playbackOrderMode: body.playbackOrderMode,
        defaultFitMode: body.defaultFitMode,
        defaultBackgroundColor: body.defaultBackgroundColor,
        defaultPositionMode: body.defaultPositionMode,
      },
      include: playlistInclude,
    });
    await wsHub.notifyOrgSyncRequired(req.params.orgId, 'playlist updated');
    return serializePlaylist(updated, { includeItems: true });
  });

  app.put<PlaylistParams>('/orgs/:orgId/playlists/:playlistId/items', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'editor');
    const body = replacePlaylistItemsSchema.parse(req.body);
    const playlist = await prisma.playlist.findFirst({
      where: { id: req.params.playlistId, organizationId: req.params.orgId, deletedAt: null },
    });
    if (!playlist) throw notFound('Playlist not found');
    await assertItemsInOrg(req.params.orgId, body.items);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.playlistItem.deleteMany({ where: { playlistId: playlist.id } });
      if (body.items.length > 0) {
        await tx.playlistItem.createMany({
          data: body.items.map((item, index) => ({
            playlistId: playlist.id,
            ...itemCreateData(item, index),
          })),
        });
      }
      return tx.playlist.findUniqueOrThrow({
        where: { id: playlist.id },
        include: playlistInclude,
      });
    });

    await wsHub.notifyOrgSyncRequired(req.params.orgId, 'playlist items updated');
    return serializePlaylist(updated, { includeItems: true });
  });

  app.delete<PlaylistParams>('/orgs/:orgId/playlists/:playlistId', async (req, reply) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'editor');
    const playlist = await prisma.playlist.findFirst({
      where: { id: req.params.playlistId, organizationId: req.params.orgId, deletedAt: null },
    });
    if (!playlist) throw notFound('Playlist not found');

    const usedBySchedules = await prisma.schedule.count({
      where: { playlistId: playlist.id, deletedAt: null },
    });
    if (usedBySchedules > 0) {
      throw conflict('Playlist is used by one or more schedules; remove those first');
    }
    const usedAsDefault = await prisma.device.count({
      where: { defaultPlaylistId: playlist.id, deletedAt: null },
    });
    if (usedAsDefault > 0) {
      throw conflict('Playlist is the default playlist of one or more devices');
    }

    await prisma.playlist.update({
      where: { id: playlist.id },
      data: { deletedAt: new Date() },
    });
    await writeAudit(prisma, req, {
      action: 'playlist.delete',
      targetType: 'playlist',
      targetId: playlist.id,
      organizationId: req.params.orgId,
      metadata: { name: playlist.name },
    });
    await wsHub.notifyOrgSyncRequired(req.params.orgId, 'playlist deleted');
    return reply.status(204).send();
  });

  // ---------- Clone ----------

  app.post<PlaylistParams>('/orgs/:orgId/playlists/:playlistId/clone', async (req, reply) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'editor');
    const body = clonePlaylistSchema.parse(req.body ?? {});
    const source = await prisma.playlist.findFirst({
      where: { id: req.params.playlistId, organizationId: req.params.orgId, deletedAt: null },
      include: {
        items: { orderBy: { position: 'asc' } },
        priorityRules: {
          where: { deletedAt: null },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          include: { assignments: { orderBy: { createdAt: 'asc' } } },
        },
      },
    });
    if (!source) throw notFound('Playlist not found');

    // Copies settings, items, folder entries, priority rules and their
    // assignments — never schedules or playback history.
    const cloned = await prisma.$transaction(async (tx) => {
      const playlist = await tx.playlist.create({
        data: {
          organizationId: source.organizationId,
          name: body.name ?? `Copy of ${source.name}`.slice(0, 100),
          description: source.description,
          loop: source.loop,
          defaultImageDurationSeconds: source.defaultImageDurationSeconds,
          playbackOrderMode: source.playbackOrderMode,
          defaultFitMode: source.defaultFitMode,
          defaultBackgroundColor: source.defaultBackgroundColor,
          defaultPositionMode: source.defaultPositionMode,
          clonedFromPlaylistId: source.id,
          clonedAt: new Date(),
          createdByUserId: req.user!.id,
          items: {
            create: source.items.map((item) => ({
              type: item.type,
              mediaAssetId: item.mediaAssetId,
              folderId: item.folderId,
              position: item.position,
              durationSeconds: item.durationSeconds,
              fitMode: item.fitMode,
              backgroundColor: item.backgroundColor,
              positionMode: item.positionMode,
              enabled: item.enabled,
              includeSubfolders: item.includeSubfolders,
              filterMediaType: item.filterMediaType,
              filterOrientation: item.filterOrientation,
            })),
          },
        },
      });
      for (const rule of source.priorityRules) {
        await tx.playlistPriorityRule.create({
          data: {
            organizationId: source.organizationId,
            playlistId: playlist.id,
            name: rule.name,
            intervalCount: rule.intervalCount,
            selectionMode: rule.selectionMode,
            enabled: rule.enabled,
            position: rule.position,
            assignments: {
              create: rule.assignments.map((a) => ({
                organizationId: source.organizationId,
                mediaAssetId: a.mediaAssetId,
                folderId: a.folderId,
                includeSubfolders: a.includeSubfolders,
              })),
            },
          },
        });
      }
      return tx.playlist.findUniqueOrThrow({
        where: { id: playlist.id },
        include: playlistInclude,
      });
    });

    await writeAudit(prisma, req, {
      action: 'playlist.clone',
      targetType: 'playlist',
      targetId: cloned.id,
      organizationId: req.params.orgId,
      metadata: { sourcePlaylistId: source.id, name: cloned.name },
    });
    req.log.info({ sourceId: source.id, cloneId: cloned.id }, 'playlist cloned');
    return reply.status(201).send(serializePlaylist(cloned, { includeItems: true }));
  });

  // ---------- Resolved preview ----------

  const previewQuerySchema = z.object({
    /** Changing the seed regenerates the random sample. */
    seed: z.coerce.number().int().optional(),
    sampleSize: z.coerce.number().int().min(1).max(200).default(30),
  });

  app.get<PlaylistParams>('/orgs/:orgId/playlists/:playlistId/resolved-preview', async (req) => {
    await requireOrgRole(prisma, req, req.params.orgId, 'viewer');
    const query = previewQuerySchema.parse(req.query);

    const resolution = await resolvePlaylist(prisma, req.params.orgId, req.params.playlistId);
    if (!resolution) throw notFound('Playlist not found');
    const { playlist, items, entries, priorityRules, folderPaths } = resolution;

    const warnings: PreviewWarning[] = [];

    // Folder entries that currently resolve to nothing.
    for (const item of items) {
      if (item.type !== 'folder' || !item.enabled || !item.folderId) continue;
      const matches = entries.filter((e) => e.itemId === item.id);
      if (matches.length === 0) {
        const path = folderPaths.get(item.folderId) ?? item.folder?.name ?? 'deleted folder';
        warnings.push({
          kind: 'empty_folder',
          message: `Folder entry "${path}" currently matches no ready media`,
        });
      }
    }
    for (const item of items) {
      if (
        item.type === 'media' &&
        item.enabled &&
        (!item.mediaAsset || item.mediaAsset.deletedAt)
      ) {
        warnings.push({
          kind: 'missing_media',
          message: 'A playlist entry points at media that no longer exists',
        });
      }
    }

    const processing = entries.filter(
      (e) => e.media.processingStatus === 'pending' || e.media.processingStatus === 'processing',
    );
    if (processing.length > 0) {
      warnings.push({
        kind: 'processing_media',
        message: `${processing.length} item(s) are still processing and are skipped until ready`,
      });
    }
    const failed = entries.filter((e) => e.media.processingStatus === 'failed');
    if (failed.length > 0) {
      warnings.push({
        kind: 'failed_media',
        message: `${failed.length} item(s) failed processing and are skipped`,
      });
    }
    const portrait = entries.filter((e) => e.media.orientation === 'portrait').length;
    const landscape = entries.filter((e) => e.media.orientation === 'landscape').length;
    if (portrait > 0 && landscape > 0) {
      warnings.push({
        kind: 'orientation_mismatch',
        message: `Playlist mixes ${landscape} landscape and ${portrait} portrait item(s); some screens will letterbox content`,
      });
    }

    for (const { rule, media } of priorityRules) {
      if (rule.enabled && media.filter(isPlayable).length === 0) {
        warnings.push({
          kind: 'empty_priority_rule',
          message: `Priority rule "${rule.name}" has no playable media assigned and is ignored`,
        });
      }
    }
    if (
      playlist.playbackOrderMode !== 'random_with_priority_rules' &&
      priorityRules.some(({ rule }) => rule.enabled)
    ) {
      warnings.push({
        kind: 'disabled_priority_rules_inactive',
        message:
          'Priority rules only apply when the playback order mode is "random with priority rules"',
      });
    }

    // What devices will actually receive: playable entries only.
    const playable = entries.filter((e) => isPlayable(e.media));
    const durationOf = (entry: (typeof playable)[number]): number | null =>
      entry.durationSeconds ??
      (entry.media.mediaType === 'image'
        ? playlist.defaultImageDurationSeconds
        : entry.media.durationSeconds);
    let totalDuration: number | null = 0;
    for (const entry of playable) {
      const d = durationOf(entry);
      if (d == null) {
        totalDuration = null;
        break;
      }
      totalDuration += d;
    }

    // Sample sequence for the random modes (exact order for the others).
    let sample: ResolvedSampleEntry[] | null = null;
    if (
      playlist.playbackOrderMode === 'random' ||
      playlist.playbackOrderMode === 'random_with_priority_rules'
    ) {
      const mediaNames = new Map(playable.map((e) => [e.media.id, e.media.name]));
      const engine = new PlaybackQueueEngine({
        entries: playable.map((e) => ({ id: e.entryId, mediaId: e.media.id })),
        priorityRules:
          playlist.playbackOrderMode === 'random_with_priority_rules'
            ? priorityRules
                .filter(({ rule }) => rule.enabled)
                .map(({ rule, media }) => ({
                  id: rule.id,
                  name: rule.name,
                  intervalCount: rule.intervalCount,
                  selectionMode: rule.selectionMode as 'rotate' | 'random',
                  position: rule.position,
                  createdAt: rule.createdAt.toISOString(),
                  entries: media.filter(isPlayable).map((m) => {
                    mediaNames.set(m.id, m.name);
                    return { id: `rule-${rule.id}-${m.id}`, mediaId: m.id };
                  }),
                }))
            : [],
        rng: seededRng(query.seed ?? Math.floor(Math.random() * 2 ** 31)),
      });
      sample = [];
      for (let i = 0; i < query.sampleSize && engine.hasContent(); i++) {
        const next = engine.next();
        if (!next) break;
        sample.push({
          mediaId: next.entry.mediaId,
          name: mediaNames.get(next.entry.mediaId) ?? next.entry.mediaId,
          playedAs: next.playedAs,
          priorityRuleId: next.priorityRuleId,
          priorityRuleName: next.priorityRuleName,
        });
      }
    }

    const thumbnails = new Map<string, string | null>();
    const preview: ResolvedPreviewDto = {
      playlistId: playlist.id,
      playbackOrderMode: playlist.playbackOrderMode as ResolvedPreviewDto['playbackOrderMode'],
      resolvedCount: playable.length,
      totalDurationSeconds: totalDuration == null ? null : Math.round(totalDuration),
      items: await Promise.all(
        entries.map(async (entry) => {
          if (!thumbnails.has(entry.media.id)) {
            thumbnails.set(
              entry.media.id,
              entry.media.thumbnailStorageKey
                ? await presignDownload(entry.media.thumbnailStorageKey)
                : null,
            );
          }
          const display = resolveDisplaySettings(
            {
              fitMode: entry.fitMode,
              backgroundColor: entry.backgroundColor,
              positionMode: entry.positionMode,
            },
            {
              defaultFitMode: playlist.defaultFitMode,
              defaultBackgroundColor: playlist.defaultBackgroundColor,
              defaultPositionMode: playlist.defaultPositionMode,
            },
          );
          const displaySource: ResolvedPreviewItem['displaySource'] = entry.fitMode
            ? 'item'
            : playlist.defaultFitMode
              ? 'playlist_default'
              : 'platform_default';
          return {
            entryId: entry.entryId,
            mediaId: entry.media.id,
            name: entry.media.name,
            mediaType: entry.media.mediaType as 'image' | 'video',
            orientation: entry.media.orientation as 'landscape' | 'portrait' | 'square' | null,
            processingStatus: entry.media.processingStatus as
              | 'pending'
              | 'processing'
              | 'ready'
              | 'failed',
            durationSeconds: durationOf(entry),
            source: entry.source,
            sourceId:
              entry.source === 'folder' ? (entry.sourceFolderId ?? entry.itemId) : entry.itemId,
            sourceName: entry.source === 'folder' ? (entry.sourceFolderPath ?? null) : null,
            thumbnailUrl: thumbnails.get(entry.media.id),
            effectiveFitMode: display.fitMode,
            effectiveBackgroundColor: display.backgroundColor,
            effectivePositionMode: display.positionMode,
            displaySource,
          };
        }),
      ),
      sample,
      warnings,
    };
    return preview;
  });
}
