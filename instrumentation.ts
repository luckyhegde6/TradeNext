// instrumentation.ts — Next.js server-lifecycle hook (v3.11.0).
//
// Starts the in-process cron daemon + task worker when the app runs as a
// persistent Node server (next start / npm run dev). The daemon replaces the
// old Netlify scheduled functions: cron schedules now live in the DB and are
// managed through the admin Cron tab.
//
// Opt-out: set CRON_DAEMON_DISABLED=1 (e.g. if the app is still deployed on
// Netlify serverless, where every isolate dies after a request — a daemon per
// cold start would just waste cycles).

import logger from "@/lib/logger";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.CRON_DAEMON_DISABLED === "1") return;

  try {
    const [{ startCronDaemon }, { startWorker }] = await Promise.all([
      import("@/lib/services/worker/cron-daemon"),
      import("@/lib/services/worker/worker-engine"),
    ]);

    // Poll loop picks up the WorkerTasks the daemon spawns (and admin runNow).
    startWorker(5000);
    await startCronDaemon();
    logger.info({ msg: "Cron daemon + worker started via instrumentation" });
  } catch (error) {
    // Never crash server startup — crons can still be started manually from
    // the admin Workers/Cron pages.
    logger.error({ msg: "Failed to auto-start cron daemon via instrumentation", error });
  }
}
