-- CreateTable
CREATE TABLE "google_sheets_ledger" (
    "seq" SERIAL NOT NULL,
    "tab" TEXT NOT NULL,
    "rowJson" JSONB NOT NULL,
    "runId" TEXT,
    "reason" TEXT,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_sheets_ledger_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE INDEX "google_sheets_ledger_tab_seq_idx" ON "google_sheets_ledger"("tab", "seq");

-- CreateIndex
-- v3.43.0: the drain/backlog query filters `tab = ? AND delivered = 0`, and the
-- console counts undelivered rows per tab. Without this composite index both
-- are a full scan of the ledger, which grows on every export.
CREATE INDEX "google_sheets_ledger_tab_delivered_idx" ON "google_sheets_ledger"("tab", "delivered");
