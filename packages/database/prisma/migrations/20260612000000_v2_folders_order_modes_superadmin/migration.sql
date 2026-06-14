-- CreateEnum
CREATE TYPE "GlobalRole" AS ENUM ('user', 'superadmin');

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "PlaybackOrderMode" AS ENUM ('manual_order', 'alphabetical', 'random', 'random_with_priority_rules');

-- CreateEnum
CREATE TYPE "PlaylistItemType" AS ENUM ('media', 'folder');

-- CreateEnum
CREATE TYPE "PrioritySelectionMode" AS ENUM ('rotate', 'random');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "globalRole" "GlobalRole" NOT NULL DEFAULT 'user',
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "maxDevices" INTEGER,
ADD COLUMN     "maxStorageGb" INTEGER,
ADD COLUMN     "planName" TEXT,
ADD COLUMN     "status" "OrgStatus" NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE "media_assets" ADD COLUMN     "folderId" TEXT;

-- AlterTable
ALTER TABLE "playlists" ADD COLUMN     "clonedAt" TIMESTAMP(3),
ADD COLUMN     "clonedFromPlaylistId" TEXT,
ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "playbackOrderMode" "PlaybackOrderMode" NOT NULL DEFAULT 'manual_order';

-- AlterTable
ALTER TABLE "playlist_items" ADD COLUMN     "filterMediaType" "MediaType",
ADD COLUMN     "filterOrientation" "MediaOrientation",
ADD COLUMN     "folderId" TEXT,
ADD COLUMN     "includeSubfolders" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "type" "PlaylistItemType" NOT NULL DEFAULT 'media',
ALTER COLUMN "mediaAssetId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "playback_events" ADD COLUMN     "clientEventId" TEXT,
ADD COLUMN     "durationSeconds" DOUBLE PRECISION,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "playedAs" TEXT,
ADD COLUMN     "priorityRuleId" TEXT;

-- CreateTable
CREATE TABLE "media_folders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "parentFolderId" TEXT,
    "name" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "media_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playlist_priority_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intervalCount" INTEGER NOT NULL,
    "selectionMode" "PrioritySelectionMode" NOT NULL DEFAULT 'rotate',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "playlist_priority_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playlist_priority_rule_assignments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "priorityRuleId" TEXT NOT NULL,
    "mediaAssetId" TEXT,
    "folderId" TEXT,
    "includeSubfolders" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "playlist_priority_rule_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorGlobalRole" TEXT,
    "organizationId" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "media_folders_organizationId_parentFolderId_deletedAt_idx" ON "media_folders"("organizationId", "parentFolderId", "deletedAt");

-- CreateIndex
CREATE INDEX "playlist_priority_rules_playlistId_deletedAt_idx" ON "playlist_priority_rules"("playlistId", "deletedAt");

-- CreateIndex
CREATE INDEX "playlist_priority_rule_assignments_priorityRuleId_idx" ON "playlist_priority_rule_assignments"("priorityRuleId");

-- CreateIndex
CREATE INDEX "playlist_priority_rule_assignments_mediaAssetId_idx" ON "playlist_priority_rule_assignments"("mediaAssetId");

-- CreateIndex
CREATE INDEX "playlist_priority_rule_assignments_folderId_idx" ON "playlist_priority_rule_assignments"("folderId");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "media_assets_organizationId_folderId_deletedAt_idx" ON "media_assets"("organizationId", "folderId", "deletedAt");

-- CreateIndex
CREATE INDEX "playlist_items_folderId_idx" ON "playlist_items"("folderId");

-- CreateIndex
CREATE INDEX "playback_events_organizationId_mediaAssetId_eventType_occur_idx" ON "playback_events"("organizationId", "mediaAssetId", "eventType", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "playback_events_deviceId_clientEventId_key" ON "playback_events"("deviceId", "clientEventId");

-- AddForeignKey
ALTER TABLE "media_folders" ADD CONSTRAINT "media_folders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_folders" ADD CONSTRAINT "media_folders_parentFolderId_fkey" FOREIGN KEY ("parentFolderId") REFERENCES "media_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_folders" ADD CONSTRAINT "media_folders_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "media_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_clonedFromPlaylistId_fkey" FOREIGN KEY ("clonedFromPlaylistId") REFERENCES "playlists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "media_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_priority_rules" ADD CONSTRAINT "playlist_priority_rules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_priority_rules" ADD CONSTRAINT "playlist_priority_rules_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "playlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_priority_rule_assignments" ADD CONSTRAINT "playlist_priority_rule_assignments_priorityRuleId_fkey" FOREIGN KEY ("priorityRuleId") REFERENCES "playlist_priority_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_priority_rule_assignments" ADD CONSTRAINT "playlist_priority_rule_assignments_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_priority_rule_assignments" ADD CONSTRAINT "playlist_priority_rule_assignments_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "media_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: attribute existing playback events to the owning organization via the device.
UPDATE "playback_events" pe
SET "organizationId" = d."organizationId"
FROM "devices" d
WHERE pe."deviceId" = d."id" AND pe."organizationId" IS NULL;
