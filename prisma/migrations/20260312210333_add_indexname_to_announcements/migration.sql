/*
  Warnings:

  - You are about to drop the `AdminAnnouncement` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CorporateAction` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `RateLimit` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[symbol,actionType,exDate]` on the table `corporate_actions` will be added. If there are existing duplicate values, this will fail.

*/
-- DropTable
DROP TABLE "AdminAnnouncement";

-- DropTable
DROP TABLE "CorporateAction";

-- DropTable
DROP TABLE "RateLimit";

-- CreateTable
CREATE TABLE "admin_announcements" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "link" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_announcements_isActive_startsAt_endsAt_idx" ON "admin_announcements"("isActive", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "admin_announcements_target_idx" ON "admin_announcements"("target");

-- CreateIndex
CREATE UNIQUE INDEX "corporate_actions_symbol_actionType_exDate_key" ON "corporate_actions"("symbol", "actionType", "exDate");
