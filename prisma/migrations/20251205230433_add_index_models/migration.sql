-- CreateTable
CREATE TABLE "Index" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Index_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexPoint" (
    "id" TEXT NOT NULL,
    "indexName" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "open" DECIMAL(30,6),
    "high" DECIMAL(30,6),
    "low" DECIMAL(30,6),
    "close" DECIMAL(30,6),
    "volume" BIGINT,

    CONSTRAINT "IndexPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Index_name_key" ON "Index"("name");

-- CreateIndex
CREATE INDEX "IndexPoint_indexName_time_idx" ON "IndexPoint"("indexName", "time");
