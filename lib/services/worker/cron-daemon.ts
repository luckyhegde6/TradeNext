// lib/services/worker/cron-daemon.ts
// In-process cron scheduler (v3.11.0) that replaces the Netlify scheduled
// functions. Runs inside the persistent Node server (next start / npm run dev)
// via instrumentation.ts; schedules are managed through the admin Cron tab.
//
// Design:
//   - On start: ensure the SYSTEM recommendation cron rows exist, then load all
//     active CronJob rows and register one node-cron task per job.
//   - Re-sync every 5 min: admin edits (new job / expression change / deactivate)
//     are applied without a restart. The same tick runs the Spec 24 missed-tick
//     catch-up (recover jobs the suspended Netlify instance missed).
//   - Each fire re-fetches the job row and delegates to the shared
//     spawnDueCronJob (dedup guard + nextRun advance), so the in-process daemon
//     and the legacy 60s poll scheduler behave identically.
//   - Heartbeat written to worker_status as `cron-daemon-<host>-<pid>`.

import cron from "node-cron";
import prisma from "@/lib/prisma";
import logger from "@/lib/logger";
import os from "os";
import { isDbUnavailableError } from "@/lib/db-utils";
import { isDegradedModeActive } from "@/lib/services/degradedMode";
import { enqueueDegradedTask } from "./degradedQueue";
import { spawnDueCronJob, catchUpMissedCronJobs } from "./worker-engine";

// Cron expressions in this app are authored in UTC (see recommendationCronService:
// "Times are UTC: IST = UTC + 5:30") and `calculateNextRun` (lib/cron-parser.ts)
// evaluates them in UTC on every host. v3.47.0 (spec 25): the default was
// "Asia/Kolkata", so node-cron fired daily jobs 5.5h off the UTC `nextRun` the
// catch-up/admin clock uses — a split-brain that both missed ticks and double-fired
// around DST-free IST boundaries. Register in UTC to match. A per-job
// `config.timezone` still overrides (used by tests / non-UTC user crons).
const DEFAULT_TIMEZONE = "UTC";
// v3.20.1: intervals tuned to stay under 10K Prisma Postgres ops/day.
const RESYNC_INTERVAL_MS = 300_000; // 5 min — was 60s (saves ~1,296 reads/day). Admin edits wait ≤5 min.
const HEARTBEAT_INTERVAL_MS = 900_000; // 15 min — was 5 min (saves ~192 writes/day). Admin Cron tab refreshes every 60s anyway.
/** A heartbeat older than this is treated as "daemon down" (2x heartbeat cadence). */
export const DAEMON_HEARTBEAT_WINDOW_MS = 2 * HEARTBEAT_INTERVAL_MS;
export const DAEMON_ID = `cron-daemon-${os.hostname()}-${process.pid}`;

// v3.25.x: the 5-min resync reads its active-job list from the LOCAL SQLite
// mirror while fresh, falling back to Prisma when empty/stale and reseeding the
// mirror (user directive: "check the SQLITE first"). node-cron schedules purely
// by expression, so a stale nextRun in the mirror is irrelevant to registration;
// nextRun/spawn correctness stays on Prisma via spawnDueCronJob.
const CONTROL_TTL_MS = 5 * 60_000; // cron mirror trusted for 5 min, then reseed
// v3.30.x: the swing-analysis queue drain used to run on EVERY 5-min resync
// tick, issuing 3 Prisma statements (2 stale-recovery updateMany + 1 pending
// findFirst) even when the queue was idle (~36 ops/hr → ~12/hr). Cross-instance
// crash recovery still works — a wedged "running" job is picked up within
// SWING_JOB_STALE_MS (45 min) + this drain window; force=1 and the Swing API
// path also call maybeProcessSwingAnalysis directly.
const SWING_DRAIN_INTERVAL_MS = 900_000; // swing drain throttled to once per 15 min

/** Parse a SQLite-stored config column (JSON string) back to an object. */
function parseConfig(value: unknown): Record<string, unknown> | undefined {
  if (value == null) return undefined;
  if (typeof value === "object") return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Resolve the SQLite fallback singleton (lazy import, never throws). */
async function getSqliteFallback() {
  try {
    const sqlite = await import("@/lib/sqlite");
    return sqlite.getSqliteFallback ? sqlite.getSqliteFallback() : null;
  } catch {
    return null;
  }
}

interface RegisteredTask {
  task: ReturnType<typeof cron.schedule>;
  expression: string;
}

let running = false;
let resyncInterval: NodeJS.Timeout | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;
let lastHeartbeatAt: Date | null = null;
let lastSwingDrainAt = 0;
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

  // Initial registration of the loaded cron rows. If the DB is unavailable
  // (plan-limit hold etc.), degrade gracefully — the periodic resync tick
  // below retries automatically once the DB recovers.
  try {
    await syncCronJobs();
  } catch (error) {
    logger.warn({
      msg: "Cron daemon initial sync deferred (DB unavailable)",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Spec 24: recover jobs whose node-cron tick was missed while the instance
  // was suspended/recycled. Run on boot (a fresh Netlify instance picks up jobs
  // that ticked moments before the recycle) AND on every 5-min resync tick.
  try {
    const res = await catchUpMissedCronJobs();
    if (res.recovered > 0 || res.skipped > 0) {
      logger.info({ msg: "Cron boot catch-up", recovered: res.recovered, skipped: res.skipped });
    }
  } catch (error) {
    logger.warn({
      msg: "Cron boot catch-up deferred (DB unavailable)",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  resyncInterval = setInterval(() => {
    syncCronJobs().catch((error) => {
      if (isDbUnavailableError(error)) {
        // DB down — expected while on a plan-limit hold; keep noise low.
        logger.warn({ msg: "Cron daemon resync deferred (DB unavailable)", error: error instanceof Error ? error.message : String(error) });
      } else {
        logger.error({ msg: "Cron daemon resync failed", error: error instanceof Error ? error.message : String(error) });
      }
    });
    // Spec 24: recover jobs missed while the process was suspended. Guards
    // inside catchUpMissedCronJobs keep this a no-op during a hold/degraded
    // mode, and the spawn dedup guard prevents double firing with node-cron.
    catchUpMissedCronJobs().catch((error) => {
      if (isDbUnavailableError(error)) {
        logger.warn({ msg: "Cron catch-up deferred (DB unavailable)", error: error instanceof Error ? error.message : String(error) });
      } else {
        logger.error({ msg: "Cron catch-up failed", error: error instanceof Error ? error.message : String(error) });
      }
    });
    // v3.47.0 (spec 25): drain the SQLite→Prisma write-behind outbox on the
    // same 5-min tick. Previously the only drains were the 6h recovery probe,
    // an admin "Push to Prisma", and the deploy-time preserve-mirror hook —
    // none survive Netlify's ~2h idle suspension, so rows appended during a
    // process lifetime (audit / api logs / events) sat unsynced for days. The
    // push is breaker-aware (short-circuits while a plan-limit hold is open),
    // re-entrancy-guarded, and leader-gated, so a tick that cannot drain is a
    // safe no-op rather than a duplicate writer.
    import("@/lib/sqlite")
      .then((m) => m.pushSqliteToPrisma())
      .catch((error) =>
        logger.warn({ msg: "Outbox drain failed", error: error instanceof Error ? error.message : String(error) }),
      );
    // v3.13.0: drain the swing analysis job queue (throttled to 1/15min since
    // v3.30.x). The DB-backed job survives instance recycle — when the process
    // that created it dies mid-analysis, the stale-running recovery + claim
    // here picks it back up (never throws; module-guarded in-flight).
    if (Date.now() - lastSwingDrainAt >= SWING_DRAIN_INTERVAL_MS) {
      lastSwingDrainAt = Date.now();
      import("@/lib/services/swingRecommendationService")
        .then((m) => m.maybeProcessSwingAnalysis())
        .catch((error) =>
          logger.error({ msg: "Swing analysis drain failed", error: error instanceof Error ? error.message : String(error) }),
        );
    }
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
  // v3.25.x SQLite-primary: serve the active cron list from the local mirror
  // when fresh; otherwise read Prisma and reseed the mirror.
  const sqlite = await getSqliteFallback();
  let jobs: Array<any>;
  const fresh =
    !!sqlite &&
    typeof sqlite.isControlMirrorFresh === "function" &&
    sqlite.isControlMirrorFresh("cron_job", CONTROL_TTL_MS);

  if (fresh && sqlite) {
    const rows = (sqlite.getCronJobs() || []) as Array<Record<string, unknown>>;
    jobs = rows
      .filter((r) => r.is_active !== false && r.is_active !== 0 && r.id)
      .map((r) => ({
        id: String(r.id),
        name: String(r.name ?? ""),
        cronExpression: r.cron_expression ? String(r.cron_expression) : "",
        isActive: true,
        config: parseConfig(r.config),
      }));
  } else {
    jobs = await prisma.cronJob.findMany({ where: { isActive: true } });
    // Reseed the local mirror so subsequent resyncs hit SQLite.
    for (const j of jobs) sqlite?.upsertCronJob?.(j);
  }

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
    // Spec 25 observability: a system-managed job pinned to a non-UTC timezone
    // is the exact drift this release fixes (prod rows were persisted with
    // `timezone: "Asia/Kolkata"`). ensureRecommendationCrons self-heals the DB
    // row; surface any survivor so a stale row is visible instead of silent.
    if ((job.config as Record<string, unknown> | null)?.systemManaged === true && timezone !== DEFAULT_TIMEZONE) {
      logger.warn({
        msg: "System cron job has a non-UTC timezone; expected DEFAULT_TIMEZONE",
        jobId: job.id,
        name: job.name,
        timezone,
        defaultTimezone: DEFAULT_TIMEZONE,
      });
    }
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
  // v3.45.0 (spec 21): the very first statement below is a Prisma read, so
  // during a plan-limit hold EVERY tick threw and logged — the daemon fired
  // oftenest precisely when it could do least. Under an engaged degraded mode
  // the schedule is already in the SQLite `cron_job` mirror, so the job can be
  // enqueued (and later drained by the elected leader) without Prisma at all.
  //
  // Guarded on `isDegradedModeActive()` alone (spec §E: the breaker does NOT
  // gate this branch — `force`/`threshold` engage without a hold, and an
  // inactive `off` falls straight through to the Prisma read below so today's
  // behaviour is byte-identical). The kill-switch/auto-threshold decision stays
  // in one place (degradedMode), not duplicated here.
  if (isDegradedModeActive()) {
    await enqueueDegradedCronJobFromMirror(jobId);
    return;
  }
  try {
    const job = await prisma.cronJob.findUnique({ where: { id: jobId } });
    if (!job || !job.isActive) return;
    await spawnDueCronJob(job);
  } catch (error) {
    logger.error({ msg: "Cron job fire failed", jobId, error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Enqueue one specific job from the mirror, ignoring whether it is DUE.
 *
 * node-cron only invokes `fireJob` for a schedule it already believes fired, so
 * the due-ness question is settled by the scheduler in memory. What is missing
 * during a hold is the record that the job was owed — which is exactly what the
 * durable queue provides. A job missing from the mirror (never synced) is
 * logged and dropped: we cannot know its task type, and the registry gate
 * refuses unknown types anyway, so guessing would only enqueue noise.
 */
async function enqueueDegradedCronJobFromMirror(jobId: string): Promise<void> {
  try {
    const sqlite = await import("@/lib/sqlite");
    const s = sqlite.getSqliteFallback();
    if (!s?.isReady()) return;
    const job = (s.getCronJobs() || []).find(
      (j: Record<string, unknown>) => j.id === jobId && j.is_active,
    );
    if (!job) {
      logger.warn({ msg: "Degraded: cron job absent from mirror, not enqueuing", jobId });
      return;
    }
    const rawConfig = job.config;
    let config: unknown = rawConfig;
    if (typeof rawConfig === "string" && rawConfig) {
      try {
        config = JSON.parse(rawConfig);
      } catch {
        config = null;
      }
    }
    const id = enqueueDegradedTask({
      id: String(job.id),
      name: String(job.name ?? ""),
      taskType: String(job.task_type ?? job.taskType ?? ""),
      cronExpression: String(job.cron_expression ?? job.cronExpression ?? ""),
      config,
    });
    logger.info({
      msg: "Degraded: cron tick enqueued to durable queue",
      jobId,
      jobName: job.name,
      degradedTaskId: id,
    });
  } catch (error) {
    // Never let the tick throw into node-cron's scheduler loop.
    logger.error({
      msg: "Degraded: cron enqueue failed",
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Heartbeat so /admin sees which host runs the daemon (non-fatal).
 *  v3.22.0: written to the LOCAL SQLite `_backup_meta` (zero Prisma ops) — the
 *  in-memory `lastHeartbeatAt` powers the admin Cron-tab chip, and the SQLite
 *  copy gives shutdown/restart visibility without a 15-min Prisma upsert. */
async function writeHeartbeat(): Promise<void> {
  try {
    lastHeartbeatAt = new Date();
    const sqlite = await import("@/lib/sqlite");
    const s = sqlite.getSqliteFallback();
    if (s?.isReady()) {
      const mem = process.memoryUsage();
      s.writeLivenessHeartbeat("cron-daemon", {
        daemonId: DAEMON_ID,
        registeredJobs: tasks.size,
        memoryUsageMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
      });
    }
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
