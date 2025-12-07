-- CreateTable
CREATE TABLE "IndexQuote" (
    "id" TEXT NOT NULL,
    "indexName" TEXT NOT NULL,
    "lastPrice" TEXT NOT NULL,
    "change" TEXT NOT NULL,
    "pChange" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "marketStatus" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndexQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IndexQuote_indexName_key" ON "IndexQuote"("indexName");
