const hits = new Map<string, { count: number; ts: number }>();

export function rateLimit(
  key: string,
  limit = 60,
  windowMs = 60_000
) {
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || now - entry.ts > windowMs) {
    hits.set(key, { count: 1, ts: now });
    return true;
  }

  if (entry.count >= limit) return false;

  entry.count++;
  return true;
}
