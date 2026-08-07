-- Add triggeredBy column to daily_recommendation_runs
-- Values: "system" (cron) | "admin" (manual Run Now)
ALTER TABLE "daily_recommendation_runs" ADD COLUMN "triggeredBy" TEXT NOT NULL DEFAULT 'system';

-- Backfill: existing rows default to 'system' via column default; any run without explicit source is system.

-- Index for filtering run history by trigger source
CREATE INDEX "daily_recommendation_runs_triggeredBy_idx" ON "daily_recommendation_runs"("triggeredBy");
