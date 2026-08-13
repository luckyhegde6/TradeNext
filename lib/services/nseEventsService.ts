// lib/services/nseEventsService.ts
//
// NSE events / notifications feed: GET https://www.nseindia.com/api/eventnotification
// (listing ceremonies, events, webinars) served through the shared
// memory → API → DB chain (getOrFetchSyncedData) so the payload is
// memory-cached, DB-synced only on change, and DB-served only when the
// memory cache is empty AND the NSE call fails.
//
// Client pages consume this via the server-proxy route /api/events — NSE is
// never called from the browser.

import { nseFetch } from "@/lib/nse-client";
import {
  getOrFetchSyncedData,
  type SyncedFetchOptions,
  type SyncedFetchResult,
} from "@/lib/services/syncedDataService";
import { createAuditLog } from "@/lib/audit";
import logger from "@/lib/logger";

/* ─── Types ─── */

export interface NseEvent {
  id: number;
  eventDate: string; // ISO "2026-08-06T00:00:00.000Z"
  title: string;
  categoryName: string;
  slugUrl: string;
  startTimestamp: string | null;
  endTimestamp: string | null;
  dateLabel: string; // "PAST" | "UPCOMING" (as labelled by NSE)
  thumbnailUrl: string | null;
}

/* ─── Cache / sync config ─── */

const EVENTS_CACHE_KEY = "nse_event_notifications";
const EVENTS_CACHE_TTL = 6 * 60 * 60; // 6h — events change a few times a day at most

/* ─── Parsing ─── */

function normalizeThumbnail(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null;
  // NSE serves "//nsearchives.nseindia.com/..." — make it https://
  return url.startsWith("//") ? `https:${url}` : url;
}

function isNseEventRaw(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.ID !== "undefined" && typeof v.TITLE === "string";
}

function mapEvent(raw: Record<string, unknown>): NseEvent {
  return {
    id: Number(raw.ID) || 0,
    eventDate: typeof raw.EVENT_DATE === "string" ? raw.EVENT_DATE : new Date().toISOString(),
    title: String(raw.TITLE ?? "").trim(),
    categoryName: String(raw.CATEGORY_NAME ?? "Event"),
    slugUrl: String(raw.SLUG_URL ?? ""),
    startTimestamp: typeof raw.EVENT_START_TIMESTAMP === "string" ? raw.EVENT_START_TIMESTAMP : null,
    endTimestamp: typeof raw.EVENT_END_TIMESTAMP === "string" ? raw.EVENT_END_TIMESTAMP : null,
    dateLabel: String(raw.EVENT_DATE_LABEL ?? "PAST"),
    thumbnailUrl: normalizeThumbnail(raw.THUMBNAIL_URL),
  };
}

/* ─── Fetcher ─── */

/**
 * NSE events / notifications feed.
 * API: GET https://www.nseindia.com/api/eventnotification
 * Response: { success, data: [ { ID, EVENT_DATE, TITLE, CATEGORY_NAME,
 * SLUG_URL, EVENT_START_TIMESTAMP, EVENT_END_TIMESTAMP, EVENT_DATE_LABEL,
 * THUMBNAIL_URL } ] }.
 * Server-side proxy only via nseFetch. Read path: memory cache → NSE API →
 * market_cache DB (fallback only). DB write: only when payload changed.
 */
export async function getNseEvents(
  forceRefresh = false
): Promise<SyncedFetchResult<NseEvent[]>> {
  const options: SyncedFetchOptions<NseEvent[]> = {
    cacheKey: EVENTS_CACHE_KEY,
    dataType: "nse_events",
    ttlSeconds: EVENTS_CACHE_TTL,
    fetchFromApi: async () => {
      const raw = (await nseFetch(
        "https://www.nseindia.com/api/eventnotification"
      )) as unknown;

      const body = raw as Record<string, unknown> | null;
      const rows = Array.isArray(body?.data) ? body.data : [];
      // Keep NSE-native ordering (most recent first).
      return rows.filter(isNseEventRaw).map((e) => mapEvent(e as unknown as Record<string, unknown>));
    },
  };

  const result = await getOrFetchSyncedData(options, forceRefresh);
  logger.debug({ msg: "NSE events fetched", count: result.data.length, source: result.source });
  createAuditLog({
    action: "EVENTS_FETCH",
    resource: "nse_events",
    path: "/api/events",
    responseStatus: 200,
    metadata: { count: result.data.length, source: result.source },
  }).catch(() => undefined);
  return result;
}