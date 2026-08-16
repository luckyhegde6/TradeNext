-- CreateTable
CREATE TABLE "swing_analysis_jobs" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payload" JSONB,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "stockCount" INTEGER NOT NULL DEFAULT 0,
    "analyzedCount" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "templateCount" INTEGER NOT NULL DEFAULT 0,
    "totalRaw" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "swing_analysis_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "swing_analysis_jobs_status_createdAt_idx" ON "swing_analysis_jobs"("status", "createdAt");
