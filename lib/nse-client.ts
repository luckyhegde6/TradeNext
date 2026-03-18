// lib/nse-client.ts
import { CookieJar } from "tough-cookie";
import fetchCookie from "fetch-cookie";
import logger, { trackNseApiCall } from "@/lib/logger";
import { logAPIRequest } from "@/lib/rate-limit";
import crypto from "crypto";

// Determine if we're in production (Netlify)
const isProduction = process.env.NODE_ENV === "production";

// Increase timeout in production (slower serverless functions)
const REQUEST_TIMEOUT = isProduction ? 25000 : 10000; // 25s for prod, 10s for dev
const FETCH_TIMEOUT = isProduction ? 20000 : 8000; // 20s for prod, 8s for dev
const MAX_RETRIES = isProduction ? 3 : 1; // More retries in prod

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
      timeout: REQUEST_TIMEOUT,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }
}

async function nseFetch(path: string, qs = "", retryCount = 0) {
  await initFetch();
  await ensureSession();
  const fullUrl = path.startsWith("http") ? path + qs : NSE_BASE + path + qs;
  const endpoint = path + qs;
  const startTime = Date.now();

  const requestId = crypto.randomUUID();

  logger.info({ msg: `[NSE Fetch] ${fullUrl} (attempt ${retryCount + 1})`, requestId });
  trackNseApiCall(endpoint, 'GET', 'pending');

  // Initial log entry in DB
  logAPIRequest({
    requestId,
    method: 'GET',
    path: fullUrl,
    isNSE: true,
    nseEndpoint: endpoint,
    statusCode: 0, // Pending
  }).catch(err => logger.error({ msg: "Failed to create initial NSE API log", error: err }));

  // Add overall timeout for the entire request
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const resp = await fetchWithCookies!(fullUrl, {
      headers: {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Referer": "https://www.nseindia.com/",
      },
      timeout: FETCH_TIMEOUT,
      signal: controller.signal,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;

    if (!resp.ok) {
      logger.error(`[NSE Error] ${resp.status} ${resp.statusText} for ${fullUrl}`, { requestId });
      trackNseApiCall(endpoint, 'GET', 'error', responseTime, `${resp.status} ${resp.statusText}`);

      logAPIRequest({
        requestId,
        method: 'GET',
        path: fullUrl,
        isNSE: true,
        nseEndpoint: endpoint,
        statusCode: resp.status,
        responseTime,
        errorMessage: `${resp.status} ${resp.statusText}`
      }).catch(err => logger.error({ msg: "Failed to update NSE API error log", error: err }));

      throw new Error(`NSE fetch failed ${resp.status} ${resp.statusText}`);
    }

    const data = await resp.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((data as any).error) {
      logger.error({ msg: "[NSE Data Error]", data: JSON.stringify(data) });
    }

    trackNseApiCall(endpoint, 'GET', 'success', responseTime);

    logAPIRequest({
      requestId,
      method: 'GET',
      path: fullUrl,
      isNSE: true,
      nseEndpoint: endpoint,
      statusCode: 200,
      responseTime
    }).catch(err => logger.error({ msg: "Failed to update NSE API success log", error: err }));

    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;

    if (error instanceof Error && error.name === 'AbortError') {
      logger.warn({ msg: `[NSE Timeout] Request timed out for ${fullUrl}, retry ${retryCount + 1}/${MAX_RETRIES}` });
      trackNseApiCall(endpoint, 'GET', 'error', responseTime, 'Timeout');

      // Retry logic
      if (retryCount < MAX_RETRIES) {
        // Wait before retrying (exponential backoff)
        const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
        await new Promise(resolve => setTimeout(resolve, delay));
        return nseFetch(path, qs, retryCount + 1);
      }

      logger.error({ msg: `[NSE Timeout] All retries exhausted for ${fullUrl}` });
      throw new Error(`NSE request timeout for ${fullUrl}`);
    }

    trackNseApiCall(endpoint, 'GET', 'error', responseTime, error instanceof Error ? error.message : String(error));

    logAPIRequest({
      requestId,
      method: 'GET',
      path: fullUrl,
      isNSE: true,
      nseEndpoint: endpoint,
      statusCode: 500,
      responseTime,
      errorMessage: error instanceof Error ? error.message : String(error)
    }).catch(err => logger.error({ msg: "Failed to update NSE API exception log", error: err }));

    throw error;
  }
}

export { nseFetch };
