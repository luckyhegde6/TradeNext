// app/api/mcp/route.ts
// MCP (Machine Communication Protocol) API for external NSE data queries
// Provides unified interface for all NSE real-time data

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { nseFetch } from "@/lib/nse-client";
import cache from "@/lib/cache";

// ============================================================================
// Type Definitions
// ============================================================================

type McpFunction = 
  | "getIndexData"        // All market indices
  | "getMarketIndices"    // Specific index data (NIFTY, BANK, etc.)
  | "getStockQuote"       // Real-time stock quote
  | "getStockChart"       // Historical chart data
  | "getGainers"          // Top gainers for index
  | "getLosers"           // Top losers for index
  | "getMostActive"       // Most active stocks
  | "getAdvanceDecline"   // Market breadth
  | "getCorporateActions" // Corporate actions for index
  | "getCorporateInfo"    // Company info & fundamentals
  | "getMarquee"          // Scrolling market data
  | "getDeals"            // Block/Bulk deals
  | "getAnnouncements"    // Corporate announcements
  | "getInsiderTrading"   // Insider trading data
  | "getEvents"           // Corporate events calendar
  | "getHeatmap"          // Sector heatmap
  | "getSymbols"          // Index constituent symbols
  | "getTrends"           // Stock trends/indicators
  | "getCorpActions"      // Corporate actions by index
  | "getAnnouncementsByIndex" // Announcements by index
  | "getStockCorporate"   // Stock-specific corporate data
  | "listFunctions"       // List available functions (for discovery)
  | "describe"            // Get function description
  | "help"                // Get help with MCP usage
  | "schema";             // Get JSON schema for a function

interface McpRequest {
  function: McpFunction;
  parameters?: Record<string, unknown>;
}

// ============================================================================
// Cache Configuration
// ============================================================================

const HTTP_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=120';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate cache key based on function and parameters
 */
function generateCacheKey(functionName: string, params?: Record<string, unknown>): string {
  if (!params || Object.keys(params).length === 0) {
    return `mcp:${functionName}`;
  }
  const paramStr = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return `mcp:${functionName}?${paramStr}`;
}

/**
 * Validate API key (if configured)
 */
function validateApiKey(request: NextRequest): boolean {
  const apiKey = request.headers.get('x-api-key');
  const validKey = process.env.MCP_API_KEY;
  
  // If no MCP_API_KEY configured, allow all requests (dev mode)
  if (!validKey) {
    return true;
  }
  
  return apiKey === validKey;
}

/**
 * List available MCP functions with descriptions
 */
function getFunctionList() {
  return [
    { name: "listFunctions", description: "List all available MCP functions" },
    { name: "describe", description: "Get detailed description of a function (use param: functionName)" },
    { name: "schema", description: "Get JSON schema for a function (use param: functionName)" },
    { name: "help", description: "Get usage help and examples" },
    { name: "getIndexData", description: "Get all market indices (NIFTY, BANK, IT, etc.)" },
    { name: "getMarketIndices", description: "Get specific index data (param: indexName)" },
    { name: "getStockQuote", description: "Get real-time stock quote (param: symbol)" },
    { name: "getStockChart", description: "Get historical chart data (param: symbol)" },
    { name: "getGainers", description: "Get top gainers for index (param: indexName)" },
    { name: "getLosers", description: "Get top losers for index (param: indexName)" },
    { name: "getMostActive", description: "Get most active stocks (param: indexName)" },
    { name: "getAdvanceDecline", description: "Get market breadth (param: indexName)" },
    { name: "getCorporateActions", description: "Get corporate actions for index (param: indexName)" },
    { name: "getCorporateInfo", description: "Get company info (param: symbol)" },
    { name: "getMarquee", description: "Get scrolling market data" },
    { name: "getDeals", description: "Get block/bulk deals (param: mode)" },
    { name: "getAnnouncements", description: "Get corporate announcements (params: symbol, indexName)" },
    { name: "getInsiderTrading", description: "Get insider trading data" },
    { name: "getEvents", description: "Get corporate events calendar" },
    { name: "getHeatmap", description: "Get sector heatmap (param: indexName)" },
    { name: "getSymbols", description: "Get index constituent symbols (param: indexName)" },
    { name: "getTrends", description: "Get stock trends/indicators (param: symbol)" },
    { name: "getCorpActions", description: "Get corporate actions (param: indexName)" },
    { name: "getAnnouncementsByIndex", description: "Get announcements by index (param: indexName)" },
    { name: "getStockCorporate", description: "Get stock corporate data (param: symbol)" },
  ];
}

/**
 * Get detailed description for a function
 */
function getFunctionDescription(functionName: string): string | null {
  const descriptions: Record<string, string> = {
    getIndexData: "Returns data for all market indices including NIFTY 50, NIFTY BANK, NIFTY IT, NIFTY MIDCAP, NIFTY SMALLCAP, etc. No parameters required.",
    getMarketIndices: "Returns detailed data for a specific index. Parameters: indexName (e.g., 'NIFTY 50', 'NIFTY BANK', 'NIFTY IT').",
    getStockQuote: "Returns real-time quote for a stock. Parameters: symbol (e.g., 'RELIANCE', 'TCS', 'INFY').",
    getStockChart: "Returns historical chart data for a stock. Parameters: symbol (e.g., 'RELIANCE'), optional: period, interval.",
    getGainers: "Returns top gainers for an index. Parameters: indexName (e.g., 'NIFTY 50').",
    getLosers: "Returns top losers for an index. Parameters: indexName (e.g., 'NIFTY 50').",
    getMostActive: "Returns most active stocks by volume. Parameters: indexName (e.g., 'NIFTY 50').",
    getAdvanceDecline: "Returns market breadth (advances/declines). Parameters: indexName (e.g., 'NIFTY 50').",
    getCorporateActions: "Returns corporate actions (dividends, splits, bonuses) for an index. Parameters: indexName (e.g., 'NIFTY 50').",
    getCorporateInfo: "Returns company information and fundamentals. Parameters: symbol (e.g., 'RELIANCE').",
    getMarquee: "Returns scrolling market data (top gainers/losers). No parameters required.",
    getDeals: "Returns block/bulk deals. Parameters: mode ('block_deals', 'bulk_deals').",
    getAnnouncements: "Returns corporate announcements. Parameters: optional symbol, indexName.",
    getInsiderTrading: "Returns insider trading data. No parameters required.",
    getEvents: "Returns corporate events calendar. No parameters required.",
    getHeatmap: "Returns sector heatmap data. Parameters: indexName (e.g., 'NIFTY 50').",
    getSymbols: "Returns constituent symbols for an index. Parameters: indexName (e.g., 'NIFTY 50').",
    getTrends: "Returns stock trends and technical indicators. Parameters: symbol (e.g., 'RELIANCE').",
    getCorpActions: "Returns corporate actions for an index. Parameters: indexName.",
    getAnnouncementsByIndex: "Returns corporate announcements for an index. Parameters: indexName.",
    getStockCorporate: "Returns corporate data specific to a stock. Parameters: symbol.",
  };
  return descriptions[functionName] || null;
}

/**
 * Get JSON schema for a function
 */
function getFunctionSchema(functionName: string): object | null {
  const schemas: Record<string, object> = {
    getIndexData: {
      type: "object",
      properties: {},
      required: [],
    },
    getMarketIndices: {
      type: "object",
      properties: {
        indexName: { type: "string", description: "Index name (e.g., 'NIFTY 50', 'NIFTY BANK')" },
      },
      required: ["indexName"],
    },
    getStockQuote: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Stock symbol (e.g., 'RELIANCE', 'TCS')" },
      },
      required: ["symbol"],
    },
    getStockChart: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Stock symbol" },
        period: { type: "string", enum: ["1D", "1W", "1M", "3M", "6M", "1Y", "5Y"], description: "Time period" },
        interval: { type: "string", enum: ["1min", "5min", "15min", "30min", "1hour", "1day"], description: "Data interval" },
      },
      required: ["symbol"],
    },
    getGainers: {
      type: "object",
      properties: {
        indexName: { type: "string", description: "Index name (e.g., 'NIFTY 50')" },
      },
      required: ["indexName"],
    },
    getCorporateActions: {
      type: "object",
      properties: {
        indexName: { type: "string", description: "Index name" },
      },
      required: ["indexName"],
    },
    getDeals: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["block_deals", "bulk_deals"], description: "Deals type" },
      },
      required: ["mode"],
    },
  };
  return schemas[functionName] || null;
}

// ============================================================================
// MCP Handlers
// ============================================================================

/**
 * Handler: getIndexData - All market indices
 */
async function handleGetIndexData(): Promise<unknown> {
  const cacheKey = generateCacheKey("getIndexData");
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const data = await nseFetch("/api/NextApi/apiClient", "?functionName=getIndexData&&type=All/");
  cache.set(cacheKey, data, 120); // 2 min cache
  return data;
}

/**
 * Handler: getMarketIndices - Specific index data
 */
async function handleGetMarketIndices(params: Record<string, unknown>): Promise<unknown> {
  const indexName = params.indexName as string;
  if (!indexName) {
    throw new Error("Missing required parameter: indexName");
  }
  
  const cacheKey = generateCacheKey("getMarketIndices", { indexName });
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // Map friendly names to API values
  const indexMap: Record<string, string> = {
    "NIFTY 50": "NIFTY 50",
    "NIFTY BANK": "NIFTY BANK",
    "NIFTY IT": "NIFTY IT",
    "NIFTY MIDCAP 50": "NIFTY MIDCAP 50",
    "NIFTY SMALLCAP 100": "NIFTY SMALLCAP 100",
    "NIFTY AUTO": "NIFTY AUTO",
    "NIFTY PHARMA": "NIFTY PHARMA",
    "NIFTY METAL": "NIFTY METAL",
    "NIFTY FMCG": "NIFTY FMCG",
    "NIFTY ENERGY": "NIFTY ENERGY",
  };
  
  const apiIndex = indexMap[indexName] || indexName;
  const data = await nseFetch(`/api/NextApi/apiClient`, `?functionName=getQuoteHistory&index=${encodeURIComponent(apiIndex)}`);
  cache.set(cacheKey, data, 120);
  return data;
}

/**
 * Handler: getStockQuote - Real-time stock quote
 */
async function handleGetStockQuote(params: Record<string, unknown>): Promise<unknown> {
  const symbol = params.symbol as string;
  if (!symbol) {
    throw new Error("Missing required parameter: symbol");
  }
  
  const cacheKey = generateCacheKey("getStockQuote", { symbol });
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const data = await nseFetch("/api/NextApi/apiClient", `?symbol=${symbol}&functionName=getQuoteInfo`);
  cache.set(cacheKey, data, 60); // 1 min cache
  return data;
}

/**
 * Handler: getStockChart - Historical chart data
 */
async function handleGetStockChart(params: Record<string, unknown>): Promise<unknown> {
  const symbol = params.symbol as string;
  if (!symbol) {
    throw new Error("Missing required parameter: symbol");
  }
  
  const cacheKey = generateCacheKey("getStockChart", params as Record<string, string>);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const period = (params.period as string) || "1Y";
  const data = await nseFetch("/api/NextApi/apiClient", `?symbol=${symbol}&functionName=getQuoteHistory&period=${period}`);
  cache.set(cacheKey, data, 300); // 5 min cache
  return data;
}

/**
 * Handler: getGainers - Top gainers
 */
async function handleGetGainers(params: Record<string, unknown>): Promise<unknown> {
  const indexName = (params.indexName as string) || "NIFTY 50";
  
  const cacheKey = generateCacheKey("getGainers", { indexName });
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const data = await nseFetch("/api/NextApi/apiClient", `?index=${encodeURIComponent(indexName)}&functionName=getTopGainers`);
  cache.set(cacheKey, data, 120);
  return data;
}

/**
 * Handler: getLosers - Top losers
 */
async function handleGetLosers(params: Record<string, unknown>): Promise<unknown> {
  const indexName = (params.indexName as string) || "NIFTY 50";
  
  const cacheKey = generateCacheKey("getLosers", { indexName });
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const data = await nseFetch("/api/NextApi/apiClient", `?index=${encodeURIComponent(indexName)}&functionName=getTopLosers`);
  cache.set(cacheKey, data, 120);
  return data;
}

/**
 * Handler: getMostActive - Most active stocks
 */
async function handleGetMostActive(params: Record<string, unknown>): Promise<unknown> {
  const indexName = (params.indexName as string) || "NIFTY 50";
  
  const cacheKey = generateCacheKey("getMostActive", { indexName });
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const data = await nseFetch("/api/NextApi/apiClient", `?index=${encodeURIComponent(indexName)}&functionName=getMostActive`);
  cache.set(cacheKey, data, 120);
  return data;
}

/**
 * Handler: getAdvanceDecline - Market breadth
 */
async function handleGetAdvanceDecline(params: Record<string, unknown>): Promise<unknown> {
  const indexName = (params.indexName as string) || "NIFTY 50";
  
  const cacheKey = generateCacheKey("getAdvanceDecline", { indexName });
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const data = await nseFetch("/api/NextApi/apiClient", `?index=${encodeURIComponent(indexName)}&functionName=getAdvanceDecline`);
  cache.set(cacheKey, data, 120);
  return data;
}

/**
 * Handler: getCorporateActions - Corporate actions
 */
async function handleGetCorporateActions(params: Record<string, unknown>): Promise<unknown> {
  const indexName = (params.indexName as string) || "NIFTY 50";
  
  const cacheKey = generateCacheKey("getCorporateActions", { indexName });
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const data = await nseFetch("/api/corporates-corporateActions", `?index=equities`);
  cache.set(cacheKey, data, 300); // 5 min cache
  return data;
}

/**
 * Handler: getCorporateInfo - Company info
 */
async function handleGetCorporateInfo(params: Record<string, unknown>): Promise<unknown> {
  const symbol = params.symbol as string;
  if (!symbol) {
    throw new Error("Missing required parameter: symbol");
  }
  
  const cacheKey = generateCacheKey("getCorporateInfo", { symbol });
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const data = await nseFetch("/api/NextApi/apiClient", `?symbol=${symbol}&functionName=corporateinfo`);
  cache.set(cacheKey, data, 3600); // 1 hour cache
  return data;
}

/**
 * Handler: getMarquee - Scrolling market data
 */
async function handleGetMarquee(): Promise<unknown> {
  const cacheKey = generateCacheKey("getMarquee");
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const data = await nseFetch("/api/NextApi/marketData", "?flag=OK");
  cache.set(cacheKey, data, 60);
  return data;
}

/**
 * Handler: getDeals - Block/Bulk deals
 */
async function handleGetDeals(params: Record<string, unknown>): Promise<unknown> {
  const mode = (params.mode as string) || "bulk_deals";
  
  const cacheKey = generateCacheKey("getDeals", { mode });
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const data = await nseFetch("/api/NextApi/", `?mode=${mode}&entity=corp`);
  cache.set(cacheKey, data, 120);
  return data;
}

/**
 * Handler: getAnnouncements - Corporate announcements
 */
async function handleGetAnnouncements(params: Record<string, unknown>): Promise<unknown> {
  const symbol = params.symbol as string;
  const indexName = params.indexName as string;
  
  const cacheParams: Record<string, string> = {};
  if (symbol) cacheParams.symbol = symbol;
  if (indexName) cacheParams.indexName = indexName;
  
  const cacheKey = generateCacheKey("getAnnouncements", Object.keys(cacheParams).length > 0 ? cacheParams : undefined);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  let query = "?index=equities";
  if (symbol) query += `&symbol=${symbol}`;
  const data = await nseFetch("/api/corporate-announcements", query);
  cache.set(cacheKey, data, 120);
  return data;
}

/**
 * Handler: getInsiderTrading - Insider trading data
 */
async function handleGetInsiderTrading(): Promise<unknown> {
  const cacheKey = generateCacheKey("getInsiderTrading");
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const data = await nseFetch("/api/cmsNote", "?url=corporate-filings-insider-trading");
  cache.set(cacheKey, data, 300);
  return data;
}

/**
 * Handler: getEvents - Corporate events calendar
 */
async function handleGetEvents(): Promise<unknown> {
  const cacheKey = generateCacheKey("getEvents");
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const data = await nseFetch("/api/event-calendar", "?index=equities");
  cache.set(cacheKey, data, 300);
  return data;
}

/**
 * Handler: getHeatmap - Sector heatmap
 */
async function handleGetHeatmap(params: Record<string, unknown>): Promise<unknown> {
  const indexName = (params.indexName as string) || "NIFTY 50";
  
  const cacheKey = generateCacheKey("getHeatmap", { indexName });
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const data = await nseFetch("/api/NextApi/apiClient", `?index=${encodeURIComponent(indexName)}&functionName=getHeatMap`);
  cache.set(cacheKey, data, 120);
  return data;
}

/**
 * Handler: getSymbols - Index constituents
 */
async function handleGetSymbols(params: Record<string, unknown>): Promise<unknown> {
  const indexName = (params.indexName as string) || "NIFTY 50";
  
  const cacheKey = generateCacheKey("getSymbols", { indexName });
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const data = await nseFetch("/api/NextApi/apiClient", `?index=${encodeURIComponent(indexName)}&functionName=getSecurities`);
  cache.set(cacheKey, data, 3600); // 1 hour cache
  return data;
}

/**
 * Handler: getTrends - Stock trends/indicators
 */
async function handleGetTrends(params: Record<string, unknown>): Promise<unknown> {
  const symbol = params.symbol as string;
  if (!symbol) {
    throw new Error("Missing required parameter: symbol");
  }
  
  const cacheKey = generateCacheKey("getTrends", { symbol });
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const data = await nseFetch("/api/NextApi/apiClient", `?symbol=${symbol}&functionName=stockIndicators`);
  cache.set(cacheKey, data, 300);
  return data;
}

/**
 * Handler: getCorpActions - Corporate actions (alias)
 */
async function handleGetCorpActions(params: Record<string, unknown>): Promise<unknown> {
  return handleGetCorporateActions(params);
}

/**
 * Handler: getAnnouncementsByIndex - Announcements by index
 */
async function handleGetAnnouncementsByIndex(params: Record<string, unknown>): Promise<unknown> {
  const indexName = params.indexName as string;
  if (!indexName) {
    throw new Error("Missing required parameter: indexName");
  }
  
  const cacheKey = generateCacheKey("getAnnouncementsByIndex", { indexName });
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const data = await nseFetch("/api/corporate-announcements", `?index=equities&indexName=${encodeURIComponent(indexName)}`);
  cache.set(cacheKey, data, 120);
  return data;
}

/**
 * Handler: getStockCorporate - Stock corporate data
 */
async function handleGetStockCorporate(params: Record<string, unknown>): Promise<unknown> {
  const symbol = params.symbol as string;
  if (!symbol) {
    throw new Error("Missing required parameter: symbol");
  }
  
  const cacheKey = generateCacheKey("getStockCorporate", { symbol });
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const data = await nseFetch(`/api/corporates-corpInfo`, `?symbol=${symbol}`);
  cache.set(cacheKey, data, 3600);
  return data;
}

/**
 * Handler: help - Get usage help
 */
function handleHelp(): object {
  return {
    message: "TradeNext MCP API - Machine Communication Protocol for NSE Data",
    version: "1.0.0",
    endpoints: {
      POST: "Execute MCP function with JSON body",
      GET: "Access via query parameters (function, symbol, indexName, etc.)",
    },
    usage: {
      example: {
        curl: `curl -X POST http://localhost:3000/api/mcp \\
  -H "Content-Type: application/json" \\
  -d '{"function": "getStockQuote", "parameters": {"symbol": "RELIANCE"}}'`,
      },
      parameters: {
        function: "MCP function name (required)",
        parameters: "Object with function-specific parameters (optional)",
      },
    },
    functions: getFunctionList(),
  };
}

// ============================================================================
// Main Request Handler
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // Validate API key
    if (!validateApiKey(request)) {
      return NextResponse.json(
        { error: "Unauthorized", message: "Invalid or missing API key" },
        { status: 401 }
      );
    }

    // Parse request body
    let body: McpRequest;
    const contentType = request.headers.get("content-type") || "";
    
    if (contentType.includes("application/json")) {
      body = await request.json();
    } else {
      // Try to parse as form data
      const formData = await request.formData();
      const data: Record<string, unknown> = {};
      formData.forEach((value, key) => {
        if (key === "parameters" && typeof value === "string") {
          try {
            data[key] = JSON.parse(value);
          } catch {
            data[key] = value;
          }
        } else if (key === "parameters") {
          // Already an object from formData
        } else {
          data[key] = value;
        }
      });
      body = {
        function: (data.function as McpFunction) || "listFunctions",
        parameters: data.parameters as Record<string, unknown> | undefined,
      };
    }

    const { function: mcpFunction, parameters = {} } = body;

    if (!mcpFunction) {
      return NextResponse.json(
        { error: "Bad Request", message: "Missing 'function' parameter" },
        { status: 400 }
      );
    }

    // Route to appropriate handler
    let result: unknown;

    switch (mcpFunction) {
      case "listFunctions":
        result = getFunctionList();
        break;
      case "describe":
        result = {
          function: parameters.functionName,
          description: getFunctionDescription(parameters.functionName as string),
        };
        break;
      case "schema":
        result = {
          function: parameters.functionName,
          schema: getFunctionSchema(parameters.functionName as string),
        };
        break;
      case "help":
        result = handleHelp();
        break;
      case "getIndexData":
        result = await handleGetIndexData();
        break;
      case "getMarketIndices":
        result = await handleGetMarketIndices(parameters);
        break;
      case "getStockQuote":
        result = await handleGetStockQuote(parameters);
        break;
      case "getStockChart":
        result = await handleGetStockChart(parameters);
        break;
      case "getGainers":
        result = await handleGetGainers(parameters);
        break;
      case "getLosers":
        result = await handleGetLosers(parameters);
        break;
      case "getMostActive":
        result = await handleGetMostActive(parameters);
        break;
      case "getAdvanceDecline":
        result = await handleGetAdvanceDecline(parameters);
        break;
      case "getCorporateActions":
      case "getCorpActions":
        result = await handleGetCorporateActions(parameters);
        break;
      case "getCorporateInfo":
        result = await handleGetCorporateInfo(parameters);
        break;
      case "getMarquee":
        result = await handleGetMarquee();
        break;
      case "getDeals":
        result = await handleGetDeals(parameters);
        break;
      case "getAnnouncements":
        result = await handleGetAnnouncements(parameters);
        break;
      case "getInsiderTrading":
        result = await handleGetInsiderTrading();
        break;
      case "getEvents":
        result = await handleGetEvents();
        break;
      case "getHeatmap":
        result = await handleGetHeatmap(parameters);
        break;
      case "getSymbols":
        result = await handleGetSymbols(parameters);
        break;
      case "getTrends":
        result = await handleGetTrends(parameters);
        break;
      case "getAnnouncementsByIndex":
        result = await handleGetAnnouncementsByIndex(parameters);
        break;
      case "getStockCorporate":
        result = await handleGetStockCorporate(parameters);
        break;
      default:
        return NextResponse.json(
          { 
            error: "Bad Request", 
            message: `Unknown function: ${mcpFunction}`,
            availableFunctions: getFunctionList().map(f => f.name),
          },
          { status: 400 }
        );
    }

    return NextResponse.json(
      { 
        success: true, 
        function: mcpFunction,
        data: result,
        timestamp: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': HTTP_CACHE_CONTROL } }
    );
  } catch (e: unknown) {
    const error = e as Error;
    console.error("[MCP Error]", error.message);
    return NextResponse.json(
      { 
        error: "Internal Server Error", 
        message: error.message,
        function: "unknown",
      },
      { status: 500 }
    );
  }
}

// ============================================================================
// GET Handler (for simple queries)
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    // Validate API key
    if (!validateApiKey(request)) {
      return NextResponse.json(
        { error: "Unauthorized", message: "Invalid or missing API key" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const mcpFunction = searchParams.get("function") as McpFunction;
    
    // If no function, return help/info
    if (!mcpFunction) {
      return NextResponse.json({
        message: "TradeNext MCP API",
        version: "1.0.0",
        usage: "POST with { function: 'functionName', parameters: {...} } or GET ?function=name&symbol=...",
        functions: getFunctionList(),
      });
    }

    // Build parameters from query string
    const parameters: Record<string, unknown> = {};
    for (const [key, value] of searchParams.entries()) {
      if (key !== "function") {
        parameters[key] = value;
      }
    }

    // Create request body for handler
    const body: McpRequest = {
      function: mcpFunction,
      parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
    };

    // Reuse POST logic by calling it as a sub-request
    // But since we can't call ourselves, handle directly
    let result: unknown;

    switch (mcpFunction) {
      case "listFunctions":
        result = getFunctionList();
        break;
      case "help":
        result = handleHelp();
        break;
      case "getIndexData":
        result = await handleGetIndexData();
        break;
      case "getStockQuote":
        result = await handleGetStockQuote(parameters);
        break;
      case "getMarquee":
        result = await handleGetMarquee();
        break;
      default:
        // For other functions, suggest using POST
        return NextResponse.json({
          message: `Use POST for function: ${mcpFunction}`,
          example: `curl -X POST -H "Content-Type: application/json" -d '{"function":"${mcpFunction}"}' /api/mcp`,
        });
    }

    return NextResponse.json(
      { 
        success: true, 
        function: mcpFunction,
        data: result,
        timestamp: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': HTTP_CACHE_CONTROL } }
    );
  } catch (e: unknown) {
    const error = e as Error;
    return NextResponse.json(
      { error: "Error", message: error.message },
      { status: 500 }
    );
  }
}