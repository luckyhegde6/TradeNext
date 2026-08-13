/**
 * scripts/chartink-capture/capture.ts
 *
 * Playwright-driven capture of Chartink scanner pages. For every template in
 * the registry (or a filtered subset) it:
 *
 *   1. Visits the scanner page in a real browser (headless by default).
 *   2. CAPTURES (two paths):
 *      a. Network interception (primary) — Chartink's page POSTs
 *         /screener/process on load with the exact scan_clause /
 *         debug_clause / column_clause in the body and the full table +
 *         scanlink in the response. Captured with ZERO clicks.
 *      b. Clipboard fallback — "Copy group to clipboard" (clause/logic) and
 *         "Copy" → "Copy table" (TSV table) via the buttons Chartink renders.
 *      Optionally follows the "Backtest" page link to store backtestUrl.
 *   3. WRITES BACK:
 *      - JSON configs (lib/services/chartink-scans/<category>.json) are
 *        updated with captured clauses (first value wins).
 *      - DB: runFullChartinkSync() — a single full run that CLEANS the
 *        results table and re-inserts the whole captured dataset under one
 *        run id with a 72h TTL (see chartinkScreenerService).
 *
 * Usage (from repo root):
 *   npx tsx scripts/chartink-capture/capture.ts                # all 117
 *   npx tsx scripts/chartink-capture/capture.ts --category fundamental
 *   npx tsx scripts/chartink-capture/capture.ts --id fundamental.profit-jump-by-200
 *   npx tsx scripts/chartink-capture/capture.ts --no-db        # JSON configs only
 *   npx tsx scripts/chartink-capture/capture.ts --dry-run      # report only, no writes
 *   npx tsx scripts/chartink-capture/capture.ts --headful --backtest --rows 50
 *
 * NOTE: chartink.com blocks datacenter/scripted traffic — run this where a
 * normal browser works (local machine). Live-fetch failures per template are
 * collected and reported, not fatal.
 */

import { chromium, type Browser, type Page } from "playwright";
import fs from "fs";
import path from "path";

import logger from "@/lib/logger";
import {
  getChartinkTemplates,
  getChartinkTemplate,
  type ChartinkTemplate,
} from "@/lib/services/chartinkTemplates";
import { getChartinkCategories } from "@/lib/services/chartinkTemplates";
import {
  normalizeCapturedRows,
  upsertChartinkScreener,
  runFullChartinkSync,
} from "@/lib/services/chartinkScreenerService";
import {
  parseArgs,
  listValue,
  parseClipboardTable,
  mergeCapturedClause,
  type CapturedTemplate,
} from "./capture-core";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SCANS_DIR = path.join(
  process.cwd(),
  "lib",
  "services",
  "chartink-scans",
);

const CATEGORY_NAMES = new Map(
  getChartinkCategories().map((c) => [c.id, c.name]),
);

const SCANNER_API = /\/screener\/process$/;
const BACKTEST_API = /\/backtest\/process$/;

interface CaptureOptions {
  category?: string;
  ids: string[];
  noDb: boolean;
  dryRun: boolean;
  headful: boolean;
  backtest: boolean;
  timeoutMs: number;
  ttlHours: number;
}

// ---------------------------------------------------------------------------
// Capture one template page
// ---------------------------------------------------------------------------

/**
 * Visit one scanner page and capture the request body clauses + response
 * rows. Falls back to clipboard clicks when interception found nothing.
 */
async function captureTemplate(
  browser: Browser,
  template: ChartinkTemplate,
  opts: CaptureOptions,
): Promise<CapturedTemplate | null> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  });
  const page = await context.newPage();

  let scanClause: string | undefined;
  let debugClause: string | undefined;
  let columnClause: string | undefined;
  let backtestMaxRows: number | undefined;
  let scanlinkId: string | undefined;
  let rows: Array<Record<string, unknown>> = [];

  try {
    // Trap the /screener/process + /backtest/process traffic.
    page.on("request", (req) => {
      const url = req.url();
      if (SCANNER_API.test(url) && req.method() === "POST") {
        try {
          const body = req.postDataJSON() as Record<string, unknown>;
          if (typeof body["scan_clause"] === "string") scanClause = body["scan_clause"];
          if (typeof body["debug_clause"] === "string") debugClause = body["debug_clause"];
          if (typeof body["column_clause"] === "string") columnClause = body["column_clause"];
          if (body["max_rows"] !== undefined) {
            backtestMaxRows = Number(body["max_rows"]) || undefined;
          }
        } catch {
          /* non-JSON body — ignore */
        }
      }
    });

    page.on("response", async (res) => {
      const url = res.url();
      try {
        if (SCANNER_API.test(url) && res.ok()) {
          const json = (await res.json()) as {
            data?: Array<Record<string, unknown>>;
            link?: string;
          };
          if (Array.isArray(json.data) && json.data.length > 0) rows = json.data;
          if (typeof json.link === "string") scanlinkId = json.link;
        } else if (BACKTEST_API.test(url) && res.ok()) {
          const json = (await res.json()) as { link?: string };
          if (typeof json.link === "string" && !scanlinkId) scanlinkId = json.link;
        }
      } catch {
        /* response body not JSON — ignore */
      }
    });

    await page.goto(template.url, { waitUntil: "domcontentloaded", timeout: opts.timeoutMs });

    // Wait for the results table (Chartink renders rows after the scan POST).
    await page
      .waitForSelector("table.dataTable tbody tr", { timeout: opts.timeoutMs })
      .catch(() => {
        logger.warn({
          msg: "Results table not observed; trying clipboard fallback",
          templateId: template.id,
        });
      });

    // If interception found nothing useful, fall back to Clipboard buttons.
    if (rows.length === 0 || !scanClause) {
      await clipboardFallback(page, {
        wantClause: !scanClause,
        wantRows: rows.length === 0,
      }).then((fb) => {
        if (fb.scanClause && !scanClause) scanClause = fb.scanClause;
        if (fb.debugClause && !debugClause) debugClause = fb.debugClause;
        if (fb.columnClause && !columnClause) columnClause = fb.columnClause;
        if (fb.rows.length > 0) rows = fb.rows;
      });
    }

    // Optional: follow the Backtest button; capture its page URL.
    let backtestUrl: string | undefined;
    if (opts.backtest) {
      const backtestLink = page
        .locator('a[href*="/backtest"]')
        .first();
      if (await backtestLink.count()) {
        backtestUrl = await backtestLink.getAttribute("href").catch(() => null) ?? undefined;
      }
    }

    if (rows.length === 0 && !scanClause) {
      logger.error({
        msg: "Capture failed — no rows and no clause captured",
        templateId: template.id,
        url: template.url,
      });
      return null;
    }

    return {
      template,
      scanClause,
      debugClause,
      columnClause,
      backtestMaxRows,
      rows,
      scanlinkId,
      backtestUrl,
    };
  } catch (error) {
    logger.error({
      msg: "Template capture threw",
      templateId: template.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    await context.close();
  }
}

/**
 * Clipboard fallback per the original manual recipe:
 *  - "Copy group to clipboard" → Ok dialog → clipboard holds clause/logic
 *  - "Copy" (exact) → "Copy table" → Ok dialog → clipboard holds the TSV table
 * The context must already have clipboard-read permission (granted in here).
 */
async function clipboardFallback(
  page: Page,
  request: { wantClause: boolean; wantRows: boolean },
): Promise<{ scanClause?: string; debugClause?: string; columnClause?: string; rows: Array<Record<string, unknown>> }> {
  const out: {
    scanClause?: string;
    debugClause?: string;
    columnClause?: string;
    rows: Array<Record<string, unknown>>;
  } = { rows: [] };

  try {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

    if (request.wantClause) {
      const copyGroup = page.getByRole("button", { name: "Copy group to clipboard" }).first();
      if (await copyGroup.count()) {
        await copyGroup.click();
        await page.getByRole("button", { name: "Ok", exact: true }).click().catch(() => {});
        const text = await readClipboard(page);
        if (text) {
          // The group copy includes the clause body; if it's a JSON-like
          // object, drill into scan_clause; otherwise treat as raw clause.
          try {
            const parsed = JSON.parse(text) as Record<string, unknown>;
            if (typeof parsed["scan_clause"] === "string") {
              out.scanClause = parsed["scan_clause"];
            }
            if (typeof parsed["debug_clause"] === "string") {
              out.debugClause = parsed["debug_clause"];
            }
            if (typeof parsed["column_clause"] === "string") {
              out.columnClause = parsed["column_clause"];
            }
            if (!out.scanClause && typeof parsed["logic"] === "string") {
              out.scanClause = parsed["logic"];
            }
          } catch {
            out.scanClause = text.split("\n")[0].trim() || undefined;
          }
        }
      }
    }

    if (request.wantRows) {
      const copyBtn = page.getByRole("button", { name: "Copy", exact: true }).first();
      if (await copyBtn.count()) {
        await copyBtn.click();
        const copyTable = page.getByRole("button", { name: "Copy table" }).first();
        if (await copyTable.count()) {
          await copyTable.click();
          await page.getByRole("button", { name: "Ok", exact: true }).click().catch(() => {});
          const tsv = await readClipboard(page);
          if (tsv) out.rows = parseClipboardTable(tsv);
        }
      }
    }
  } catch (error) {
    logger.warn({
      msg: "Clipboard fallback failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return out;
}

/** Read clipboard text via the page (requires clipboard-read permission). */
async function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText().catch(() => "")).catch(() => "");
}

// ---------------------------------------------------------------------------
// JSON write-back
// ---------------------------------------------------------------------------

/**
 * Merge captured clauses into <category>.json files. Rewrites each touched
 * category with 2-space indent + trailing newline (matches repo style).
 */
function writeCapturedClauses(captures: CapturedTemplate[]): number {
  const byCategory = new Map<string, ChartinkTemplate[]>();
  for (const c of captures) {
    const merged = mergeCapturedClause(c.template, c);
    if (JSON.stringify(merged) === JSON.stringify(c.template)) continue; // nothing new
    const list = byCategory.get(c.template.categoryId) ?? [];
    const idx = list.findIndex((t) => t.id === merged.id);
    if (idx >= 0) list[idx] = merged;
    else list.push(merged);
    byCategory.set(c.template.categoryId, list);
  }

  let written = 0;
  for (const [categoryId, updates] of byCategory) {
    const file = path.join(SCANS_DIR, `${categoryId}.json`);
    if (!fs.existsSync(file)) {
      logger.warn({ msg: "Category file missing (skipping write)", categoryId, file });
      continue;
    }
    const entries = JSON.parse(fs.readFileSync(file, "utf8")) as ChartinkTemplate[];
    for (const u of updates) {
      const idx = entries.findIndex((e) => e.id === u.id);
      if (idx >= 0) entries[idx] = u;
      else entries.push(u);
    }
    fs.writeFileSync(file, JSON.stringify(entries, null, 2) + "\n", "utf8");
    written++;
    logger.info({ msg: "Category config updated", categoryId, file });
  }
  return written;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const opts: CaptureOptions = {
    category: typeof args["category"] === "string" ? args["category"] : undefined,
    ids: listValue(args["id"] ?? args["ids"]),
    noDb: args["no-db"] === true,
    dryRun: args["dry-run"] === true,
    headful: args["headful"] === true,
    backtest: args["backtest"] === true,
    timeoutMs: Number(args["timeout"] ?? 45_000) || 45_000,
    ttlHours: Number(args["ttl"] ?? 72) || 72,
  };

  const templates = opts.ids.length > 0
    ? opts.ids
        .map((id) => getChartinkTemplate(id))
        .filter((t): t is ChartinkTemplate => !!t)
    : getChartinkTemplates(opts.category);

  if (templates.length === 0) {
    logger.error({ msg: "No templates to capture — check --category / --id filters" });
    process.exit(1);
  }

  logger.info({
    msg: "Chartink capture starting",
    count: templates.length,
    category: opts.category ?? "all",
    dryRun: opts.dryRun,
    noDb: opts.noDb,
    backtest: opts.backtest,
  });

  const browser = await chromium.launch({ headless: !opts.headful });

  const captures: CapturedTemplate[] = [];
  let failed = 0;

  for (const [i, template] of templates.entries()) {
    logger.info({
      msg: `[${i + 1}/${templates.length}] Capturing`,
      id: template.id,
      url: template.url,
    });
    const captured = await captureTemplate(browser, template, opts);
    if (!captured) {
      failed++;
      continue;
    }
    const normalized = normalizeCapturedRows(captured.rows);
    logger.info({
      msg: "Captured",
      id: template.id,
      rows: captured.rows.length,
      normalized: normalized.length,
      scanClause: !!captured.scanClause,
      scanlink: captured.scanlinkId ?? null,
    });
    captures.push(captured);

    // Small politeness delay between pages.
    await new Promise((r) => setTimeout(r, 800));
  }

  await browser.close();

  // ── Summary ─────────────────────────────────────────────────────────────
  const ok = captures.length;
  const totalRows = captures.reduce((acc, c) => acc + c.rows.length, 0);
  const withClause = captures.filter((c) => !!c.scanClause).length;
  const withLink = captures.filter((c) => !!c.scanlinkId).length;

  logger.info({
    msg: "Capture summary",
    ok,
    failed,
    total: templates.length,
    totalRows,
    withClause,
    withLink,
  });

  if (captures.length === 0) {
    logger.error({ msg: "Nothing captured — nothing written" });
    process.exit(1);
  }

  // ── Write-back ──────────────────────────────────────────────────────────
  if (opts.dryRun) {
    logger.info({ msg: "Dry run — skipping JSON + DB writes" });
    return;
  }

  const jsonFiles = writeCapturedClauses(captures);
  logger.info({ msg: "JSON configs updated", files: jsonFiles });

  if (!opts.noDb) {
    // Mirror definitions into the DB first (url/clauses/category meta).
    for (const c of captures) {
      await upsertChartinkScreener(
        c.template,
        CATEGORY_NAMES.get(c.template.categoryId) ?? c.template.categoryId,
      );
    }

    const payload = captures.map((c) => ({
      templateId: c.template.id,
      rows: normalizeCapturedRows(c.rows),
      link: {
        scanlinkId: c.scanlinkId,
        backtestUrl: c.backtestUrl,
      },
    }));

    const result = await runFullChartinkSync(payload, opts.ttlHours);
    logger.info({
      msg: "DB full-run complete",
      runId: result.runId,
      screenersRun: result.screenersRun,
      rowsInserted: result.rowsInserted,
      ttlHours: opts.ttlHours,
    });
  } else {
    logger.info({ msg: "Skipping DB (--no-db)" });
  }
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main().then(
  () => process.exit(0),
  (err) => {
    logger.error({ msg: "Capture aborted", error: err instanceof Error ? err.stack : String(err) });
    process.exit(1);
  },
);