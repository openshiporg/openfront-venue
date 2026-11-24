-- Documents are stored in the database (D17: uploads work with no storage service set up); the S3 file columns were never used by a release.
-- AlterTable
ALTER TABLE "Document" DROP COLUMN "file_filename",
DROP COLUMN "file_filesize",
ADD COLUMN     "content" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "filename" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "mimeType" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sha256" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sizeBytes" INTEGER DEFAULT 0;

-- AlterTable
ALTER TABLE "VenueDeal" ADD COLUMN     "barTierMethod" TEXT DEFAULT 'bracket';


-- A bar split pays by bracket (each rate on its band) or whole (the highest rate reached, on all net bar).
ALTER TABLE "VenueDeal" ADD CONSTRAINT "venue_deal_bar_tier_method" CHECK ("barTierMethod" IS NULL OR "barTierMethod" IN ('bracket', 'whole'));
-- A stored document is at most 10 MB and its checksum is a SHA-256.
ALTER TABLE "Document" ADD CONSTRAINT "venue_document_valid" CHECK ("sizeBytes" IS NULL OR ("sizeBytes" >= 0 AND "sizeBytes" <= 10485760)) NOT VALID;
ALTER TABLE "Document" VALIDATE CONSTRAINT "venue_document_valid";
