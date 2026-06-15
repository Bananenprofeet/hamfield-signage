-- Organization branding (logo) support.
-- Additive only: all columns are nullable, no existing data is changed.

ALTER TABLE "organizations" ADD COLUMN "logoStorageKey" TEXT;
ALTER TABLE "organizations" ADD COLUMN "logoMimeType" TEXT;
ALTER TABLE "organizations" ADD COLUMN "logoOriginalFilename" TEXT;
ALTER TABLE "organizations" ADD COLUMN "logoSizeBytes" INTEGER;
ALTER TABLE "organizations" ADD COLUMN "logoUpdatedAt" TIMESTAMP(3);
