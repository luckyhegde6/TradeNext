-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "addressedAt" TIMESTAMP(3),
ADD COLUMN     "addressedBy" INTEGER,
ADD COLUMN     "isAddressed" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "notifications_isAddressed_idx" ON "notifications"("isAddressed");
