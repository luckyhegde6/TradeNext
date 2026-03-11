/*
  Warnings:

  - You are about to drop the column `recDate` on the `corporate_actions` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `corporate_actions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "corporate_actions" DROP COLUMN "recDate",
ADD COLUMN     "announcementDate" TIMESTAMP(3),
ADD COLUMN     "bookClosureEndDate" TIMESTAMP(3),
ADD COLUMN     "bookClosureStartDate" TIMESTAMP(3),
ADD COLUMN     "dividendPerShare" DECIMAL(30,6),
ADD COLUMN     "dividendYield" DECIMAL(30,6),
ADD COLUMN     "effectiveDate" TIMESTAMP(3),
ADD COLUMN     "isin" TEXT,
ADD COLUMN     "newFV" TEXT,
ADD COLUMN     "oldFV" TEXT,
ADD COLUMN     "ratio" TEXT,
ADD COLUMN     "recordDate" TIMESTAMP(3),
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'admin',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "subject" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "corporate_actions_actionType_idx" ON "corporate_actions"("actionType");

-- CreateIndex
CREATE INDEX "corporate_actions_source_idx" ON "corporate_actions"("source");
