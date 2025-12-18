// lib/nse-client.ts
import fetch from "node-fetch";
import { CookieJar } from "tough-cookie";
import fetchCookie from "fetch-cookie";
import Redis from "ioredis";

// Redis is only available when explicitly configured
let redis: Redis | null = null;

if (process.env.REDIS_URL) {
  try {
    redis = new Redis(process.env.REDIS_URL);
    redis.on('error', (err) => {
      console.warn('Redis connection error:', err.message);
      redis = null;
    });
    redis.on('connect', () => {
      console.log('Redis connected successfully');
    });
  } catch (error) {
    console.warn('Failed to initialize Redis:', error);
    redis = null;
  }
} else {
  console.log('Redis not configured - using in-memory cache only');
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

  // Add overall timeout for the entire request
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

  try {
    const resp = await fetchWithCookies(url, {
      headers: {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Referer": "https://www.nseindia.com/",
      },
      timeout: 8000, // 8 second fetch timeout
      signal: controller.signal,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    clearTimeout(timeoutId);

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
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      console.error(`[NSE Timeout] Request timed out for ${url}`);
      throw new Error(`NSE request timeout for ${url}`);
    }
    throw error;
  }
}

export { nseFetch, redis };
