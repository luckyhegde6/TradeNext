-- DropForeignKey
ALTER TABLE "daily_recommendation_stocks" DROP CONSTRAINT "daily_recommendation_stocks_trackerId_fkey";

-- AlterTable
ALTER TABLE "daily_recommendation_stocks" ALTER COLUMN "trackerId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "recommendation_archives" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "trackerId" TEXT NOT NULL,
    "lastRunId" TEXT,
    "runDate" TIMESTAMP(3) NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "currentPrice" DOUBLE PRECISION,
    "targetPrice" DOUBLE PRECISION,
    "stopLoss" DOUBLE PRECISION,
    "category" TEXT,
    "aiRecommendation" TEXT,
    "confidence" DOUBLE PRECISION,
    "reasoning" TEXT,
    "riskFactors" JSONB,
    "screenerAttribution" JSONB,
    "finalStatus" TEXT NOT NULL,
    "returnPercent" DOUBLE PRECISION,
    "daysTracked" INTEGER NOT NULL,
    "statusHistory" JSONB,
    "archivedReason" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_archives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recommendation_archives_symbol_idx" ON "recommendation_archives"("symbol");

-- CreateIndex
CREATE INDEX "recommendation_archives_finalStatus_idx" ON "recommendation_archives"("finalStatus");

-- CreateIndex
CREATE INDEX "recommendation_archives_runDate_idx" ON "recommendation_archives"("runDate");

-- CreateIndex
CREATE INDEX "recommendation_archives_archivedAt_idx" ON "recommendation_archives"("archivedAt");

-- AddForeignKey
ALTER TABLE "daily_recommendation_stocks" ADD CONSTRAINT "daily_recommendation_stocks_trackerId_fkey" FOREIGN KEY ("trackerId") REFERENCES "recommendation_trackers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
