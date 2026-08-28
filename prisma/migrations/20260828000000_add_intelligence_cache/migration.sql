-- CreateTable: IntelligenceCache (v3.18.0 IntelligenceCache model)
-- Maps to the "intelligence_cache" table (via @@map("intelligence_cache")).
-- NOTE: this table was previously created only by `db push` on the local dev
-- DB (which has no migration ledger). `prisma migrate deploy` (used by CI and
-- prod) never created it, which surfaced as `P2021: table does not exist`
-- in the Playwright CI workflow. This migration closes that gap.

-- CreateTable
CREATE TABLE "intelligence_cache" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL,
    "modelUsed" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intelligence_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "intelligence_cache_symbol_key" ON "intelligence_cache"("symbol");

-- CreateIndex
CREATE INDEX "intelligence_cache_symbol_expiresAt_idx" ON "intelligence_cache"("symbol", "expiresAt");
