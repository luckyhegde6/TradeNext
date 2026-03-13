-- AlterTable
ALTER TABLE "symbols" ADD COLUMN     "lastPrice" DECIMAL(30,6),
ADD COLUMN     "lastUpdated" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "cron_jobs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "taskType" TEXT NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRun" TIMESTAMP(3),
    "nextRun" TIMESTAMP(3),
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB,
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cron_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_tasks" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "priority" INTEGER NOT NULL DEFAULT 5,
    "payload" JSONB,
    "result" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "createdBy" INTEGER,
    "assignedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_status" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "workerName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "currentTaskId" TEXT,
    "tasksCompleted" INTEGER NOT NULL DEFAULT 0,
    "tasksFailed" INTEGER NOT NULL DEFAULT 0,
    "lastHeartbeat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cpuUsage" DOUBLE PRECISION,
    "memoryUsage" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_snapshots" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "companyName" TEXT,
    "lastPrice" DECIMAL(30,6),
    "change" DECIMAL(30,6),
    "pChange" DECIMAL(30,6),
    "open" DECIMAL(30,6),
    "high" DECIMAL(30,6),
    "low" DECIMAL(30,6),
    "previousClose" DECIMAL(30,6),
    "volume" BIGINT,
    "value" DECIMAL(30,6),
    "yearHigh" DECIMAL(30,6),
    "yearLow" DECIMAL(30,6),
    "pe" DECIMAL(30,6),
    "pb" DECIMAL(30,6),
    "dividendYield" DECIMAL(30,6),
    "sector" TEXT,
    "industry" TEXT,
    "marketCap" DECIMAL(30,6),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screener_configs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "filters" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "userId" INTEGER,
    "lastRun" TIMESTAMP(3),
    "lastResultCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "screener_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screener_results" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "companyName" TEXT,
    "lastPrice" DECIMAL(30,6),
    "change" DECIMAL(30,6),
    "pChange" DECIMAL(30,6),
    "volume" BIGINT,
    "avgVolume" BIGINT,
    "marketCap" DECIMAL(30,6),
    "peRatio" DECIMAL(30,6),
    "pbRatio" DECIMAL(30,6),
    "roe" DECIMAL(30,6),
    "debtToEquity" DECIMAL(30,6),
    "eps" DECIMAL(30,6),
    "bookValue" DECIMAL(30,6),
    "dividendYield" DECIMAL(30,6),
    "sector" TEXT,
    "industry" TEXT,
    "technicalRating" TEXT,
    "analystRating" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screener_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cron_jobs_taskType_idx" ON "cron_jobs"("taskType");

-- CreateIndex
CREATE INDEX "cron_jobs_isActive_idx" ON "cron_jobs"("isActive");

-- CreateIndex
CREATE INDEX "worker_tasks_status_idx" ON "worker_tasks"("status");

-- CreateIndex
CREATE INDEX "worker_tasks_taskType_idx" ON "worker_tasks"("taskType");

-- CreateIndex
CREATE INDEX "worker_tasks_priority_idx" ON "worker_tasks"("priority");

-- CreateIndex
CREATE INDEX "worker_tasks_createdAt_idx" ON "worker_tasks"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "worker_status_workerId_key" ON "worker_status"("workerId");

-- CreateIndex
CREATE INDEX "stock_snapshots_symbol_idx" ON "stock_snapshots"("symbol");

-- CreateIndex
CREATE INDEX "stock_snapshots_capturedAt_idx" ON "stock_snapshots"("capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "stock_snapshots_symbol_capturedAt_key" ON "stock_snapshots"("symbol", "capturedAt");

-- CreateIndex
CREATE INDEX "screener_configs_userId_idx" ON "screener_configs"("userId");

-- CreateIndex
CREATE INDEX "screener_results_configId_idx" ON "screener_results"("configId");

-- CreateIndex
CREATE INDEX "screener_results_symbol_idx" ON "screener_results"("symbol");

-- CreateIndex
CREATE INDEX "screener_results_createdAt_idx" ON "screener_results"("createdAt");
