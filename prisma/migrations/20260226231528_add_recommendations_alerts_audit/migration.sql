-- CreateTable
CREATE TABLE "stock_recommendations" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "entryRange" TEXT,
    "shortTerm" TEXT,
    "longTerm" TEXT,
    "intraday" TEXT,
    "recommendation" TEXT NOT NULL,
    "analystRating" TEXT,
    "profitRangeMin" DECIMAL(30,2),
    "profitRangeMax" DECIMAL(30,2),
    "targetPrice" DECIMAL(30,2),
    "analysis" TEXT,
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_alerts" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "symbol" TEXT,
    "alertType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "targetPrice" DECIMAL(30,2),
    "currentPrice" DECIMAL(30,2),
    "status" TEXT NOT NULL DEFAULT 'active',
    "triggeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" INTEGER,
    "userEmail" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "resourceId" TEXT,
    "method" TEXT,
    "path" TEXT,
    "requestBody" JSONB,
    "responseStatus" INTEGER,
    "responseTime" INTEGER,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "nseEndpoint" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "endpoint" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isFlagged" BOOLEAN NOT NULL DEFAULT false,
    "lastRequestAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_recommendations_symbol_idx" ON "stock_recommendations"("symbol");

-- CreateIndex
CREATE INDEX "stock_recommendations_isActive_idx" ON "stock_recommendations"("isActive");

-- CreateIndex
CREATE INDEX "user_alerts_userId_idx" ON "user_alerts"("userId");

-- CreateIndex
CREATE INDEX "user_alerts_status_idx" ON "user_alerts"("status");

-- CreateIndex
CREATE INDEX "user_alerts_createdAt_idx" ON "user_alerts"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs"("resource");

-- CreateIndex
CREATE INDEX "rate_limits_userId_idx" ON "rate_limits"("userId");

-- CreateIndex
CREATE INDEX "rate_limits_isFlagged_idx" ON "rate_limits"("isFlagged");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limits_userId_endpoint_key" ON "rate_limits"("userId", "endpoint");
