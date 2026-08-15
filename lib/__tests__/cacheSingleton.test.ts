/**
 * Regression test for the cross-module-instance cache bug.
 *
 * Next.js dev (Turbopack) loads instrumentation.ts (worker / cron daemon) and
 * API routes as SEPARATE module graphs. Before the fix, `lib/cache.ts` was
 * evaluated twice → two independent `recommendationsCache` NodeCache instances:
 * the worker's `invalidateRecommendationsCache()` flushed its own copy while
 * the API route kept serving a stale 23h run ("Last updated: 14/8/2026" bug).
 *
 * Fix: `recommendationsCache` lives on `globalThis` (mirrors lib/prisma.ts), so
 * every module instance resolves the SAME NodeCache. These tests simulate two
 * module loads with `jest.resetModules()` and assert identity + cross-flush.
 */

import type NodeCache from "node-cache";

/** Re-import lib/cache.ts fresh, bypassing the jest module registry. */
function freshCacheModule(): { recommendationsCache: NodeCache } {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("@/lib/cache") as { recommendationsCache: NodeCache };
}

afterEach(() => {
  // Tear down the globalThis singleton so tests don't leak into each other.
  delete (globalThis as unknown as { __recommendationsCache?: unknown }).__recommendationsCache;
  jest.resetModules();
});

describe("recommendationsCache cross-module-instance singleton", () => {
  test("two module loads resolve the SAME cache instance", () => {
    const first = freshCacheModule();
    const second = freshCacheModule();

    expect(second.recommendationsCache).toBe(first.recommendationsCache);
  });

  test("value set in one module load is visible in another", () => {
    const first = freshCacheModule();
    const second = freshCacheModule();

    first.recommendationsCache.set("latest", { runId: "run-1" }, 82800);
    const seen = second.recommendationsCache.get("latest");
    expect(seen).toEqual({ runId: "run-1" });
  });

  test("flushAll in one module load invalidates the other (worker → route)", () => {
    const workerInstance = freshCacheModule();
    const routeInstance = freshCacheModule();

    // Worker run persisted a recommendation and the route cached it.
    routeInstance.recommendationsCache.set("latest", { runId: "run-1" }, 82800);
    expect(routeInstance.recommendationsCache.get("latest")).toBeDefined();

    // Worker completes a NEW run and invalidates ITS module instance.
    workerInstance.recommendationsCache.flushAll();

    // The route's cache must now be empty — same underlying NodeCache.
    expect(routeInstance.recommendationsCache.get("latest")).toBeUndefined();
    expect(routeInstance.recommendationsCache.keys()).toHaveLength(0);
  });

  test("keys() reflects writes from the other instance", () => {
    const a = freshCacheModule();
    const b = freshCacheModule();

    a.recommendationsCache.set("k1", 1, 82800);
    b.recommendationsCache.set("k2", 2, 82800);

    const keysA = a.recommendationsCache.keys().sort();
    const keysB = b.recommendationsCache.keys().sort();
    expect(keysA).toEqual(["k1", "k2"]);
    expect(keysB).toEqual(["k1", "k2"]);
  });
});
