-- DropForeignKey
ALTER TABLE "Event" DROP CONSTRAINT "Event_promoter_fkey";

-- AlterTable
ALTER TABLE "BarSales" ADD COLUMN     "compsCents" INTEGER DEFAULT 0,
ADD COLUMN     "netCents" INTEGER DEFAULT 0,
ADD COLUMN     "recordedBy" TEXT,
ADD COLUMN     "report" TEXT,
ADD COLUMN     "taxCents" INTEGER DEFAULT 0,
ADD COLUMN     "voidsCents" INTEGER DEFAULT 0;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "bookedBy" TEXT;

-- Event.promoter used to mean the staff user who booked the date. That moves to bookedBy; promoter now points at a Promoter.
UPDATE "Event" SET "bookedBy" = "promoter" WHERE "promoter" IS NOT NULL;
UPDATE "Event" SET "promoter" = h."promoter" FROM "DateHold" h WHERE h."event" = "Event"."id" AND h."promoter" IS NOT NULL;
UPDATE "Event" SET "promoter" = NULL WHERE "promoter" IS NOT NULL AND "promoter" NOT IN (SELECT "id" FROM "Promoter");

-- AlterTable
ALTER TABLE "Settlement" ADD COLUMN     "balanceDuePromoterCents" INTEGER DEFAULT 0,
ADD COLUMN     "party" TEXT DEFAULT 'artist',
ADD COLUMN     "venueDeal" TEXT;

-- AlterTable
ALTER TABLE "SettlementLine" ADD COLUMN     "rule" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "_ChartSection_priceLevel_sections" ADD CONSTRAINT "_ChartSection_priceLevel_sections_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_ChartSection_priceLevel_sections_AB_unique";

-- AlterTable
ALTER TABLE "_InventoryHold_seats" ADD CONSTRAINT "_InventoryHold_seats_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_InventoryHold_seats_AB_unique";

-- AlterTable
ALTER TABLE "_PriceLevel_promoCode_priceLevels" ADD CONSTRAINT "_PriceLevel_promoCode_priceLevels_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_PriceLevel_promoCode_priceLevels_AB_unique";

-- AlterTable
ALTER TABLE "_ProductionHold_seats" ADD CONSTRAINT "_ProductionHold_seats_AB_pkey" PRIMARY KEY ("A", "B");

-- DropIndex
DROP INDEX "_ProductionHold_seats_AB_unique";

-- CreateTable
CREATE TABLE "VenueDeal" (
    "id" TEXT NOT NULL,
    "event" TEXT,
    "hold" TEXT,
    "promoter" TEXT,
    "version" INTEGER DEFAULT 1,
    "status" TEXT DEFAULT 'draft',
    "dealType" TEXT DEFAULT 'rental',
    "rentMode" TEXT DEFAULT 'flat',
    "rentCents" INTEGER DEFAULT 0,
    "rentPercentBps" INTEGER DEFAULT 0,
    "rentBase" TEXT NOT NULL DEFAULT '',
    "rentBaseKind" TEXT DEFAULT 'net_of_tax_and_fees',
    "coProMode" TEXT DEFAULT 'upside',
    "venueShareBps" INTEGER DEFAULT 0,
    "contributedRevenues" JSONB,
    "barMode" TEXT DEFAULT 'none',
    "barGuaranteeCents" INTEGER DEFAULT 0,
    "barTiers" JSONB,
    "facilityFeeCents" INTEGER DEFAULT 0,
    "ticketFeeShareBps" INTEGER DEFAULT 0,
    "depositCents" INTEGER DEFAULT 0,
    "depositDueAt" TIMESTAMP(3),
    "balanceDueAt" TIMESTAMP(3),
    "insuranceRequired" BOOLEAN NOT NULL DEFAULT true,
    "requiredLimitCents" INTEGER DEFAULT 100000000,
    "issuer" TEXT DEFAULT 'own',
    "notes" TEXT NOT NULL DEFAULT '',
    "terms" JSONB,
    "termsHash" TEXT NOT NULL DEFAULT '',
    "acceptedByName" TEXT NOT NULL DEFAULT '',
    "acceptedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "cancelReason" TEXT NOT NULL DEFAULT '',
    "publicTokenHash" TEXT,
    "previousVersion" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenueDeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseExpense" (
    "id" TEXT NOT NULL,
    "venueDeal" TEXT,
    "label" TEXT NOT NULL DEFAULT '',
    "category" TEXT DEFAULT 'other',
    "basis" TEXT DEFAULT 'flat',
    "role" TEXT NOT NULL DEFAULT '',
    "amountCents" INTEGER,
    "rateCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoterPayment" (
    "id" TEXT NOT NULL,
    "venueDeal" TEXT,
    "direction" TEXT DEFAULT 'in',
    "kind" TEXT DEFAULT 'deposit',
    "amountCents" INTEGER DEFAULT 0,
    "method" TEXT DEFAULT 'transfer',
    "reference" TEXT NOT NULL DEFAULT '',
    "recordedBy" TEXT,
    "idempotencyKey" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoterPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "kind" TEXT DEFAULT 'other',
    "file_filesize" INTEGER,
    "file_filename" TEXT,
    "event" TEXT,
    "venueDeal" TEXT,
    "promoter" TEXT,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VenueDeal_publicTokenHash_key" ON "VenueDeal"("publicTokenHash");

-- CreateIndex
CREATE INDEX "VenueDeal_event_idx" ON "VenueDeal"("event");

-- CreateIndex
CREATE INDEX "VenueDeal_hold_idx" ON "VenueDeal"("hold");

-- CreateIndex
CREATE INDEX "VenueDeal_promoter_idx" ON "VenueDeal"("promoter");

-- CreateIndex
CREATE INDEX "VenueDeal_previousVersion_idx" ON "VenueDeal"("previousVersion");

-- CreateIndex
CREATE INDEX "HouseExpense_venueDeal_idx" ON "HouseExpense"("venueDeal");

-- CreateIndex
CREATE UNIQUE INDEX "PromoterPayment_idempotencyKey_key" ON "PromoterPayment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PromoterPayment_venueDeal_idx" ON "PromoterPayment"("venueDeal");

-- CreateIndex
CREATE INDEX "PromoterPayment_recordedBy_idx" ON "PromoterPayment"("recordedBy");

-- CreateIndex
CREATE INDEX "Document_event_idx" ON "Document"("event");

-- CreateIndex
CREATE INDEX "Document_venueDeal_idx" ON "Document"("venueDeal");

-- CreateIndex
CREATE INDEX "Document_promoter_idx" ON "Document"("promoter");

-- CreateIndex
CREATE INDEX "Document_uploadedBy_idx" ON "Document"("uploadedBy");

-- CreateIndex
CREATE UNIQUE INDEX "BarSales_report_key" ON "BarSales"("report");

-- CreateIndex
CREATE INDEX "BarSales_recordedBy_idx" ON "BarSales"("recordedBy");

-- CreateIndex
CREATE INDEX "Event_bookedBy_idx" ON "Event"("bookedBy");

-- CreateIndex
CREATE INDEX "Settlement_venueDeal_idx" ON "Settlement"("venueDeal");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_bookedBy_fkey" FOREIGN KEY ("bookedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_promoter_fkey" FOREIGN KEY ("promoter") REFERENCES "Promoter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueDeal" ADD CONSTRAINT "VenueDeal_event_fkey" FOREIGN KEY ("event") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueDeal" ADD CONSTRAINT "VenueDeal_hold_fkey" FOREIGN KEY ("hold") REFERENCES "DateHold"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueDeal" ADD CONSTRAINT "VenueDeal_promoter_fkey" FOREIGN KEY ("promoter") REFERENCES "Promoter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueDeal" ADD CONSTRAINT "VenueDeal_previousVersion_fkey" FOREIGN KEY ("previousVersion") REFERENCES "VenueDeal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseExpense" ADD CONSTRAINT "HouseExpense_venueDeal_fkey" FOREIGN KEY ("venueDeal") REFERENCES "VenueDeal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoterPayment" ADD CONSTRAINT "PromoterPayment_venueDeal_fkey" FOREIGN KEY ("venueDeal") REFERENCES "VenueDeal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoterPayment" ADD CONSTRAINT "PromoterPayment_recordedBy_fkey" FOREIGN KEY ("recordedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_event_fkey" FOREIGN KEY ("event") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_venueDeal_fkey" FOREIGN KEY ("venueDeal") REFERENCES "VenueDeal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_promoter_fkey" FOREIGN KEY ("promoter") REFERENCES "Promoter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarSales" ADD CONSTRAINT "BarSales_report_fkey" FOREIGN KEY ("report") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarSales" ADD CONSTRAINT "BarSales_recordedBy_fkey" FOREIGN KEY ("recordedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_venueDeal_fkey" FOREIGN KEY ("venueDeal") REFERENCES "VenueDeal"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Venue deal and promoter settlement invariants.
ALTER TABLE "VenueDeal" ADD CONSTRAINT "venue_deal_status" CHECK ("status" IN ('draft','sent','accepted','settled','cancelled','superseded'));
ALTER TABLE "VenueDeal" ADD CONSTRAINT "venue_deal_type" CHECK ("dealType" IN ('rental','co_pro','in_house') AND "rentMode" IN ('flat','versus','plus') AND "coProMode" IN ('upside','up_and_down') AND "barMode" IN ('none','guarantee','split'));
ALTER TABLE "VenueDeal" ADD CONSTRAINT "venue_deal_amounts" CHECK ("rentCents" >= 0 AND "barGuaranteeCents" >= 0 AND "facilityFeeCents" >= 0 AND "depositCents" >= 0 AND "requiredLimitCents" >= 0 AND "rentPercentBps" BETWEEN 0 AND 10000 AND "venueShareBps" BETWEEN 0 AND 10000 AND "ticketFeeShareBps" BETWEEN 0 AND 10000 AND "version" >= 1);
ALTER TABLE "VenueDeal" ADD CONSTRAINT "venue_deal_sent_has_terms" CHECK ("status" IN ('draft','cancelled') OR ("terms" IS NOT NULL AND "termsHash" <> ''));
ALTER TABLE "VenueDeal" ADD CONSTRAINT "venue_deal_accepted_by" CHECK ("status" NOT IN ('accepted','settled') OR ("acceptedByName" <> '' AND "acceptedAt" IS NOT NULL));
CREATE UNIQUE INDEX "VenueDeal_event_version_key" ON "VenueDeal"("event", "version") WHERE "event" IS NOT NULL;
CREATE UNIQUE INDEX "VenueDeal_one_live_per_event" ON "VenueDeal"("event") WHERE "status" IN ('draft','sent','accepted');
ALTER TABLE "PromoterPayment" ADD CONSTRAINT "venue_promoter_payment_valid" CHECK ("amountCents" > 0 AND "direction" IN ('in','out') AND "kind" IN ('deposit','balance','payout') AND (("direction" = 'out') = ("kind" = 'payout')));
ALTER TABLE "BarSales" ADD CONSTRAINT "venue_bar_net" CHECK ("compsCents" >= 0 AND "voidsCents" >= 0 AND "taxCents" >= 0 AND "netCents" >= 0 AND "netCents" = "grossCents" - "compsCents" - "voidsCents" - "taxCents");
ALTER TABLE "Settlement" ADD CONSTRAINT "venue_settlement_party" CHECK ("party" IN ('artist','promoter'));
