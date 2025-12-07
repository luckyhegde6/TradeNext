-- AlterTable
ALTER TABLE "IndexQuote" ADD COLUMN     "advances" INTEGER,
ADD COLUMN     "declines" INTEGER,
ADD COLUMN     "dividendYield" TEXT,
ADD COLUMN     "high" TEXT,
ADD COLUMN     "low" TEXT,
ADD COLUMN     "open" TEXT,
ADD COLUMN     "pbRatio" TEXT,
ADD COLUMN     "peRatio" TEXT,
ADD COLUMN     "previousClose" TEXT,
ADD COLUMN     "totalTradedValue" TEXT,
ADD COLUMN     "totalTradedVolume" TEXT,
ADD COLUMN     "unchanged" INTEGER,
ADD COLUMN     "yearHigh" TEXT,
ADD COLUMN     "yearLow" TEXT;

-- CreateTable
CREATE TABLE "IndexHeatmapItem" (
    "id" TEXT NOT NULL,
    "indexName" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "lastPrice" DECIMAL(30,6) NOT NULL,
    "change" DECIMAL(30,6) NOT NULL,
    "pChange" DECIMAL(30,6) NOT NULL,
    "volume" BIGINT,
    "value" DECIMAL(30,6),
    "high" DECIMAL(30,6),
    "low" DECIMAL(30,6),
    "yearHigh" DECIMAL(30,6),
    "yearLow" DECIMAL(30,6),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexHeatmapItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IndexHeatmapItem_indexName_idx" ON "IndexHeatmapItem"("indexName");

-- CreateIndex
CREATE UNIQUE INDEX "IndexHeatmapItem_indexName_symbol_key" ON "IndexHeatmapItem"("indexName", "symbol");
