// lib/services/worker/cron-daemon.ts
// In-process cron scheduler (v3.11.0) that replaces the Netlify scheduled
// functions. Runs inside the persistent Node server (next start / npm run dev)
// via instrumentation.ts; schedules are managed through the admin Cron tab.
//
// Design:
//   - On start: ensure the SYSTEM recommendation cron rows exist, then load all
//     active CronJob rows and register one node-cron task per job.
//   - Re-sync every 60s: admin edits (new job / expression change / deactivate)
//     are applied without a restart.
//   - Each fire re-fetches the job row and delegates to the shared
//     spawnDueCronJob (dedup guard + nextRun advance), so the in-process daemon
//     and the legacy 60s poll scheduler behave identically.
//   - Heartbeat written to worker_status as `cron-daemon-<host>-<pid>`.

import cron from "node-cron";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import os from "os";
import { spawnDueCronJob } from "./worker-engine";

const DEFAULT_TIMEZONE = "Asia/Kolkata"; // NSE market timezone for all cron schedules
// v3.20.1: intervals tuned to stay under 10K Prisma Postgres ops/day.
const RESYNC_INTERVAL_MS = 300_000; // 5 min — was 60s (saves ~1,296 reads/day). Admin edits wait ≤5 min.
const HEARTBEAT_INTERVAL_MS = 900_000; // 15 min — was 5 min (saves ~192 writes/day). Admin Cron tab refreshes every 60s anyway.
/** A heartbeat older than this is treated as "daemon down" (2x heartbeat cadence). */
export const DAEMON_HEARTBEAT_WINDOW_MS = 2 * HEARTBEAT_INTERVAL_MS;
export const DAEMON_ID = `cron-daemon-${os.hostname()}-${process.pid}`;

interface RegisteredTask {
  task: ReturnType<typeof cron.schedule>;
  expression: string;
}

let running = false;
let resyncInterval: NodeJS.Timeout | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;
let lastHeartbeatAt: Date | null = null;
const tasks = new Map<string, RegisteredTask>();

/**
 * Start the cron daemon. Idempotent — safe to call from instrumentation.ts
 * and the admin engine route.
 */
export async function startCronDaemon(): Promise<{ alreadyRunning: boolean; registeredJobs: number }> {
  if (running) return { alreadyRunning: true, registeredJobs: tasks.size };
  running = true;
  lastHeartbeatAt = null;

  logger.info({ msg: "Starting cron daemon", daemonId: DAEMON_ID, timezone: DEFAULT_TIMEZONE });

  // Self-heal: ensure the SYSTEM-managed recommendation cron rows exist
  // before scheduling anything.
  try {
    const { ensureRecommendationCrons } = await import("@/lib/services/recommendationCronService");
    const res = await ensureRecommendationCrons();
    logger.info({ msg: "Recommendation crons ensured", jobs: res.jobs.length });
  } catch (error) {
    // v3.12.0: pass the MESSAGE — pino drops non-enumerable Error props.
    logger.warn({ msg: "Failed to ensure recommendation crons", error: error instanceof Error ? error.message : String(error) });
  }

  await syncCronJobs();

  resyncInterval = setInterval(() => {
    syncCronJobs().catch((error) => logger.error({ msg: "Cron daemon resync failed", error: error instanceof Error ? error.message : String(error) }));
    // v3.13.0: drain the swing analysis job queue every tick. The DB-backed
    // job survives instance recycle — when the process that created it dies
    // mid-analysis, the stale-running recovery + claim here picks it back up
    // (never throws; module-guarded in-flight).
    import("@/lib/services/swingRecommendationService")
      .then((m) => m.maybeProcessSwingAnalysis())
      .catch((error) =>
        logger.error({ msg: "Swing analysis drain failed", error: error instanceof Error ? error.message : String(error) }),
      );
  }, RESYNC_INTERVAL_MS);

  heartbeatInterval = setInterval(() => {
    writeHeartbeat().catch(() => {});
  }, HEARTBEAT_INTERVAL_MS);
  await writeHeartbeat().catch(() => {});

  logger.info({ msg: "Cron daemon started", registeredJobs: tasks.size });
  return { alreadyRunning: false, registeredJobs: tasks.size };
}

/** Stop the daemon — destroys every registered node-cron task. */
export function stopCronDaemon(): void {
  running = false;
  if (resyncInterval) {
    clearInterval(resyncInterval);
    resyncInterval = null;
  }
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  for (const entry of tasks.values()) entry.task.destroy();
  tasks.clear();
  logger.info({ msg: "Cron daemon stopped", daemonId: DAEMON_ID });
}

/**
 * Re-read the active CronJob rows and reconcile the registered node-cron tasks.
 * Exported for tests. Returns the number of registered jobs.
 */
export async function syncCronJobs(): Promise<{ registered: number }> {
  const jobs = await prisma.cronJob.findMany({ where: { isActive: true } });
  const seen = new Set<string>();

  for (const job of jobs) {
    seen.add(job.id);
    const expression = job.cronExpression?.trim() ?? "";
    const existing = tasks.get(job.id);

    if (existing && existing.expression === expression) continue; // unchanged

    if (existing) {
      existing.task.destroy();
      tasks.delete(job.id);
      logger.info({ msg: "Cron job expression changed, re-registering", jobId: job.id, name: job.name });
    }

    if (!expression || !cron.validate(expression)) {
      logger.warn({ msg: "Skipping cron job — invalid expression", jobId: job.id, name: job.name, expression });
      continue;
    }

    const timezone =
      (job.config as Record<string, unknown> | null)?.timezone as string | undefined || DEFAULT_TIMEZONE;
    try {
      const task = cron.schedule(
        expression,
        () => {
          // Fire-and-forget; errors are logged inside fireJob.
          void fireJob(job.id);
        },
        { timezone },
      );
      tasks.set(job.id, { task, expression });
      logger.info({ msg: "Scheduled cron job", jobId: job.id, name: job.name, expression, timezone });
    } catch (error) {
      logger.warn({ msg: "Failed to schedule cron job", jobId: job.id, name: job.name, error: error instanceof Error ? error.message : String(error) });
    }
  }

  // Drop jobs that were deactivated or deleted.
  for (const [id, entry] of tasks) {
    if (!seen.has(id)) {
      entry.task.destroy();
      tasks.delete(id);
      logger.info({ msg: "Unscheduled cron job", jobId: id });
    }
  }

  return { registered: tasks.size };
}

/** node-cron handler — re-fetch the row so admin edits apply immediately. */
async function fireJob(jobId: string): Promise<void> {
  try {
    const job = await prisma.cronJob.findUnique({ where: { id: jobId } });
    if (!job || !job.isActive) return;
    await spawnDueCronJob(job);
  } catch (error) {
    logger.error({ msg: "Cron job fire failed", jobId, error: error instanceof Error ? error.message : String(error) });
  }
}

/** Heartbeat row so /admin sees which host runs the daemon (non-fatal). */
async function writeHeartbeat(): Promise<void> {
  try {
    const mem = process.memoryUsage();
    lastHeartbeatAt = new Date();
    await prisma.workerStatus.upsert({
      where: { workerId: DAEMON_ID },
      create: {
        workerId: DAEMON_ID,
        workerName: `cron-daemon (${os.hostname()})`,
        status: "idle",
        lastHeartbeat: lastHeartbeatAt,
        memoryUsage: mem.heapUsed / 1024 / 1024,
        cpuUsage: os.loadavg()[0],
      },
      update: {
        status: "idle",
        lastHeartbeat: lastHeartbeatAt,
        memoryUsage: mem.heapUsed / 1024 / 1024,
        cpuUsage: os.loadavg()[0],
      },
    });
  } catch (error) {
    // Heartbeat failures are non-fatal — the daemon keeps scheduling in memory.
  }
}

/** Liveness for the admin Cron tab. */
export function getCronDaemonStatus(): {
  running: boolean;
  registeredJobs: number;
  daemonId: string;
  lastHeartbeatAt: Date | null;
} {
  return { running, registeredJobs: tasks.size, daemonId: DAEMON_ID, lastHeartbeatAt };
}

/** Pure: is a heartbeat timestamp fresh enough to consider the daemon running? */
export function isDaemonHeartbeatFresh(
  lastHeartbeat: Date | null,
  now: number = Date.now(),
  windowMs: number = DAEMON_HEARTBEAT_WINDOW_MS,
): boolean {
  if (!lastHeartbeat) return false;
  return now - lastHeartbeat.getTime() <= windowMs;
}

/** Test hook: ids of currently registered cron jobs. */
export function getRegisteredJobIds(): string[] {
  return Array.from(tasks.keys());
}
