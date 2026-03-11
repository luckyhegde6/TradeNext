-- CreateTable for CorporateAction
CREATE TABLE IF NOT EXISTS "CorporateAction" (
    "id" SERIAL NOT NULL,
    "symbol" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "series" TEXT,
    "subject" TEXT,
    "actionType" TEXT NOT NULL,
    "exDate" TIMESTAMPTZ,
    "recordDate" TIMESTAMPTZ,
    "effectiveDate" TIMESTAMPTZ,
    "faceValue" TEXT,
    "oldFV" TEXT,
    "newFV" TEXT,
    "ratio" TEXT,
    "dividendPerShare" DECIMAL(30,6),
    "dividendYield" DECIMAL(30,6),
    "isin" TEXT,
    "bookClosureStartDate" TIMESTAMPTZ,
    "bookClosureEndDate" TIMESTAMPTZ,
    "announcementDate" TIMESTAMPTZ,
    "source" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "CorporateAction_pkey" PRIMARY KEY ("id")
);

-- Create indices
CREATE INDEX IF NOT EXISTS "CorporateAction_symbol_idx" ON "CorporateAction"("symbol");
CREATE INDEX IF NOT EXISTS "CorporateAction_exDate_idx" ON "CorporateAction"("exDate");
CREATE INDEX IF NOT EXISTS "CorporateAction_actionType_idx" ON "CorporateAction"("actionType");
CREATE INDEX IF NOT EXISTS "CorporateAction_source_idx" ON "CorporateAction"("source");

-- Unique constraint for upsert
CREATE UNIQUE INDEX IF NOT EXISTS "CorporateAction_symbol_actionType_exDate_key" ON "CorporateAction"("symbol", "actionType", "exDate");

-- CreateTable for AdminAnnouncement
CREATE TABLE IF NOT EXISTS "AdminAnnouncement" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMPTZ,
    "endsAt" TIMESTAMPTZ,
    "link" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "AdminAnnouncement_pkey" PRIMARY KEY ("id")
);

-- Create indices
CREATE INDEX IF NOT EXISTS "AdminAnnouncement_isActive_startsAt_endsAt_idx" ON "AdminAnnouncement"("isActive", "startsAt", "endsAt");
CREATE INDEX IF NOT EXISTS "AdminAnnouncement_target_idx" ON "AdminAnnouncement"("target");

-- Ensure updatedAt trigger function exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to both tables
DROP TRIGGER IF EXISTS update_corporate_action_updated_at ON "CorporateAction";
CREATE TRIGGER update_corporate_action_updated_at BEFORE UPDATE ON "CorporateAction" FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

DROP TRIGGER IF EXISTS update_admin_announcement_updated_at ON "AdminAnnouncement";
CREATE TRIGGER update_admin_announcement_updated_at BEFORE UPDATE ON "AdminAnnouncement" FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
