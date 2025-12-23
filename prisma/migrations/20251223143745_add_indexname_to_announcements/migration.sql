-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mobile" TEXT;

-- CreateTable
CREATE TABLE "FundTransaction" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(30,6) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "FundTransaction_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "FundTransaction" ADD CONSTRAINT "FundTransaction_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
