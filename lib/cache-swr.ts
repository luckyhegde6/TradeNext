import cache, { hotCache, staticCache } from "@/lib/cache";

/**
 * Cache tiers:
 * - hotCache    → ultra-frequent market data (gainers, losers)
 * - cache       → normal NSE analytics
 * - staticCache → corporate info, reference data
 */

type CacheTier = "hot" | "normal" | "static";

const tierMap = {
  hot: hotCache,
  normal: cache,
  static: staticCache,
};

type CachedResult<T> = {
  data: T;
  stale: boolean;
};

/**
 * Stale-While-Revalidate cache access
 */
export async function getWithSWR<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: {
    tier?: CacheTier;
    ttl?: number;       // seconds
    swrTtl?: number;    // seconds after expiry to allow stale
  } = {}
): Promise<CachedResult<T>> {
  const {
    tier = "normal",
    ttl = 30,
    swrTtl = 30,
  } = options;

  const store = tierMap[tier];

  const cached = store.get<T>(key);
  if (cached) {
    return { data: cached, stale: false };
  }

  // expired but still in SWR window?
  const raw = store.getTtl(key);
  if (raw && Date.now() - raw < swrTtl * 1000) {
    // trigger background revalidation
    revalidate(key, fetcher, store, ttl);
    return { data: store.get(key) as T, stale: true };
  }

  // hard miss → fetch synchronously
  const fresh = await fetcher();
  store.set(key, fresh, ttl);
  return { data: fresh, stale: false };
}

async function revalidate<T>(
  key: string,
  fetcher: () => Promise<T>,
  store: typeof cache,
  ttl: number
) {
  try {
    const fresh = await fetcher();
    store.set(key, fresh, ttl);
  } catch {
    // swallow background errors intentionally
  }
}
