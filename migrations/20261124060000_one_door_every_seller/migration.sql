-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "connectedSold" INTEGER DEFAULT 0,
ADD COLUMN     "connectedSoldAt" TIMESTAMP(3),
ADD COLUMN     "connection" TEXT,
ADD COLUMN     "externalEventId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "externalEventTitle" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "externalSellerName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "externalUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "issuer" TEXT DEFAULT 'own';

-- AlterTable
ALTER TABLE "ScanEvent" ADD COLUMN     "codeLast4" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "externalTicket" TEXT,
ADD COLUMN     "guestListEntry" TEXT,
ADD COLUMN     "idChecked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "issuerResult" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "message" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "places" INTEGER DEFAULT 1,
ADD COLUMN     "source" TEXT DEFAULT 'own';

-- CreateTable
CREATE TABLE "SecretBox" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT '',
    "ciphertext" TEXT NOT NULL DEFAULT '',
    "iv" TEXT NOT NULL DEFAULT '',
    "authTag" TEXT NOT NULL DEFAULT '',
    "keyVersion" INTEGER DEFAULT 1,
    "rotatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecretBox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelConnection" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL DEFAULT '',
    "issuer" TEXT NOT NULL DEFAULT '',
    "clientId" TEXT NOT NULL DEFAULT '',
    "siblingName" TEXT NOT NULL DEFAULT '',
    "siblingUserLabel" TEXT NOT NULL DEFAULT '',
    "scopes" TEXT NOT NULL DEFAULT '',
    "status" TEXT DEFAULT 'pending',
    "stateHash" TEXT NOT NULL DEFAULT '',
    "pendingExpiresAt" TIMESTAMP(3),
    "startedBy" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "lastRefreshedAt" TIMESTAMP(3),
    "lastError" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalTicketBatch" (
    "id" TEXT NOT NULL,
    "event" TEXT,
    "sellerName" TEXT NOT NULL DEFAULT '',
    "filename" TEXT NOT NULL DEFAULT '',
    "importedBy" TEXT,
    "importedAt" TIMESTAMP(3),
    "rowCount" INTEGER DEFAULT 0,
    "addedCount" INTEGER DEFAULT 0,
    "skippedCount" INTEGER DEFAULT 0,
    "voidedCount" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalTicketBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalTicket" (
    "id" TEXT NOT NULL,
    "batch" TEXT,
    "event" TEXT,
    "barcodeHash" TEXT NOT NULL DEFAULT '',
    "barcodeLast4" TEXT NOT NULL DEFAULT '',
    "holderName" TEXT NOT NULL DEFAULT '',
    "ticketType" TEXT NOT NULL DEFAULT '',
    "status" TEXT DEFAULT 'valid',
    "checkedInAt" TIMESTAMP(3),
    "voidReason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestListEntry" (
    "id" TEXT NOT NULL,
    "event" TEXT,
    "name" TEXT NOT NULL DEFAULT '',
    "plusOnes" INTEGER DEFAULT 0,
    "admittedCount" INTEGER DEFAULT 0,
    "addedFor" TEXT DEFAULT 'house',
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT DEFAULT 'listed',
    "addedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SecretBox_key_key" ON "SecretBox"("key");

-- CreateIndex
CREATE INDEX "ChannelConnection_stateHash_idx" ON "ChannelConnection"("stateHash");

-- CreateIndex
CREATE INDEX "ChannelConnection_startedBy_idx" ON "ChannelConnection"("startedBy");

-- CreateIndex
CREATE INDEX "ExternalTicketBatch_event_idx" ON "ExternalTicketBatch"("event");

-- CreateIndex
CREATE INDEX "ExternalTicketBatch_importedBy_idx" ON "ExternalTicketBatch"("importedBy");

-- CreateIndex
CREATE INDEX "ExternalTicket_batch_idx" ON "ExternalTicket"("batch");

-- CreateIndex
CREATE INDEX "ExternalTicket_event_idx" ON "ExternalTicket"("event");

-- CreateIndex
CREATE INDEX "GuestListEntry_event_idx" ON "GuestListEntry"("event");

-- CreateIndex
CREATE INDEX "GuestListEntry_addedBy_idx" ON "GuestListEntry"("addedBy");

-- CreateIndex
CREATE INDEX "Event_connection_idx" ON "Event"("connection");

-- CreateIndex
CREATE INDEX "ScanEvent_externalTicket_idx" ON "ScanEvent"("externalTicket");

-- CreateIndex
CREATE INDEX "ScanEvent_guestListEntry_idx" ON "ScanEvent"("guestListEntry");

-- AddForeignKey
ALTER TABLE "ChannelConnection" ADD CONSTRAINT "ChannelConnection_startedBy_fkey" FOREIGN KEY ("startedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalTicketBatch" ADD CONSTRAINT "ExternalTicketBatch_event_fkey" FOREIGN KEY ("event") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalTicketBatch" ADD CONSTRAINT "ExternalTicketBatch_importedBy_fkey" FOREIGN KEY ("importedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalTicket" ADD CONSTRAINT "ExternalTicket_batch_fkey" FOREIGN KEY ("batch") REFERENCES "ExternalTicketBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalTicket" ADD CONSTRAINT "ExternalTicket_event_fkey" FOREIGN KEY ("event") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestListEntry" ADD CONSTRAINT "GuestListEntry_event_fkey" FOREIGN KEY ("event") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestListEntry" ADD CONSTRAINT "GuestListEntry_addedBy_fkey" FOREIGN KEY ("addedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_connection_fkey" FOREIGN KEY ("connection") REFERENCES "ChannelConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanEvent" ADD CONSTRAINT "ScanEvent_externalTicket_fkey" FOREIGN KEY ("externalTicket") REFERENCES "ExternalTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanEvent" ADD CONSTRAINT "ScanEvent_guestListEntry_fkey" FOREIGN KEY ("guestListEntry") REFERENCES "GuestListEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- §4.6 / §4.8 / §4.9 / §4.16 invariants (hand-written; Prisma does not express CHECKs or partial indexes).
ALTER TABLE "Event" ADD CONSTRAINT "venue_event_issuer" CHECK ("issuer" IN ('own','openfront_concerts','openfront_comedy_club','other')
  AND ("issuer" NOT IN ('openfront_concerts','openfront_comedy_club') OR ("connection" IS NOT NULL AND "externalEventId" <> ''))
  AND ("issuer" <> 'other' OR "externalSellerName" <> '') AND "connectedSold" >= 0);
ALTER TABLE "ScanEvent" ADD CONSTRAINT "venue_scan_valid" CHECK ("source" IN ('own','connected','external','guest_list','will_call')
  AND "result" IN ('admitted','duplicate','reentry','wrong_event','void','not_found','issuer_refused','issuer_unreachable')
  AND "places" >= 1
  AND ("source" <> 'connected' OR "result" <> 'admitted' OR "issuerResult" = 'admitted'));
CREATE UNIQUE INDEX "ScanEvent_one_admission_per_external_ticket" ON "ScanEvent"("externalTicket") WHERE "result" = 'admitted';
ALTER TABLE "ChannelConnection" ADD CONSTRAINT "venue_connection_valid" CHECK ("kind" IN ('openfront_concerts','openfront_comedy_club')
  AND "status" IN ('pending','connected','needs_reconnect','disconnected')
  AND ("status" = 'pending' OR "stateHash" = '')
  AND ("status" <> 'connected' OR ("issuer" <> '' AND "clientId" <> '' AND "connectedAt" IS NOT NULL)));
ALTER TABLE "ExternalTicket" ADD CONSTRAINT "venue_external_ticket_valid" CHECK ("status" IN ('valid','checked_in','void')
  AND "barcodeHash" ~ '^[0-9a-f]{64}$' AND char_length("barcodeLast4") BETWEEN 1 AND 4
  AND ("status" <> 'checked_in' OR "checkedInAt" IS NOT NULL));
CREATE UNIQUE INDEX "ExternalTicket_event_barcodeHash_key" ON "ExternalTicket"("event", "barcodeHash") WHERE "event" IS NOT NULL;
ALTER TABLE "ExternalTicketBatch" ADD CONSTRAINT "venue_external_batch_counts" CHECK ("rowCount" >= 0 AND "addedCount" >= 0 AND "skippedCount" >= 0 AND "voidedCount" >= 0 AND "sellerName" <> '');
ALTER TABLE "GuestListEntry" ADD CONSTRAINT "venue_guest_list_valid" CHECK ("status" IN ('listed','checked_in','removed')
  AND "addedFor" IN ('artist','promoter','house') AND "name" <> ''
  AND "plusOnes" BETWEEN 0 AND 20 AND "admittedCount" BETWEEN 0 AND "plusOnes" + 1
  AND ("status" <> 'removed' OR "admittedCount" = 0));
ALTER TABLE "SecretBox" ADD CONSTRAINT "venue_secret_box_valid" CHECK ("key" <> '' AND "ciphertext" <> '' AND "iv" <> '' AND "authTag" <> '');
