/*
  Warnings:

  - You are about to drop the `audit_logs` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "audit_logs";

-- CreateTable
CREATE TABLE "recommendation_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlists" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watchlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlist_items" (
    "id" TEXT NOT NULL,
    "watchlistId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watchlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recommendation_subscriptions_userId_idx" ON "recommendation_subscriptions"("userId");

-- CreateIndex
CREATE INDEX "recommendation_subscriptions_recommendationId_idx" ON "recommendation_subscriptions"("recommendationId");

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_subscriptions_userId_recommendationId_key" ON "recommendation_subscriptions"("userId", "recommendationId");

-- CreateIndex
CREATE INDEX "watchlists_userId_idx" ON "watchlists"("userId");

-- CreateIndex
CREATE INDEX "watchlist_items_watchlistId_idx" ON "watchlist_items"("watchlistId");

-- CreateIndex
CREATE INDEX "watchlist_items_symbol_idx" ON "watchlist_items"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "watchlist_items_watchlistId_symbol_key" ON "watchlist_items"("watchlistId", "symbol");

-- AddForeignKey
ALTER TABLE "recommendation_subscriptions" ADD CONSTRAINT "recommendation_subscriptions_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "stock_recommendations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "watchlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
