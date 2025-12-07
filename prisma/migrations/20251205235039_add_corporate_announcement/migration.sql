-- CreateTable
CREATE TABLE "CorporateAnnouncement" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "details" TEXT,
    "broadcastDateTime" TIMESTAMP(3) NOT NULL,
    "attachment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorporateAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CorporateAnnouncement_broadcastDateTime_idx" ON "CorporateAnnouncement"("broadcastDateTime");
