-- Display / fit-mode settings for media playback.
-- Additive only: new enum value, new enum type, and nullable columns.
-- Existing rows keep NULL (rendered as contain / #000000 / center).

-- New fit mode: scale down only (never upscales smaller media).
ALTER TYPE "FitMode" ADD VALUE IF NOT EXISTS 'scale_down';

-- Media alignment.
CREATE TYPE "PositionMode" AS ENUM (
  'center', 'top', 'bottom', 'left', 'right',
  'top_left', 'top_right', 'bottom_left', 'bottom_right'
);

-- Playlist-level display defaults.
ALTER TABLE "playlists" ADD COLUMN "defaultFitMode" "FitMode";
ALTER TABLE "playlists" ADD COLUMN "defaultBackgroundColor" TEXT;
ALTER TABLE "playlists" ADD COLUMN "defaultPositionMode" "PositionMode";

-- Playlist item display overrides (fitMode already exists).
ALTER TABLE "playlist_items" ADD COLUMN "backgroundColor" TEXT;
ALTER TABLE "playlist_items" ADD COLUMN "positionMode" "PositionMode";

-- Emergency single-media display settings.
ALTER TABLE "emergency_overrides" ADD COLUMN "fitMode" "FitMode";
ALTER TABLE "emergency_overrides" ADD COLUMN "backgroundColor" TEXT;
ALTER TABLE "emergency_overrides" ADD COLUMN "positionMode" "PositionMode";
