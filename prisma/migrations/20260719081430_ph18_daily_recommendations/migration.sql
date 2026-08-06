/*
  Warnings:

  - You are about to alter the column `roe` on the `screener_results` table. The data in that column could be lost. The data in that column will be cast from `Decimal(30,6)` to `Decimal(10,4)`.
  - You are about to alter the column `debtToEquity` on the `screener_results` table. The data in that column could be lost. The data in that column will be cast from `Decimal(30,6)` to `Decimal(10,4)`.
  - You are about to drop the `AIInsight` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropIndex
DROP INDEX "rate_limit_configs_isBlocked_idx";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "currentSessionId" TEXT,
ADD COLUMN     "telegramChatId" TEXT,
ADD COLUMN     "telegramVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "channelId" TEXT,
ADD COLUMN     "deliveryStatus" TEXT;

-- AlterTable
ALTER TABLE "screener_results" ALTER COLUMN "roe" SET DATA TYPE DECIMAL(10,4),
ALTER COLUMN "debtToEquity" SET DATA TYPE DECIMAL(10,4);

-- AlterTable
ALTER TABLE "worker_tasks" ADD COLUMN     "parentTaskId" TEXT,
ADD COLUMN     "triggeredBy" TEXT;

-- DropTable
DROP TABLE "AIInsight";

-- CreateTable
CREATE TABLE "join_requests" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mobile" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "join_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_insights" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "symbol" TEXT,
    "source" TEXT,
    "agentType" TEXT,
    "confidence" DECIMAL(5,4),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_events" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "message" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_screener_syncs" (
    "id" TEXT NOT NULL,
    "syncDate" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_screener_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_configs" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "filters" JSONB NOT NULL,
    "columns" JSONB,
    "schedule" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "lastRunAt" TIMESTAMP(3),
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scan_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_results" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchCount" INTEGER NOT NULL,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "executionMs" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "error" TEXT,

    CONSTRAINT "scan_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_result_items" (
    "id" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT,
    "price" DECIMAL(30,6),
    "change" DECIMAL(30,6),
    "pChange" DECIMAL(30,6),
    "volume" BIGINT,
    "data" JSONB,

    CONSTRAINT "scan_result_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backtest_runs" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "strategyId" TEXT,
    "configId" TEXT,
    "entryFilter" JSONB NOT NULL,
    "exitFilter" JSONB,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "initialCapital" DECIMAL(30,2) DEFAULT 1000000,
    "totalTrades" INTEGER NOT NULL DEFAULT 0,
    "winRate" DECIMAL(10,4),
    "totalPnl" DECIMAL(30,2),
    "maxDrawdown" DECIMAL(10,4),
    "sharpeRatio" DECIMAL(10,4),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backtest_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backtest_trades" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "exitDate" TIMESTAMP(3),
    "entryPrice" DECIMAL(30,2),
    "exitPrice" DECIMAL(30,2),
    "quantity" INTEGER,
    "pnl" DECIMAL(30,2),
    "pnlPercent" DECIMAL(10,4),
    "entryReason" TEXT,
    "exitReason" TEXT,

    CONSTRAINT "backtest_trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "server_logs" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "source" TEXT,
    "taskId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "server_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rebalancer_configs" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Default',
    "categories" JSONB NOT NULL,
    "driftThreshold" DECIMAL(5,2) NOT NULL DEFAULT 5.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rebalancer_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fo_positions" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "symbol" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "entryPrice" DECIMAL(30,6) NOT NULL,
    "currentPrice" DECIMAL(30,6),
    "premium" DECIMAL(30,6),
    "strike" DECIMAL(30,6),
    "expiry" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closePrice" DECIMAL(30,6),
    "closeDate" TIMESTAMP(3),
    "pnl" DECIMAL(30,6),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fo_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_channels" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "lastTestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_rules" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "condition" JSONB NOT NULL,
    "channels" TEXT[],
    "schedule" JSONB,
    "escalation" JSONB,
    "action" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastTriggeredAt" TIMESTAMP(3),
    "triggerCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_events" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "channelId" TEXT,
    "channelType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "metadata" JSONB,
    "deliveredAt" TIMESTAMP(3),
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "secrets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "hint" TEXT,
    "metadata" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "secrets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_logs" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "channelId" TEXT,
    "channelType" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL,
    "statusCode" INTEGER,
    "response" TEXT,
    "durationMs" INTEGER,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_analyses" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "analysisType" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "executionTime" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "analysisType" TEXT NOT NULL,
    "title" TEXT,
    "messages" JSONB NOT NULL,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_rate_limits" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" INTEGER,
    "ipAddress" TEXT,
    "violations" INTEGER NOT NULL DEFAULT 0,
    "tokenUsage" INTEGER NOT NULL DEFAULT 0,
    "cooldownUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_trackers" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "currentPrice" DOUBLE PRECISION,
    "targetPrice" DOUBLE PRECISION NOT NULL,
    "stopLoss" DOUBLE PRECISION NOT NULL,
    "timeHorizon" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "aiRecommendation" TEXT NOT NULL,
    "reasoning" TEXT,
    "riskFactors" JSONB,
    "screenerAttribution" JSONB,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommendation_trackers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_recommendation_runs" (
    "id" TEXT NOT NULL,
    "runDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'running',
    "totalScreeners" INTEGER NOT NULL DEFAULT 0,
    "successfulScreeners" INTEGER NOT NULL DEFAULT 0,
    "totalStocks" INTEGER NOT NULL DEFAULT 0,
    "uniqueStocks" INTEGER NOT NULL DEFAULT 0,
    "aiProcessed" INTEGER NOT NULL DEFAULT 0,
    "aiFailed" INTEGER NOT NULL DEFAULT 0,
    "executionTimeMs" INTEGER,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "daily_recommendation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_recommendation_stocks" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "trackerId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "change" DOUBLE PRECISION,
    "changePercent" DOUBLE PRECISION,
    "volume" BIGINT,
    "screenerAttribution" JSONB,
    "screenerCount" INTEGER NOT NULL DEFAULT 0,
    "aiRecommendation" TEXT,
    "confidence" DOUBLE PRECISION,
    "targetPrice" DOUBLE PRECISION,
    "stopLoss" DOUBLE PRECISION,
    "timeHorizon" TEXT,
    "reasoning" TEXT,
    "riskFactors" JSONB,
    "aiTokensUsed" INTEGER NOT NULL DEFAULT 0,
    "aiExecutionMs" INTEGER NOT NULL DEFAULT 0,
    "aiSuccess" BOOLEAN NOT NULL DEFAULT true,
    "aiError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_recommendation_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_status_history" (
    "id" TEXT NOT NULL,
    "trackerId" TEXT NOT NULL,
    "previousStatus" TEXT,
    "newStatus" TEXT NOT NULL,
    "triggerSource" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_alert_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "chatId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notifyOn" TEXT NOT NULL DEFAULT 'all',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommendation_alert_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_performance_logs" (
    "id" TEXT NOT NULL,
    "agentType" TEXT NOT NULL,
    "symbol" TEXT,
    "prediction" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "targetPrice" DOUBLE PRECISION,
    "stopLoss" DOUBLE PRECISION,
    "currentPrice" DOUBLE PRECISION,
    "outcome" TEXT,
    "returnPercent" DOUBLE PRECISION,
    "checkedAt" TIMESTAMP(3),
    "checkInterval" TEXT,
    "promptVersion" TEXT,
    "modelUsed" TEXT,
    "runId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_performance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screener_run_logs" (
    "id" TEXT NOT NULL,
    "screenerId" TEXT NOT NULL,
    "screenerName" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "stockCount" INTEGER NOT NULL DEFAULT 0,
    "executionTimeMs" INTEGER,
    "errorMessage" TEXT,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "screener_run_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_health_logs" (
    "id" TEXT NOT NULL,
    "metricType" TEXT NOT NULL,
    "metricName" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_health_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unified_events" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventSubtype" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "userId" INTEGER,
    "symbol" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unified_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "join_requests_email_key" ON "join_requests"("email");

-- CreateIndex
CREATE INDEX "ai_insights_symbol_idx" ON "ai_insights"("symbol");

-- CreateIndex
CREATE INDEX "ai_insights_source_idx" ON "ai_insights"("source");

-- CreateIndex
CREATE INDEX "ai_insights_createdAt_idx" ON "ai_insights"("createdAt");

-- CreateIndex
CREATE INDEX "task_events_taskId_idx" ON "task_events"("taskId");

-- CreateIndex
CREATE INDEX "task_events_eventType_idx" ON "task_events"("eventType");

-- CreateIndex
CREATE INDEX "task_events_createdAt_idx" ON "task_events"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "daily_screener_syncs_syncDate_key" ON "daily_screener_syncs"("syncDate");

-- CreateIndex
CREATE INDEX "daily_screener_syncs_syncDate_idx" ON "daily_screener_syncs"("syncDate");

-- CreateIndex
CREATE INDEX "scan_configs_userId_idx" ON "scan_configs"("userId");

-- CreateIndex
CREATE INDEX "scan_configs_isPublic_idx" ON "scan_configs"("isPublic");

-- CreateIndex
CREATE INDEX "scan_results_configId_runAt_idx" ON "scan_results"("configId", "runAt");

-- CreateIndex
CREATE INDEX "scan_result_items_resultId_idx" ON "scan_result_items"("resultId");

-- CreateIndex
CREATE INDEX "scan_result_items_symbol_idx" ON "scan_result_items"("symbol");

-- CreateIndex
CREATE INDEX "backtest_runs_userId_idx" ON "backtest_runs"("userId");

-- CreateIndex
CREATE INDEX "backtest_runs_status_idx" ON "backtest_runs"("status");

-- CreateIndex
CREATE INDEX "backtest_trades_runId_idx" ON "backtest_trades"("runId");

-- CreateIndex
CREATE INDEX "backtest_trades_symbol_idx" ON "backtest_trades"("symbol");

-- CreateIndex
CREATE INDEX "server_logs_level_idx" ON "server_logs"("level");

-- CreateIndex
CREATE INDEX "server_logs_source_idx" ON "server_logs"("source");

-- CreateIndex
CREATE INDEX "server_logs_taskId_idx" ON "server_logs"("taskId");

-- CreateIndex
CREATE INDEX "server_logs_createdAt_idx" ON "server_logs"("createdAt");

-- CreateIndex
CREATE INDEX "rebalancer_configs_userId_idx" ON "rebalancer_configs"("userId");

-- CreateIndex
CREATE INDEX "fo_positions_userId_idx" ON "fo_positions"("userId");

-- CreateIndex
CREATE INDEX "fo_positions_symbol_idx" ON "fo_positions"("symbol");

-- CreateIndex
CREATE INDEX "fo_positions_status_idx" ON "fo_positions"("status");

-- CreateIndex
CREATE INDEX "fo_positions_expiry_idx" ON "fo_positions"("expiry");

-- CreateIndex
CREATE INDEX "alert_channels_userId_idx" ON "alert_channels"("userId");

-- CreateIndex
CREATE INDEX "alert_channels_type_idx" ON "alert_channels"("type");

-- CreateIndex
CREATE INDEX "alert_rules_userId_idx" ON "alert_rules"("userId");

-- CreateIndex
CREATE INDEX "alert_rules_isActive_idx" ON "alert_rules"("isActive");

-- CreateIndex
CREATE INDEX "alert_events_ruleId_attemptedAt_idx" ON "alert_events"("ruleId", "attemptedAt");

-- CreateIndex
CREATE INDEX "alert_events_channelType_idx" ON "alert_events"("channelType");

-- CreateIndex
CREATE INDEX "alert_events_status_idx" ON "alert_events"("status");

-- CreateIndex
CREATE UNIQUE INDEX "secrets_name_key" ON "secrets"("name");

-- CreateIndex
CREATE INDEX "secrets_type_idx" ON "secrets"("type");

-- CreateIndex
CREATE INDEX "secrets_isActive_idx" ON "secrets"("isActive");

-- CreateIndex
CREATE INDEX "delivery_logs_eventId_idx" ON "delivery_logs"("eventId");

-- CreateIndex
CREATE INDEX "delivery_logs_status_idx" ON "delivery_logs"("status");

-- CreateIndex
CREATE INDEX "ai_analyses_userId_idx" ON "ai_analyses"("userId");

-- CreateIndex
CREATE INDEX "ai_analyses_analysisType_idx" ON "ai_analyses"("analysisType");

-- CreateIndex
CREATE INDEX "ai_analyses_conversationId_idx" ON "ai_analyses"("conversationId");

-- CreateIndex
CREATE INDEX "ai_analyses_createdAt_idx" ON "ai_analyses"("createdAt");

-- CreateIndex
CREATE INDEX "ai_conversations_userId_idx" ON "ai_conversations"("userId");

-- CreateIndex
CREATE INDEX "ai_conversations_updatedAt_idx" ON "ai_conversations"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_rate_limits_key_key" ON "ai_rate_limits"("key");

-- CreateIndex
CREATE INDEX "ai_rate_limits_key_idx" ON "ai_rate_limits"("key");

-- CreateIndex
CREATE INDEX "ai_rate_limits_updatedAt_idx" ON "ai_rate_limits"("updatedAt");

-- CreateIndex
CREATE INDEX "recommendation_trackers_symbol_idx" ON "recommendation_trackers"("symbol");

-- CreateIndex
CREATE INDEX "recommendation_trackers_status_idx" ON "recommendation_trackers"("status");

-- CreateIndex
CREATE INDEX "recommendation_trackers_createdAt_idx" ON "recommendation_trackers"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_trackers_symbol_createdAt_key" ON "recommendation_trackers"("symbol", "createdAt");

-- CreateIndex
CREATE INDEX "daily_recommendation_runs_runDate_idx" ON "daily_recommendation_runs"("runDate");

-- CreateIndex
CREATE INDEX "daily_recommendation_runs_status_idx" ON "daily_recommendation_runs"("status");

-- CreateIndex
CREATE INDEX "daily_recommendation_stocks_runId_idx" ON "daily_recommendation_stocks"("runId");

-- CreateIndex
CREATE INDEX "daily_recommendation_stocks_trackerId_idx" ON "daily_recommendation_stocks"("trackerId");

-- CreateIndex
CREATE INDEX "daily_recommendation_stocks_symbol_idx" ON "daily_recommendation_stocks"("symbol");

-- CreateIndex
CREATE INDEX "daily_recommendation_stocks_aiRecommendation_idx" ON "daily_recommendation_stocks"("aiRecommendation");

-- CreateIndex
CREATE UNIQUE INDEX "daily_recommendation_stocks_runId_symbol_key" ON "daily_recommendation_stocks"("runId", "symbol");

-- CreateIndex
CREATE INDEX "recommendation_status_history_trackerId_idx" ON "recommendation_status_history"("trackerId");

-- CreateIndex
CREATE INDEX "recommendation_status_history_newStatus_idx" ON "recommendation_status_history"("newStatus");

-- CreateIndex
CREATE INDEX "recommendation_status_history_createdAt_idx" ON "recommendation_status_history"("createdAt");

-- CreateIndex
CREATE INDEX "recommendation_alert_subscriptions_userId_idx" ON "recommendation_alert_subscriptions"("userId");

-- CreateIndex
CREATE INDEX "recommendation_alert_subscriptions_chatId_idx" ON "recommendation_alert_subscriptions"("chatId");

-- CreateIndex
CREATE INDEX "recommendation_alert_subscriptions_isActive_idx" ON "recommendation_alert_subscriptions"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_alert_subscriptions_userId_key" ON "recommendation_alert_subscriptions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_alert_subscriptions_chatId_key" ON "recommendation_alert_subscriptions"("chatId");

-- CreateIndex
CREATE INDEX "agent_performance_logs_agentType_idx" ON "agent_performance_logs"("agentType");

-- CreateIndex
CREATE INDEX "agent_performance_logs_symbol_idx" ON "agent_performance_logs"("symbol");

-- CreateIndex
CREATE INDEX "agent_performance_logs_outcome_idx" ON "agent_performance_logs"("outcome");

-- CreateIndex
CREATE INDEX "agent_performance_logs_promptVersion_idx" ON "agent_performance_logs"("promptVersion");

-- CreateIndex
CREATE INDEX "agent_performance_logs_createdAt_idx" ON "agent_performance_logs"("createdAt");

-- CreateIndex
CREATE INDEX "screener_run_logs_screenerId_idx" ON "screener_run_logs"("screenerId");

-- CreateIndex
CREATE INDEX "screener_run_logs_source_idx" ON "screener_run_logs"("source");

-- CreateIndex
CREATE INDEX "screener_run_logs_status_idx" ON "screener_run_logs"("status");

-- CreateIndex
CREATE INDEX "screener_run_logs_createdAt_idx" ON "screener_run_logs"("createdAt");

-- CreateIndex
CREATE INDEX "system_health_logs_metricType_idx" ON "system_health_logs"("metricType");

-- CreateIndex
CREATE INDEX "system_health_logs_source_idx" ON "system_health_logs"("source");

-- CreateIndex
CREATE INDEX "system_health_logs_createdAt_idx" ON "system_health_logs"("createdAt");

-- CreateIndex
CREATE INDEX "unified_events_eventType_idx" ON "unified_events"("eventType");

-- CreateIndex
CREATE INDEX "unified_events_eventSubtype_idx" ON "unified_events"("eventSubtype");

-- CreateIndex
CREATE INDEX "unified_events_source_idx" ON "unified_events"("source");

-- CreateIndex
CREATE INDEX "unified_events_userId_idx" ON "unified_events"("userId");

-- CreateIndex
CREATE INDEX "unified_events_severity_idx" ON "unified_events"("severity");

-- CreateIndex
CREATE INDEX "unified_events_createdAt_idx" ON "unified_events"("createdAt");

-- CreateIndex
CREATE INDEX "worker_tasks_parentTaskId_idx" ON "worker_tasks"("parentTaskId");

-- AddForeignKey
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "worker_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_results" ADD CONSTRAINT "scan_results_configId_fkey" FOREIGN KEY ("configId") REFERENCES "scan_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_result_items" ADD CONSTRAINT "scan_result_items_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "scan_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backtest_trades" ADD CONSTRAINT "backtest_trades_runId_fkey" FOREIGN KEY ("runId") REFERENCES "backtest_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rebalancer_configs" ADD CONSTRAINT "rebalancer_configs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fo_positions" ADD CONSTRAINT "fo_positions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "alert_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_recommendation_stocks" ADD CONSTRAINT "daily_recommendation_stocks_runId_fkey" FOREIGN KEY ("runId") REFERENCES "daily_recommendation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_recommendation_stocks" ADD CONSTRAINT "daily_recommendation_stocks_trackerId_fkey" FOREIGN KEY ("trackerId") REFERENCES "recommendation_trackers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_status_history" ADD CONSTRAINT "recommendation_status_history_trackerId_fkey" FOREIGN KEY ("trackerId") REFERENCES "recommendation_trackers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
