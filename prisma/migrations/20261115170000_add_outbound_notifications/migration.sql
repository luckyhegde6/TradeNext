-- Unified per-recipient outbound notification tracking (Tracks 1-3)
CREATE TABLE IF NOT EXISTS "outbound_notifications" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "channel" TEXT NOT NULL,
    "chatId" TEXT,
    "recipientType" TEXT,
    "recipientId" TEXT,
    "notificationType" TEXT NOT NULL,
    "title" TEXT,
    "message" TEXT NOT NULL,
    "messagePreview" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "source" TEXT,
    "triggeredBy" TEXT,
    "batchId" TEXT,
    "parentId" TEXT,
    "metadata" JSONB,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,

    CONSTRAINT "outbound_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "outbound_notifications_createdAt_idx" ON "outbound_notifications"("createdAt");
CREATE INDEX IF NOT EXISTS "outbound_notifications_status_idx" ON "outbound_notifications"("status");
CREATE INDEX IF NOT EXISTS "outbound_notifications_channel_idx" ON "outbound_notifications"("channel");
CREATE INDEX IF NOT EXISTS "outbound_notifications_notificationType_idx" ON "outbound_notifications"("notificationType");
CREATE INDEX IF NOT EXISTS "outbound_notifications_chatId_idx" ON "outbound_notifications"("chatId");
CREATE INDEX IF NOT EXISTS "outbound_notifications_batchId_idx" ON "outbound_notifications"("batchId");
CREATE INDEX IF NOT EXISTS "outbound_notifications_recipientId_idx" ON "outbound_notifications"("recipientId");
