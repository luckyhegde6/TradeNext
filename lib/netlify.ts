/**
 * Robust Netlify runtime detection (v3.40.1).
 *
 * The Netlify Next.js server-handler runtime does NOT set `NETLIFY` (the
 * classic Functions env var — observed absent on prod via /api/health), yet
 * Netlify Blobs IS available there: the framework adapter injects the Blobs
 * context per-request via connectLambda(event) (process.env.NETLIFY_BLOBS_CONTEXT
 * or globalThis.netlifyBlobsContext). Detection therefore checks multiple
 * independent signals instead of a single flag, so the SQLite-mirror Blobs
 * path (cold-start recovery during a Prisma plan-limit hold) engages on
 * Netlify while staying false on local/dev.
 */

/**
 * True when the process is running inside a Netlify runtime (build, Functions,
 * Next.js server handler). Falls back to the Functions-region + production-env
 * combo because the Next server-handler keeps AWS_REGION while omitting
 * NETLIFY itself.
 */
export function isNetlifyRuntime(): boolean {
  const env = process.env;
  if (env.NETLIFY === "true") return true;
  if (env.NETLIFY_BLOBS_REGION) return true; // e.g. us-east-2 (observed on prod deploy config)
  if (env.NETLIFY_BLOBS_CONTEXT) return true; // per-request adapter injection
  if (env.NETLIFY_SITE_ID) return true;
  if (env.NETLIFY_DEPLOY_ID) return true;
  if (env.NETLIFY_AUTH_TOKEN) return true;
  // Functions runtime region + production combo (Next server-handler keeps
  // AWS_REGION while omitting NETLIFY itself).
  if (env.ENVIRONMENT === "production" && env.AWS_REGION) return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (g && g.netlifyBlobsContext) return true;
  return false;
}

/**
 * True when the per-request Netlify Blobs context is currently injected (the
 * Next adapter sets it on every request — but NOT at boot/instrumentation).
 */
export function netlifyBlobsContextAvailable(): boolean {
  if (process.env.NETLIFY_BLOBS_CONTEXT) return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  return !!(g && g.netlifyBlobsContext);
}