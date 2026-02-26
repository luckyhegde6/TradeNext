/*
  Warnings:

  - The primary key for the `corporate_actions` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `actionDate` on the `corporate_actions` table. All the data in the column will be lost.
  - You are about to drop the column `params` on the `corporate_actions` table. All the data in the column will be lost.
  - You are about to drop the column `ticker` on the `corporate_actions` table. All the data in the column will be lost.
  - The `id` column on the `corporate_actions` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `companyName` to the `corporate_actions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `subject` to the `corporate_actions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `symbol` to the `corporate_actions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "corporate_actions" DROP CONSTRAINT "corporate_actions_pkey",
DROP COLUMN "actionDate",
DROP COLUMN "params",
DROP COLUMN "ticker",
ADD COLUMN     "companyName" TEXT NOT NULL,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "exDate" TIMESTAMP(3),
ADD COLUMN     "faceValue" TEXT,
ADD COLUMN     "recDate" TIMESTAMP(3),
ADD COLUMN     "series" TEXT,
ADD COLUMN     "subject" TEXT NOT NULL,
ADD COLUMN     "symbol" TEXT NOT NULL,
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "corporate_actions_pkey" PRIMARY KEY ("id");

-- CreateTable
CREATE TABLE "insider_trading" (
    "id" SERIAL NOT NULL,
    "symbol" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "acqName" TEXT NOT NULL,
    "transactionType" TEXT NOT NULL,
    "securities" DECIMAL(30,2) NOT NULL,
    "price" DECIMAL(30,2),
    "value" DECIMAL(30,2),
    "secAcqPromoter" TEXT,
    "secType" TEXT,
    "afterSec" DECIMAL(30,2),
    "mode" TEXT,
    "remarks" TEXT,
    "broadcastDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insider_trading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedScreen" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedScreen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_scores" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "fScore" INTEGER NOT NULL DEFAULT 0,
    "roa" DECIMAL(10,4),
    "roaChange" DECIMAL(10,4),
    "cfo" DECIMAL(10,4),
    "cfoVsNi" DECIMAL(10,4),
    "currentRatio" DECIMAL(10,4),
    "currentRatioChg" DECIMAL(10,4),
    "leverage" DECIMAL(10,4),
    "leverageChange" DECIMAL(10,4),
    "sharesChange" DECIMAL(10,4),
    "grossMargin" DECIMAL(10,4),
    "marginChange" DECIMAL(10,4),
    "assetTurnover" DECIMAL(10,4),
    "turnoverChange" DECIMAL(10,4),
    "periodType" TEXT NOT NULL DEFAULT 'annual',
    "asOf" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "insider_trading_symbol_idx" ON "insider_trading"("symbol");

-- CreateIndex
CREATE INDEX "insider_trading_broadcastDate_idx" ON "insider_trading"("broadcastDate");

-- CreateIndex
CREATE INDEX "financial_scores_symbol_idx" ON "financial_scores"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "financial_scores_symbol_periodType_asOf_key" ON "financial_scores"("symbol", "periodType", "asOf");

-- CreateIndex
CREATE INDEX "corporate_actions_symbol_idx" ON "corporate_actions"("symbol");

-- CreateIndex
CREATE INDEX "corporate_actions_exDate_idx" ON "corporate_actions"("exDate");
