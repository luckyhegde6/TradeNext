import { nseFetch } from "@/lib/nse-client";
import { getWithSWR } from "@/lib/cache-swr";

export async function nseFetchSWR<T>(
  cacheKey: string,
  path: string,
  qs = "",
  options?: {
    tier?: "hot" | "normal" | "static";
    ttl?: number;
    swrTtl?: number;
  }
): Promise<{ data: T; stale: boolean }> {
  return getWithSWR<T>(
    cacheKey,
    () => nseFetch(path, qs),
    options
  );
}
