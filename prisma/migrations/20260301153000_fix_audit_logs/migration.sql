-- Recreate audit_logs table
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

-- Create indexes for audit_logs
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs"("resource");
