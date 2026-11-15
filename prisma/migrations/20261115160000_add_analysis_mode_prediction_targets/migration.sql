-- Spec 43: per-stock analysis provenance (AI Targets | Prediction Targets)
-- Nullable for safe rollout/backfill; existing rows with targets/analysis are
-- backfilled as "AI Targets" by application/perf paths (idempotent).

ALTER TABLE "daily_recommendation_stocks"
ADD COLUMN IF NOT EXISTS "analysisMode" TEXT;

ALTER TABLE "recommendation_trackers"
ADD COLUMN IF NOT EXISTS "analysisMode" TEXT;

ALTER TABLE "swing_signals"
ADD COLUMN IF NOT EXISTS "analysisMode" TEXT;

-- Historical backfill (idempotent): rows that already carry any target/analysis
-- are treated as AI-generated.
UPDATE "daily_recommendation_stocks"
SET "analysisMode" = 'AI Targets'
WHERE "analysisMode" IS NULL
  AND (
    "targetPrice" IS NOT NULL
    OR "stopLoss" IS NOT NULL
    OR "aiRecommendation" IS NOT NULL
    OR "confidence" IS NOT NULL
    OR ("reasoning" IS NOT NULL AND btrim("reasoning") <> '')
  );

UPDATE "recommendation_trackers"
SET "analysisMode" = 'AI Targets'
WHERE "analysisMode" IS NULL
  AND (
    "targetPrice" IS NOT NULL
    OR "stopLoss" IS NOT NULL
    OR "aiRecommendation" IS NOT NULL
    OR "confidence" IS NOT NULL
    OR ("reasoning" IS NOT NULL AND btrim("reasoning") <> '')
  );

UPDATE "swing_signals"
SET "analysisMode" = 'AI Targets'
WHERE "analysisMode" IS NULL
  AND (
    "targetPrice" IS NOT NULL
    OR "stopLoss" IS NOT NULL
    OR "aiRecommendation" IS NOT NULL
    OR "confidence" IS NOT NULL
    OR "analysis" IS NOT NULL
  );
