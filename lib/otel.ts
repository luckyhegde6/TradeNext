// lib/otel.ts — Prisma OpenTelemetry tracing (v3.21.3)
//
// Registers Prisma Instrumentation with a NodeTracerProvider so every Prisma
// query engine operation emits a trace span (DB query attribution to the
// monitoring stack). OPT-IN ONLY: nothing is initialized unless
// PRISMA_OTEL_ENABLED=1 (plus, optionally, OTEL_EXPORTER_OTLP_ENDPOINT for
// OTLP/HTTP export; otherwise spans go to the console). This keeps prod and
// test behavior 100% unchanged when the flag is unset.
//
// MUST be called BEFORE the PrismaClient singleton is created (lib/prisma.ts
// calls this at module top), because PrismaInstrumentation wraps the query
// engine at client construction. Idempotent — safe across module graphs and
// hot reloads (guarded on globalThis, matching lib/prisma.ts conventions).

import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  SimpleSpanProcessor,
  ConsoleSpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import * as api from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PrismaInstrumentation, registerInstrumentations } from "@prisma/instrumentation";
import logger from "./logger";

const PACKAGE_VERSION = "3.21.3";

/** Idempotent OpenTelemetry bootstrap for Prisma query tracing. No-op unless
 *  PRISMA_OTEL_ENABLED=1. Returns true when tracing was initialized. */
export function otelSetup(): boolean {
  if (process.env.PRISMA_OTEL_ENABLED !== "1") return false;

  const g = globalThis as {
    __tnPrismaOtelReady?: boolean;
  };
  if (g.__tnPrismaOtelReady) return true;
  g.__tnPrismaOtelReady = true;

  try {
    // Context manager required for PrismaInstrumentation async span context.
    const contextManager = new AsyncHooksContextManager().enable();
    api.context.setGlobalContextManager(contextManager);

    const provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "tradenext",
        [ATTR_SERVICE_VERSION]: process.env.OTEL_SERVICE_VERSION || PACKAGE_VERSION,
      }),
      spanProcessors: [
        new SimpleSpanProcessor(
          process.env.OTEL_EXPORTER_OTLP_ENDPOINT
            ? new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT })
            : new ConsoleSpanExporter()
        ),
      ],
    });

    provider.register();

    registerInstrumentations({
      tracerProvider: provider,
      instrumentations: [new PrismaInstrumentation()],
    });

    if (process.env.NODE_ENV !== "test") {
      logger.info({
        msg: "Prisma OpenTelemetry tracing enabled",
        service: process.env.OTEL_SERVICE_NAME || "tradenext",
        endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "console",
      });
    }
    return true;
  } catch (error) {
    // Never let OTel init crash the app — tracing is best-effort.
    logger.error({
      msg: "Prisma OpenTelemetry init failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}