-- CreateTable
CREATE TABLE "api_request_logs" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" INTEGER,
    "userEmail" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "queryParams" TEXT,
    "statusCode" INTEGER,
    "responseTime" INTEGER,
    "errorMessage" TEXT,
    "isNSE" BOOLEAN NOT NULL DEFAULT false,
    "nseEndpoint" TEXT,
    "isRateLimited" BOOLEAN NOT NULL DEFAULT false,
    "isAnomaly" BOOLEAN NOT NULL DEFAULT false,
    "anomalyType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_configs" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "identifierType" TEXT NOT NULL,
    "endpoint" TEXT,
    "limit" INTEGER NOT NULL DEFAULT 100,
    "windowSeconds" INTEGER NOT NULL DEFAULT 60,
    "currentCount" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3),
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "blockReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anomaly_alerts" (
    "id" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "identifier" TEXT,
    "identifierType" TEXT,
    "endpoint" TEXT,
    "metadata" JSONB,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anomaly_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_request_logs_requestId_key" ON "api_request_logs"("requestId");

-- CreateIndex
CREATE INDEX "api_request_logs_userId_idx" ON "api_request_logs"("userId");

-- CreateIndex
CREATE INDEX "api_request_logs_ipAddress_idx" ON "api_request_logs"("ipAddress");

-- CreateIndex
CREATE INDEX "api_request_logs_path_idx" ON "api_request_logs"("path");

-- CreateIndex
CREATE INDEX "api_request_logs_statusCode_idx" ON "api_request_logs"("statusCode");

-- CreateIndex
CREATE INDEX "api_request_logs_isNSE_idx" ON "api_request_logs"("isNSE");

-- CreateIndex
CREATE INDEX "api_request_logs_isAnomaly_idx" ON "api_request_logs"("isAnomaly");

-- CreateIndex
CREATE INDEX "api_request_logs_createdAt_idx" ON "api_request_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_configs_identifier_key" ON "rate_limit_configs"("identifier");

-- CreateIndex
CREATE INDEX "rate_limit_configs_identifier_idx" ON "rate_limit_configs"("identifier");

-- CreateIndex
CREATE INDEX "rate_limit_configs_identifierType_idx" ON "rate_limit_configs"("identifierType");

-- CreateIndex
CREATE INDEX "rate_limit_configs_isBlocked_idx" ON "rate_limit_configs"("isBlocked");

-- CreateIndex
CREATE INDEX "anomaly_alerts_alertType_idx" ON "anomaly_alerts"("alertType");

-- CreateIndex
CREATE INDEX "anomaly_alerts_severity_idx" ON "anomaly_alerts"("severity");

-- CreateIndex
CREATE INDEX "anomaly_alerts_isResolved_idx" ON "anomaly_alerts"("isResolved");

-- CreateIndex
CREATE INDEX "anomaly_alerts_createdAt_idx" ON "anomaly_alerts"("createdAt");
