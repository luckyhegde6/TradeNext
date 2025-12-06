-- CreateTable
CREATE TABLE "index_closes" (
    "id" TEXT NOT NULL,
    "indexName" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "open" DECIMAL(30,6),
    "high" DECIMAL(30,6),
    "low" DECIMAL(30,6),
    "close" DECIMAL(30,6),
    "vwap" DECIMAL(30,6),
    "volume" BIGINT,

    CONSTRAINT "index_closes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "index_weights" (
    "id" TEXT NOT NULL,
    "indexName" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "security" TEXT,
    "weight" DECIMAL(10,4),
    "asOf" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "index_weights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "index_closes_indexName_asOf_idx" ON "index_closes"("indexName", "asOf");

-- CreateIndex
CREATE INDEX "index_weights_indexName_ticker_asOf_idx" ON "index_weights"("indexName", "ticker", "asOf");
