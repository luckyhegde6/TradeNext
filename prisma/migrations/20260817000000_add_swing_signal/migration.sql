-- CreateTable
CREATE TABLE "swing_signals" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "change" DOUBLE PRECISION,
    "changePercent" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION,
    "marketCap" DOUBLE PRECISION,
    "screenerNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "screenerCount" INTEGER NOT NULL DEFAULT 0,
    "families" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "templateIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL DEFAULT 'chartink',
    "indicators" JSONB,
    "momentumScore" INTEGER NOT NULL DEFAULT 0,
    "analysis" JSONB,
    "aiRecommendation" TEXT,
    "confidence" DOUBLE PRECISION,
    "targetPrice" DOUBLE PRECISION,
    "stopLoss" DOUBLE PRECISION,
    "currentPrice" DOUBLE PRECISION,
    "returnPercent" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastCheckedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "swing_signals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "swing_signals_jobId_idx" ON "swing_signals"("jobId");

-- CreateIndex
CREATE INDEX "swing_signals_symbol_idx" ON "swing_signals"("symbol");

-- CreateIndex
CREATE INDEX "swing_signals_status_idx" ON "swing_signals"("status");

-- CreateIndex
CREATE INDEX "swing_signals_createdAt_idx" ON "swing_signals"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "swing_signals_jobId_symbol_key" ON "swing_signals"("jobId", "symbol");

-- AddForeignKey
ALTER TABLE "swing_signals" ADD CONSTRAINT "swing_signals_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "swing_analysis_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

