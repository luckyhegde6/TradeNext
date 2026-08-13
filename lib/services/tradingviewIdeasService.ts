// lib/services/tradingviewIdeasService.ts
//
// Community trading ideas from TradingView India (filtered to NSE-listed
// instruments), served through the shared memory → API → DB chain
// (getOrFetchSyncedData) so the payload is memory-cached, DB-synced only on
// change, and DB-served only when the memory cache is empty AND the API call
// fails.

import {
  getOrFetchSyncedData,
  type SyncedFetchOptions,
  type SyncedFetchResult,
} from "@/lib/services/syncedDataService";

/* ─── Types ─── */

export interface TradingIdea {
  id: number;
  name: string;
  description: string;
  createdAt: string; // ISO
  dateTimestamp: number;
  chartUrl: string;
  symbolFullName: string; // "NSE:BSE"
  symbolShortName: string; // "BSE"
  exchange: string; // "NSE"
  username: string;
  likesCount: number;
  commentsCount: number;
  viewsCount: number;
  imageUrl?: string;
  isHot: boolean;
  isPicked: boolean;
}

/* ─── Cache / sync config ─── */

const IDEAS_CACHE_KEY = "tradingview_nse_ideas";
const IDEAS_CACHE_TTL = 24 * 60 * 60; // 24h — ideas stream changes slowly

/* ─── Parsing ─── */

interface RawIdeaSymbol {
  name?: string; // "NSE:BSE"
  full_name?: string; // "NSE:BSE"
  short_name?: string; // "BSE"
  exchange?: string; // "NSE"
}

interface RawIdeaUser {
  username?: string;
}

interface RawIdea {
  id?: number | string;
  name?: string;
  description?: string;
  created_at?: string;
  date_timestamp?: number;
  chart_url?: string;
  symbol?: RawIdeaSymbol;
  user?: RawIdeaUser;
  likes_count?: number;
  comments_count?: number;
  views_count?: number;
  image?: { big?: string; middle?: string };
  is_hot?: boolean;
  is_picked?: boolean;
}

function isRawIdea(value: unknown): value is RawIdea {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.name === "string" || typeof v.symbol === "object";
}

function toTradingIdea(raw: RawIdea): TradingIdea {
  const symbol = raw.symbol || {};
  return {
    id: Number(raw.id ?? 0),
    name: raw.name || "",
    description: raw.description || "",
    createdAt: raw.created_at || "",
    dateTimestamp: Number(raw.date_timestamp ?? 0),
    chartUrl: raw.chart_url || "",
    symbolFullName: symbol.full_name || symbol.name || "",
    symbolShortName: symbol.short_name || "",
    exchange: symbol.exchange || "",
    username: raw.user?.username || "",
    likesCount: Number(raw.likes_count ?? 0),
    commentsCount: Number(raw.comments_count ?? 0),
    viewsCount: Number(raw.views_count ?? 0),
    imageUrl: raw.image?.big || raw.image?.middle || undefined,
    isHot: Boolean(raw.is_hot),
    isPicked: Boolean(raw.is_picked),
  };
}

/* ─── Fetcher ─── */

const TV_IDEAS_URL =
  "https://in.tradingview.com/ideas/?component-data-only=1&type=trade";

/**
 * Community trading ideas from TradingView India, filtered to NSE-listed
 * instruments. Server-side fetch only (never from the client).
 *
 * API: GET https://in.tradingview.com/ideas/?component-data-only=1&type=trade
 * Response: { data: { ideas: { data: { items: RawIdea[] } } } }
 * Each item carries symbol.exchange ("NSE" | "BSE" | "NSE_NFO" | …) — we keep
 * only items whose exchange is exactly "NSE" (or a symbol name starting "NSE:").
 *
 * Read path: memory cache → TradingView API → market_cache DB (fallback only).
 * DB write: only when the payload changed (skip identical writes after TTL).
 */
export async function getNseTradingIdeas(
  forceRefresh = false
): Promise<SyncedFetchResult<TradingIdea[]>> {
  const options: SyncedFetchOptions<TradingIdea[]> = {
    cacheKey: IDEAS_CACHE_KEY,
    dataType: "tv_ideas_nse",
    ttlSeconds: IDEAS_CACHE_TTL,
    fetchFromApi: async () => {
      const response = await fetch(TV_IDEAS_URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`TradingView ideas API error: ${response.status}`);
      }

      const payload = (await response.json()) as unknown;
      const root = payload as {
        data?: { ideas?: { data?: { items?: unknown[] } } };
      };
      const items = Array.isArray(root.data?.ideas?.data?.items)
        ? (root.data.ideas.data.items as unknown[])
        : [];

      return items
        .filter(isRawIdea)
        .map(toTradingIdea)
        .filter(
          (idea) =>
            idea.exchange === "NSE" || idea.symbolFullName.startsWith("NSE:")
        );
    },
  };

  return getOrFetchSyncedData(options, forceRefresh);
}