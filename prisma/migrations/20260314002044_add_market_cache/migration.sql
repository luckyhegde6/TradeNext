-- CreateTable
CREATE TABLE "market_cache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "indexName" TEXT,
    "data" JSONB NOT NULL,
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "nseLastModified" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextSyncAt" TIMESTAMP(3),
    "marketStatus" TEXT NOT NULL DEFAULT 'closed',
    "syncStatus" TEXT NOT NULL DEFAULT 'idle',
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "market_cache_cacheKey_key" ON "market_cache"("cacheKey");

-- CreateIndex
CREATE INDEX "market_cache_dataType_idx" ON "market_cache"("dataType");

-- CreateIndex
CREATE INDEX "market_cache_indexName_idx" ON "market_cache"("indexName");

-- CreateIndex
CREATE INDEX "market_cache_lastSyncedAt_idx" ON "market_cache"("lastSyncedAt");

-- CreateIndex
CREATE INDEX "market_cache_nextSyncAt_idx" ON "market_cache"("nextSyncAt");
