-- AlterTable
ALTER TABLE "worker_tasks" ADD COLUMN     "cronJobId" TEXT,
ADD COLUMN     "taskCategory" TEXT NOT NULL DEFAULT 'regular';

-- CreateIndex
CREATE INDEX "worker_tasks_taskCategory_idx" ON "worker_tasks"("taskCategory");
