/*
  Warnings:

  - Added the required column `updatedAt` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "Portfolio" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "tradeDate" TIMESTAMP(3) NOT NULL,
    "ticker" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "quantity" DECIMAL(30,6) NOT NULL,
    "price" DECIMAL(30,6) NOT NULL,
    "fees" DECIMAL(30,6),
    "notes" TEXT,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_prices" (
    "ticker" TEXT NOT NULL,
    "tradeDate" TIMESTAMP(3) NOT NULL,
    "open" DECIMAL(30,6),
    "high" DECIMAL(30,6),
    "low" DECIMAL(30,6),
    "close" DECIMAL(30,6),
    "volume" BIGINT,
    "vwap" DECIMAL(30,6),

    CONSTRAINT "daily_prices_pkey" PRIMARY KEY ("ticker","tradeDate")
);

-- CreateTable
CREATE TABLE "fundamentals" (
    "ticker" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "periodType" TEXT NOT NULL,
    "revenue" DECIMAL(30,6),
    "netIncome" DECIMAL(30,6),
    "totalAssets" DECIMAL(30,6),
    "totalLiabilities" DECIMAL(30,6),
    "cash" DECIMAL(30,6),
    "shareholdersEquity" DECIMAL(30,6),
    "eps" DECIMAL(30,6),
    "peRatio" DECIMAL(30,6),
    "roe" DECIMAL(30,6),
    "roic" DECIMAL(30,6),
    "rawJson" JSONB,

    CONSTRAINT "fundamentals_pkey" PRIMARY KEY ("ticker","asOf","periodType")
);

-- CreateTable
CREATE TABLE "corporate_actions" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "actionDate" TIMESTAMP(3) NOT NULL,
    "actionType" TEXT NOT NULL,
    "params" JSONB,

    CONSTRAINT "corporate_actions_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
