// scripts/cleanup-stale-worker-tasks.ts
//
// One-off ops tool: clears STALE/stuck background tasks on the prod DB.
// Safe: dry-run by default — pass `--apply` to actually write.
//
// Usage:
//   npx tsx --env-file=.env.production scripts/cleanup-stale-worker-tasks.ts          # dry-run
//   npx tsx --env-file=.env.production scripts/cleanup-stale-worker-tasks.ts --apply  # write
//
// What it does:
//   1. Reaps WorkerTask rows stuck in "running" for > 20 min (worker lost after the
//      Netlify 15-min background cap / serverless container recycle) -> "failed".
//   2. Reaps DailyRecommendationRun rows stuck in "running" for > 20 min (the AI
//      phase did not complete — 0 AI-analyzed after 14+ min) -> "failed".
//      NOTE: the public recommendations API includes "failed" runs (line 952 of
//      dailyRecommendationService.ts), so today's 50-stock runs become visible.
//   3. De-duplicates CronJob rows by name (keep earliest createdAt — the v3.7.1
//      AI Connection Test row was created twice by a findFirst-then-create race).
//   4. Logs a summary of WorkerTask statuses after the sweep.

import prisma from "../lib/prisma";

// The background fn safety net resolves at 14 min and the Netlify cap is 15 min —
// any "running" task older than 16 min is guaranteed dead (worker container lost).
const STALE_MS = 16 * 60 * 1000;
const apply = process.argv.includes("--apply");

const fmt = (d: Date | null | undefined) =>
  d ? d.toISOString().replace("T", " ").slice(0, 19) + " UTC" : "-";

async function reapStaleWorkerTasks() {
  const cutoff = new Date(Date.now() - STALE_MS);
  const stale = await prisma.workerTask.findMany({
    where: { status: "running", startedAt: { lt: cutoff } },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\n=== WorkerTask stale "running" (started before ${fmt(cutoff)}) ===`);
  if (stale.length === 0) console.log("  (none)");

  for (const t of stale) {
    console.log(
      `  [${apply ? "APPLY" : "DRY"}] ${t.name} | ${t.taskType} | created ${fmt(t.createdAt)} | started ${fmt(t.startedAt)} | retries ${t.retryCount}/${t.maxRetries}`,
    );
    if (apply) {
      await prisma.workerTask.update({
        where: { id: t.id },
        data: {
          status: "failed",
          error: "Stale task reaped (no completion within 20 min; worker likely lost)",
          completedAt: new Date(),
        },
      });
    }
  }
  return stale.length;
}

async function reapStaleRuns() {
  const cutoff = new Date(Date.now() - STALE_MS);
  const stale = await prisma.dailyRecommendationRun.findMany({
    where: { status: "running", createdAt: { lt: cutoff } },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { stocks: true } } },
  });

  console.log(`\n=== DailyRecommendationRun stale "running" (created before ${fmt(cutoff)}) ===`);
  if (stale.length === 0) console.log("  (none)");

  for (const r of stale) {
    console.log(
      `  [${apply ? "APPLY" : "DRY"}] run ${r.id.slice(0, 8)} | ${fmt(r.runDate)} | stocks ${r._count.stocks} | aiProcessed ${r.aiProcessed} | aiFailed ${r.aiFailed} | triggeredBy ${r.triggeredBy}`,
    );
    if (apply) {
      await prisma.dailyRecommendationRun.update({
        where: { id: r.id },
        data: {
          status: "failed",
          errorMessage:
            "Stale run reaped (AI phase did not complete within 20 min; worker likely lost)",
          completedAt: new Date(),
        },
      });
    }
  }
  return stale.length;
}

async function dedupeCronJobs() {
  const jobs = await prisma.cronJob.findMany({ orderBy: { createdAt: "asc" } });
  const byName = new Map<string, typeof jobs>();
  for (const j of jobs) {
    const list = byName.get(j.name) ?? [];
    list.push(j);
    byName.set(j.name, list);
  }

  console.log("\n=== CronJob duplicates by name ===");
  let removed = 0;
  for (const [name, list] of byName) {
    if (list.length <= 1) continue;
    const [keep, ...dupes] = list;
    console.log(`  "${name}" -> ${list.length} rows, keeping id ${keep.id.slice(0, 8)} (${fmt(keep.createdAt)})`);
    for (const d of dupes) {
      console.log(`    [${apply ? "APPLY" : "DRY"}] delete id ${d.id.slice(0, 8)} (${fmt(d.createdAt)})`);
      if (apply) await prisma.cronJob.delete({ where: { id: d.id } });
      removed++;
    }
  }
  if (removed === 0) console.log("  (no duplicates)");
  return removed;
}

async function summary() {
  const byStatus = await prisma.workerTask.groupBy({
    by: ["status"],
    _count: { status: true },
  });
  const runStatus = await prisma.dailyRecommendationRun.groupBy({
    by: ["status"],
    _count: { status: true },
  });
  console.log("\n=== After-sweep counts ===");
  console.log(
    "  WorkerTask: " + byStatus.map((s) => `${s.status}=${s._count.status}`).join(", ") || "  (none)",
  );
  console.log(
    "  DailyRecommendationRun: " +
      (runStatus.map((s) => `${s.status}=${s._count.status}`).join(", ") || "(none)"),
  );
}

async function main() {
  console.log(`cleanup-stale-worker-tasks: mode=${apply ? "APPLY" : "DRY-RUN"}`);
  const [wt, runs, crons] = await Promise.all([
    reapStaleWorkerTasks(),
    reapStaleRuns(),
    dedupeCronJobs(),
  ]);
  await summary();
  console.log(
    `\nDone. Would touch: ${wt} worker task(s), ${runs} run(s), ${crons} cron duplicate(s).` +
      (apply ? "" : " Re-run with --apply to write."),
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
