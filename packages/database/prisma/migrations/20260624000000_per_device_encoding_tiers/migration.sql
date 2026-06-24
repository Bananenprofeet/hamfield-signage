-- Per-device encoding tiers.
-- Additive only: a new enum, new enum values and nullable/defaulted columns.
-- Existing devices default to the `standard` tier (= today's processed file),
-- so playback is unchanged after upgrade.

-- Video quality tier served to a device.
CREATE TYPE "PlaybackProfile" AS ENUM ('high', 'standard', 'light');

-- Non-standard tiers are stored as MediaVariant rows keyed by tier.
ALTER TYPE "MediaVariantKind" ADD VALUE IF NOT EXISTS 'video_high';
ALTER TYPE "MediaVariantKind" ADD VALUE IF NOT EXISTS 'video_standard';
ALTER TYPE "MediaVariantKind" ADD VALUE IF NOT EXISTS 'video_light';

-- Device tier selection + reported board model (auto-suggests the tier).
ALTER TABLE "devices" ADD COLUMN "deviceModel" TEXT;
ALTER TABLE "devices" ADD COLUMN "playbackProfile" "PlaybackProfile" NOT NULL DEFAULT 'standard';
