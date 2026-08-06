# Pattern: Tracker Entity

## Problem
Status needs to be tracked over time (e.g., recommendation goes from active → target_achieved), but cramming all state into one model creates complexity.

## Solution
Use separate models for different concerns:
1. **Tracker** (long-lived): Current state, updated on status change
2. **Run** (per-execution): Snapshot of a single execution
3. **History** (audit trail): Every status change logged

## Example (Recommendations)
```typescript
// Long-lived tracker — one per stock recommendation
model RecommendationTracker {
  id              String
  symbol          String
  status          String  // active, target_achieved, stop_loss_hit, expired
  entryPrice      Float
  currentPrice    Float
  targetPrice     Float
  stopLoss        Float
  createdAt       DateTime
  updatedAt       DateTime
}

// Per-run snapshot — many per tracker
model DailyRecommendationStock {
  id              String
  runId           String  // links to DailyRecommendationRun
  trackerId       String  // links to RecommendationTracker
  aiRecommendation String
  confidence      Float
  ...
}

// Audit trail — append-only
model RecommendationStatusHistory {
  id              String
  trackerId       String
  previousStatus  String
  newStatus       String
  triggerSource   String  // 'cron_check', 'manual', 'api'
  createdAt       DateTime
}
```

## Benefits
- Tracker: Fast reads for UI (single record per stock)
- Run: Historical analysis, performance tracking
- History: Full audit trail, debugging, compliance

## When to Use
- Entity has lifecycle that changes over time
- Need both current state and history
- Multiple systems update the same entity
