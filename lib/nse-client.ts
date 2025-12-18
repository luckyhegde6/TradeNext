// lib/nse-client.ts
import fetch from "node-fetch";
import { CookieJar } from "tough-cookie";
import fetchCookie from "fetch-cookie";
import Redis from "ioredis";

// Redis is only available in local development environments
let redis: Redis | null = null;
if (process.env.REDIS_URL || process.env.NODE_ENV === 'development') {
  try {
    redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
    redis.on('error', (err) => {
      console.warn('Redis connection error (this is normal in production):', err.message);
      redis = null;
    });
  } catch (error) {
    console.warn('Failed to initialize Redis (this is normal in production):', error);
    redis = null;
  }
}

const jar = new CookieJar();
const fetchWithCookies = fetchCookie(fetch, jar);

const NSE_BASE = "https://www.nseindia.com";

async function ensureSession() {
  // If jar empty or expired, fetch homepage to get cookies (bm, etc.)
  const cookies = await jar.getCookies(NSE_BASE);
  if (!cookies || cookies.length === 0) {
    // fetch landing page to set cookies (User-Agent + Referer)
    await fetchWithCookies(NSE_BASE + "/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "text/html,application/xhtml+xml",
        "Referer": "https://www.nseindia.com/",
      },
      timeout: 10000,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }
}

async function nseFetch(path: string, qs = "") {
  await ensureSession();
  const url = NSE_BASE + path + qs;
  console.log(`[NSE Fetch] ${url}`);
  const resp = await fetchWithCookies(url, {
    headers: {
      "Accept": "application/json, text/plain, */*",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "Referer": "https://www.nseindia.com/",
    },
    timeout: 15000,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (!resp.ok) {
    console.error(`[NSE Error] ${resp.status} ${resp.statusText} for ${url}`);
    throw new Error(`NSE fetch failed ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((data as any).error) {
    console.error("[NSE Data Error]", JSON.stringify(data));
  }
  return data;
}

export { nseFetch, redis };
