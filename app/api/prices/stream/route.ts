import { NextRequest } from "next/server";
import logger from "@/lib/logger";
import { priceEventBus, formatSSEMessage, type LivePriceEvent } from "@/lib/services/priceSyncService";
import { priceCache } from "@/lib/services/priceCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/prices/stream?symbols=RELIANCE,TCS,INFY
 *
 * Server-Sent Events endpoint for live price updates.
 *
 * Query params:
 *   symbols  (string) — Comma-separated list of stock symbols
 *
 * Events:
 *   event: price     → { symbol, price, change, changePercent, ... }
 *   event: heartbeat → { timestamp }
 *   event: error     → { message }
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbolsParam = searchParams.get("symbols") || "";
  const symbols = symbolsParam
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  if (symbols.length === 0) {
    return new Response(JSON.stringify({ error: "At least one symbol is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (symbols.length > 50) {
    return new Response(JSON.stringify({ error: "Maximum 50 symbols per connection" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Send initial cached prices immediately
  const encoder = new TextEncoder();
  const initialPrices: Record<string, unknown> = {};
  for (const symbol of symbols) {
    const cached = priceCache.get(symbol);
    if (cached) {
      initialPrices[symbol] = cached;
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      // Register symbols with the price event bus
      priceEventBus.addSymbols(symbols);
      priceEventBus.addClient();
      priceEventBus.start();

      // Send initial cached data
      if (Object.keys(initialPrices).length > 0) {
        controller.enqueue(
          encoder.encode(`event: initial\ndata: ${JSON.stringify(initialPrices)}\n\n`)
        );
      }

      // Market status
      controller.enqueue(
        encoder.encode(`event: connected\ndata: ${JSON.stringify({
          symbols,
          timestamp: new Date().toISOString(),
          message: `Tracking ${symbols.length} symbols`,
        })}\n\n`)
      );

      // Listen for price updates
      const onPrice = (event: LivePriceEvent) => {
        if (symbols.includes(event.symbol)) {
          try {
            controller.enqueue(encoder.encode(formatSSEMessage("price", event)));
          } catch {
            // Connection closed
          }
        }
      };

      // Listen for heartbeats
      const onHeartbeat = (data: { timestamp: string }) => {
        try {
          controller.enqueue(encoder.encode(formatSSEMessage("heartbeat", data)));
        } catch {
          // Connection closed
        }
      };

      priceEventBus.on("price", onPrice);
      priceEventBus.on("heartbeat", onHeartbeat);

      // Handle disconnect
      req.signal.addEventListener("abort", () => {
        priceEventBus.removeListener("price", onPrice);
        priceEventBus.removeListener("heartbeat", onHeartbeat);
        priceEventBus.removeSymbols(symbols);
        priceEventBus.removeClient();
        logger.debug({ msg: "SSE client disconnected", symbols });
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
