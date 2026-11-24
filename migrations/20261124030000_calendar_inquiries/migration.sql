-- AlterTable
ALTER TABLE "DateHold" ADD COLUMN     "challengeDeadline" TIMESTAMP(3),
ADD COLUMN     "challengedBy" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'show',
ADD COLUMN     "notes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "promoter" TEXT,
ADD COLUMN     "releasedReason" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Role" DROP COLUMN "canManageArtists",
ADD COLUMN     "canManageAdvance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canManageConnections" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canManageContacts" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canManageInquiries" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canManageInsurance" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canManagePrivateEvents" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canManageStaff" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "canManageVenueDeals" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StoreSettings" ADD COLUMN     "challengeBusinessDays" INTEGER DEFAULT 1,
ADD COLUMN     "challengeCountsWeekends" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "holdExpiryDays" INTEGER DEFAULT 7;

-- CreateTable
CREATE TABLE "Promoter" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL DEFAULT '',
    "contactName" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Promoter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inquiry" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'show',
    "name" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "company" TEXT NOT NULL DEFAULT '',
    "dateWanted" TIMESTAMP(3),
    "flexibleDates" BOOLEAN NOT NULL DEFAULT false,
    "room" TEXT,
    "guests" INTEGER,
    "eventType" TEXT NOT NULL DEFAULT '',
    "budgetCents" INTEGER,
    "message" TEXT NOT NULL DEFAULT '',
    "status" TEXT DEFAULT 'new',
    "lostReason" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT '',
    "promoter" TEXT,
    "handledBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Inquiry_room_idx" ON "Inquiry"("room");

-- CreateIndex
CREATE INDEX "Inquiry_promoter_idx" ON "Inquiry"("promoter");

-- CreateIndex
CREATE INDEX "Inquiry_handledBy_idx" ON "Inquiry"("handledBy");

-- CreateIndex
CREATE INDEX "DateHold_challengedBy_idx" ON "DateHold"("challengedBy");

-- CreateIndex
CREATE INDEX "DateHold_promoter_idx" ON "DateHold"("promoter");

-- AddForeignKey
ALTER TABLE "DateHold" ADD CONSTRAINT "DateHold_challengedBy_fkey" FOREIGN KEY ("challengedBy") REFERENCES "DateHold"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DateHold" ADD CONSTRAINT "DateHold_promoter_fkey" FOREIGN KEY ("promoter") REFERENCES "Promoter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_room_fkey" FOREIGN KEY ("room") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_promoter_fkey" FOREIGN KEY ("promoter") REFERENCES "Promoter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_handledBy_fkey" FOREIGN KEY ("handledBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One confirmed hold per room and day, whatever its kind (show, rental, private event, internal).
CREATE UNIQUE INDEX "DateHold_one_confirmed_per_day" ON "DateHold"("room", "date") WHERE "status" = 'confirmed';

-- Inquiry and hold vocabularies.
ALTER TABLE "Inquiry" ADD CONSTRAINT "venue_inquiry_status" CHECK ("status" IN ('new', 'in_progress', 'won', 'lost'));
ALTER TABLE "Inquiry" ADD CONSTRAINT "venue_inquiry_kind" CHECK ("kind" IN ('show', 'private_event'));
ALTER TABLE "DateHold" ADD CONSTRAINT "venue_datehold_kind" CHECK ("kind" IN ('show', 'rental', 'private_event', 'internal'));

