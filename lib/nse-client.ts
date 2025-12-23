// lib/nse-client.ts
import { CookieJar } from "tough-cookie";
import fetchCookie from "fetch-cookie";
import logger from "@/lib/logger";
// Dynamic imports to avoid webpack bundling issues
let fetch: any = null;
let jar: CookieJar | null = null;
let fetchWithCookies: any = null;

const NSE_BASE = "https://www.nseindia.com";

async function initFetch() {
  if (!fetch) {
    const fetchModule = await import("node-fetch");
    fetch = fetchModule.default;

    jar = new CookieJar();
    fetchWithCookies = fetchCookie(fetch, jar);
  }
}

async function ensureSession() {
  await initFetch();

  // If jar empty or expired, fetch homepage to get cookies (bm, etc.)
  const cookies = await jar!.getCookies(NSE_BASE);
  if (!cookies || cookies.length === 0) {
    // fetch landing page to set cookies (User-Agent + Referer)
    await fetchWithCookies!(NSE_BASE + "/", {
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
  await initFetch();
  await ensureSession();
  const url = path.startsWith("http") ? path + qs : NSE_BASE + path + qs;
  logger.info({ msg: `[NSE Fetch] ${url}` });

  // Add overall timeout for the entire request
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

  try {
    const resp = await fetchWithCookies!(url, {
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
      logger.error(`[NSE Error] ${resp.status} ${resp.statusText} for ${url}`);
      throw new Error(`NSE fetch failed ${resp.status} ${resp.statusText}`);
    }

    const data = await resp.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((data as any).error) {
      logger.error({ msg: "[NSE Data Error]", data: JSON.stringify(data) });
    }
    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      logger.error({ msg: `[NSE Timeout] Request timed out for ${url}` });
      throw new Error(`NSE request timeout for ${url}`);
    }
    throw error;
  }
}

export { nseFetch };
