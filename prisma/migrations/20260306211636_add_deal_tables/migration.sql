-- CreateTable
CREATE TABLE "block_deals" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "symbol" TEXT NOT NULL,
    "securityName" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "buySell" TEXT NOT NULL,
    "quantityTraded" INTEGER NOT NULL,
    "tradePrice" DOUBLE PRECISION NOT NULL,
    "remarks" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "block_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_deals" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "symbol" TEXT NOT NULL,
    "securityName" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "buySell" TEXT NOT NULL,
    "quantityTraded" INTEGER NOT NULL,
    "tradePrice" DOUBLE PRECISION NOT NULL,
    "remarks" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bulk_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "short_selling" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "symbol" TEXT NOT NULL,
    "securityName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "short_selling_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "block_deals_date_idx" ON "block_deals"("date");

-- CreateIndex
CREATE INDEX "block_deals_symbol_idx" ON "block_deals"("symbol");

-- CreateIndex
CREATE INDEX "bulk_deals_date_idx" ON "bulk_deals"("date");

-- CreateIndex
CREATE INDEX "bulk_deals_symbol_idx" ON "bulk_deals"("symbol");

-- CreateIndex
CREATE INDEX "short_selling_date_idx" ON "short_selling"("date");

-- CreateIndex
CREATE INDEX "short_selling_symbol_idx" ON "short_selling"("symbol");
