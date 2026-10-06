-- CreateTable
CREATE TABLE "google_sheets_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "sheetId" TEXT,
    "displayName" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" TIMESTAMP(3),
    "tabMarks" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_sheets_config_pkey" PRIMARY KEY ("id")
);
