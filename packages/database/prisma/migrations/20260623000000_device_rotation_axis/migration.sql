-- Split the device "orientation" enum into two orthogonal axes:
--   * orientation: the logical content canvas shape (landscape | portrait)
--   * rotation:    software rotation (0/90/180/270) compensating for mounting
--
-- The legacy inverted_* values folded both concepts into one. Migrate them:
--   landscape          -> orientation landscape, rotation 0
--   portrait           -> orientation portrait,  rotation 90   (legacy player rotated 90°)
--   inverted_landscape -> orientation landscape, rotation 180
--   inverted_portrait  -> orientation portrait,  rotation 270

-- 1. New rotation column.
ALTER TABLE "Device" ADD COLUMN "rotation" INTEGER NOT NULL DEFAULT 0;

-- 2. Derive rotation from the legacy orientation value.
UPDATE "Device" SET "rotation" = CASE "orientation"
  WHEN 'portrait' THEN 90
  WHEN 'inverted_portrait' THEN 270
  WHEN 'inverted_landscape' THEN 180
  ELSE 0
END;

-- 3. Collapse inverted_* into their base content orientation.
UPDATE "Device" SET "orientation" = 'landscape' WHERE "orientation" = 'inverted_landscape';
UPDATE "Device" SET "orientation" = 'portrait' WHERE "orientation" = 'inverted_portrait';

-- 4. Recreate the enum without the inverted_* members (Postgres can't drop enum
--    values in place).
ALTER TYPE "DeviceOrientation" RENAME TO "DeviceOrientation_old";
CREATE TYPE "DeviceOrientation" AS ENUM ('landscape', 'portrait');
ALTER TABLE "Device" ALTER COLUMN "orientation" DROP DEFAULT;
ALTER TABLE "Device"
  ALTER COLUMN "orientation" TYPE "DeviceOrientation"
  USING ("orientation"::text::"DeviceOrientation");
ALTER TABLE "Device" ALTER COLUMN "orientation" SET DEFAULT 'landscape';
DROP TYPE "DeviceOrientation_old";
