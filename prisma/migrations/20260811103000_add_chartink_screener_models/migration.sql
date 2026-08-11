-- CreateTable
CREATE TABLE "chartink_screeners" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "categoryName" TEXT NOT NULL,
    "scanClause" TEXT,
    "debugClause" TEXT,
    "columnClause" TEXT,
    "backtestMaxRows" INTEGER DEFAULT 160,
    "scanlinkId" TEXT,
    "backtestUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chartink_screeners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chartink_screener_runs" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT,
    "screenersRun" INTEGER NOT NULL DEFAULT 0,
    "rowsInserted" INTEGER NOT NULL DEFAULT 0,
    "ttlHours" INTEGER NOT NULL DEFAULT 72,

    CONSTRAINT "chartink_screener_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chartink_screener_results" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "screenerId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT,
    "bsecode" TEXT,
    "close" DECIMAL(30,6),
    "changePercent" DECIMAL(12,4),
    "conditionFlag" INTEGER,
    "volume" DECIMAL(30,6),
    "raw" JSONB,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chartink_screener_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chartink_screeners_categoryId_idx" ON "chartink_screeners"("categoryId");

-- CreateIndex
CREATE INDEX "chartink_screeners_enabled_idx" ON "chartink_screeners"("enabled");

-- CreateIndex
CREATE INDEX "chartink_screener_runs_startedAt_idx" ON "chartink_screener_runs"("startedAt");

-- CreateIndex
CREATE INDEX "chartink_screener_runs_status_idx" ON "chartink_screener_runs"("status");

-- CreateIndex
CREATE INDEX "chartink_screener_results_screenerId_idx" ON "chartink_screener_results"("screenerId");

-- CreateIndex
CREATE INDEX "chartink_screener_results_symbol_idx" ON "chartink_screener_results"("symbol");

-- CreateIndex
CREATE INDEX "chartink_screener_results_expiresAt_idx" ON "chartink_screener_results"("expiresAt");

-- CreateIndex
CREATE INDEX "chartink_screener_results_runId_idx" ON "chartink_screener_results"("runId");

-- AddForeignKey
ALTER TABLE "chartink_screener_results" ADD CONSTRAINT "chartink_screener_results_runId_fkey" FOREIGN KEY ("runId") REFERENCES "chartink_screener_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chartink_screener_results" ADD CONSTRAINT "chartink_screener_results_screenerId_fkey" FOREIGN KEY ("screenerId") REFERENCES "chartink_screeners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

