-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('owner', 'admin', 'editor', 'viewer');

-- CreateEnum
CREATE TYPE "DeviceOrientation" AS ENUM ('landscape', 'portrait', 'inverted_landscape', 'inverted_portrait');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('image', 'video');

-- CreateEnum
CREATE TYPE "MediaOrientation" AS ENUM ('landscape', 'portrait', 'square');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('pending', 'processing', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "MediaVariantKind" AS ENUM ('original', 'processed', 'fallback', 'thumbnail');

-- CreateEnum
CREATE TYPE "FitMode" AS ENUM ('contain', 'cover', 'stretch', 'original');

-- CreateEnum
CREATE TYPE "CommandStatus" AS ENUM ('pending', 'sent', 'acked', 'completed', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "SyncStatusValue" AS ENUM ('never_synced', 'in_sync', 'syncing', 'error');

-- CreateEnum
CREATE TYPE "PlaybackEventType" AS ENUM ('start', 'end', 'error', 'skip');

-- CreateEnum
CREATE TYPE "ProcessingJobStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "orientation" "DeviceOrientation" NOT NULL DEFAULT 'landscape',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "pairingCode" TEXT,
    "pairingCodeExpiresAt" TIMESTAMP(3),
    "pairedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "lastIp" TEXT,
    "appVersion" TEXT,
    "osInfo" TEXT,
    "archInfo" TEXT,
    "uptimeSeconds" DOUBLE PRECISION,
    "cpuPercent" DOUBLE PRECISION,
    "memUsedBytes" BIGINT,
    "memTotalBytes" BIGINT,
    "diskFreeBytes" BIGINT,
    "diskTotalBytes" BIGINT,
    "cacheUsedBytes" BIGINT,
    "screenWidth" INTEGER,
    "screenHeight" INTEGER,
    "networkType" TEXT,
    "lastError" TEXT,
    "syncStatus" "SyncStatusValue" NOT NULL DEFAULT 'never_synced',
    "lastSyncAt" TIMESTAMP(3),
    "manifestVersion" TEXT,
    "currentPlaylistId" TEXT,
    "currentMediaId" TEXT,
    "defaultPlaylistId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "name" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_groups" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "device_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_group_memberships" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_group_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mediaType" "MediaType" NOT NULL,
    "originalMimeType" TEXT NOT NULL,
    "processedMimeType" TEXT,
    "originalStorageKey" TEXT NOT NULL,
    "processedStorageKey" TEXT,
    "thumbnailStorageKey" TEXT,
    "durationSeconds" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "orientation" "MediaOrientation",
    "processingStatus" "ProcessingStatus" NOT NULL DEFAULT 'pending',
    "processingError" TEXT,
    "sizeBytes" BIGINT,
    "processedSizeBytes" BIGINT,
    "checksumSha256" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_variants" (
    "id" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "kind" "MediaVariantKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "bitrateKbps" INTEGER,
    "sizeBytes" BIGINT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_processing_jobs" (
    "id" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "status" "ProcessingJobStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_processing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playlists" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "loop" BOOLEAN NOT NULL DEFAULT true,
    "defaultImageDurationSeconds" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "playlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playlist_items" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "durationSeconds" DOUBLE PRECISION,
    "fitMode" "FitMode",
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "playlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "startDate" TEXT,
    "endDate" TEXT,
    "daysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "startTime" TEXT,
    "endTime" TEXT,
    "timezone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_device_assignments" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_device_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_group_assignments" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_group_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_overrides" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT,
    "playlistId" TEXT,
    "mediaAssetId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "appliesToAll" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emergency_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_override_devices" (
    "id" TEXT NOT NULL,
    "overrideId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_override_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_override_groups" (
    "id" TEXT NOT NULL,
    "overrideId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_override_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_commands" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "CommandStatus" NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "createdByUserId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "ackedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_heartbeats" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_heartbeats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_logs" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "loggedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "playback_events" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "mediaAssetId" TEXT,
    "playlistId" TEXT,
    "eventType" "PlaybackEventType" NOT NULL,
    "detail" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "playback_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_screenshots" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_screenshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organization_members_userId_idx" ON "organization_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organizationId_userId_key" ON "organization_members"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "devices_pairingCode_key" ON "devices"("pairingCode");

-- CreateIndex
CREATE INDEX "devices_organizationId_deletedAt_idx" ON "devices"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "devices_organizationId_name_idx" ON "devices"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_tokenHash_key" ON "device_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "device_tokens_deviceId_idx" ON "device_tokens"("deviceId");

-- CreateIndex
CREATE INDEX "device_groups_organizationId_deletedAt_idx" ON "device_groups"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "device_group_memberships_groupId_idx" ON "device_group_memberships"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "device_group_memberships_deviceId_groupId_key" ON "device_group_memberships"("deviceId", "groupId");

-- CreateIndex
CREATE INDEX "media_assets_organizationId_deletedAt_mediaType_idx" ON "media_assets"("organizationId", "deletedAt", "mediaType");

-- CreateIndex
CREATE INDEX "media_assets_organizationId_processingStatus_idx" ON "media_assets"("organizationId", "processingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "media_variants_mediaAssetId_kind_key" ON "media_variants"("mediaAssetId", "kind");

-- CreateIndex
CREATE INDEX "media_processing_jobs_mediaAssetId_status_idx" ON "media_processing_jobs"("mediaAssetId", "status");

-- CreateIndex
CREATE INDEX "playlists_organizationId_deletedAt_idx" ON "playlists"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "playlist_items_playlistId_position_idx" ON "playlist_items"("playlistId", "position");

-- CreateIndex
CREATE INDEX "playlist_items_mediaAssetId_idx" ON "playlist_items"("mediaAssetId");

-- CreateIndex
CREATE INDEX "schedules_organizationId_deletedAt_enabled_idx" ON "schedules"("organizationId", "deletedAt", "enabled");

-- CreateIndex
CREATE INDEX "schedule_device_assignments_deviceId_idx" ON "schedule_device_assignments"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_device_assignments_scheduleId_deviceId_key" ON "schedule_device_assignments"("scheduleId", "deviceId");

-- CreateIndex
CREATE INDEX "schedule_group_assignments_groupId_idx" ON "schedule_group_assignments"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_group_assignments_scheduleId_groupId_key" ON "schedule_group_assignments"("scheduleId", "groupId");

-- CreateIndex
CREATE INDEX "emergency_overrides_organizationId_active_idx" ON "emergency_overrides"("organizationId", "active");

-- CreateIndex
CREATE INDEX "emergency_override_devices_deviceId_idx" ON "emergency_override_devices"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_override_devices_overrideId_deviceId_key" ON "emergency_override_devices"("overrideId", "deviceId");

-- CreateIndex
CREATE INDEX "emergency_override_groups_groupId_idx" ON "emergency_override_groups"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_override_groups_overrideId_groupId_key" ON "emergency_override_groups"("overrideId", "groupId");

-- CreateIndex
CREATE INDEX "device_commands_deviceId_status_idx" ON "device_commands"("deviceId", "status");

-- CreateIndex
CREATE INDEX "device_commands_deviceId_createdAt_idx" ON "device_commands"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "device_heartbeats_deviceId_createdAt_idx" ON "device_heartbeats"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "device_logs_deviceId_loggedAt_idx" ON "device_logs"("deviceId", "loggedAt");

-- CreateIndex
CREATE INDEX "playback_events_deviceId_occurredAt_idx" ON "playback_events"("deviceId", "occurredAt");

-- CreateIndex
CREATE INDEX "device_screenshots_deviceId_createdAt_idx" ON "device_screenshots"("deviceId", "createdAt");

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_defaultPlaylistId_fkey" FOREIGN KEY ("defaultPlaylistId") REFERENCES "playlists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_groups" ADD CONSTRAINT "device_groups_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_group_memberships" ADD CONSTRAINT "device_group_memberships_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_group_memberships" ADD CONSTRAINT "device_group_memberships_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "device_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_variants" ADD CONSTRAINT "media_variants_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_processing_jobs" ADD CONSTRAINT "media_processing_jobs_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "playlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "playlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_device_assignments" ADD CONSTRAINT "schedule_device_assignments_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_device_assignments" ADD CONSTRAINT "schedule_device_assignments_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_group_assignments" ADD CONSTRAINT "schedule_group_assignments_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_group_assignments" ADD CONSTRAINT "schedule_group_assignments_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "device_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_overrides" ADD CONSTRAINT "emergency_overrides_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_overrides" ADD CONSTRAINT "emergency_overrides_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "playlists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_overrides" ADD CONSTRAINT "emergency_overrides_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_overrides" ADD CONSTRAINT "emergency_overrides_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_override_devices" ADD CONSTRAINT "emergency_override_devices_overrideId_fkey" FOREIGN KEY ("overrideId") REFERENCES "emergency_overrides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_override_devices" ADD CONSTRAINT "emergency_override_devices_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_override_groups" ADD CONSTRAINT "emergency_override_groups_overrideId_fkey" FOREIGN KEY ("overrideId") REFERENCES "emergency_overrides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_override_groups" ADD CONSTRAINT "emergency_override_groups_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "device_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_heartbeats" ADD CONSTRAINT "device_heartbeats_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_logs" ADD CONSTRAINT "device_logs_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playback_events" ADD CONSTRAINT "playback_events_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "playback_events" ADD CONSTRAINT "playback_events_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_screenshots" ADD CONSTRAINT "device_screenshots_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

