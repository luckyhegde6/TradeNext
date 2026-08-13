# AI Agent Prompts & Contexts — Analysis & Improvement Plan

> Branch: `analysis/ai-agent-prompts` · Created: 2026-08-13
> Scope: review every AI agent surface (daily recommendations, IPO analysis, screener
> agent, orchestrator Q&A, alert agent, prompt manager), identify why results are weak
> ("AI can't browse the web", HOLD-heavy runs, stale/truncated output), and define what
> is needed for materially better agent output.

---

## 1. Observed failures (user-tested)

| Symptom | Where | Root cause (confirmed below) |
|---|---|---|
| "whats the current stock price of reliance" → model says it cannot browse the web | `/api/ai/query` | Tool-less `directPrompt()` path; `useTools` defaults false AND the orchestrator never attaches tools even when true |
| Daily recs stale / all-HOLD runs historically | Daily pipeline | Free-model 404s (fixed v3.5.4), 2048-token cap truncating 5-stock JSON batches, no fallback model chain in the pipeline |
| Weak/contradictory target & SL (ITC SELL bug) | Daily recs | Direction-blind levels (fixed v3.6.3 evaluator) — but the model still *guesses* levels from ~5 input numbers |
| IPO analysis may hallucinate GMP/news/peers | IPO analysis | Prompt says "use the latest verifiable data" but the model has NO tools and NO internet access |

## 2. AI surface inventory (current state)

### 2.1 Daily recommendation agent — `lib/services/ai/recommendation-agent.ts`
- `analyzeStocks(stocks, config)` — batches of 5, `directPrompt()` (no tools, single turn), 2 retries.
- Input per stock: `symbol, price, change, changePercent, volume, screenerNames, marketCap?`,
  plus optional `context` (corp actions ≤3, announcements ≤2, quarterly results ≤1 — v3.6.1).
- Output contract: JSON array `{recommendation, confidence, targetPrice, stopLoss, timeHorizon, reasoning, riskFactors}`; `parseAIResponse` tolerates fenced/partial JSON; `normalizeRecommendation` + `evaluateRecommendationLevels` (v3.6.3) sanitize.
- **Weaknesses:**
  - *Nearly zero analytical signal.* The model receives price, change, volume, screener names, market cap. No RSI/SMA/52wH-L, no valuation (P/E, P/B, yield), no sector, no index regime, no price trend (5d/20d), no support/resistance. It literally cannot reason like an analyst.
  - *2048 maxTokens ceiling* (env/admin default) for a 5-stock JSON batch → truncation → parse fallback → HOLD defaults. The IPO path raised its own ceiling to 8192; the rec path did not.
  - *No fallback chain.* Circuit breaker open or model failure → all-HOLD fallback. `connectionTestService` probes `openrouter/free`/`openrouter/auto` as fallbacks but the pipeline never uses them.
  - *Free daily models rate-limit fast* (`nvidia/nemotron-3-ultra-550b-a55b:free`). One exhausted quota = one bad run.

### 2.2 IPO analysis — `lib/services/ipoAnalysisService.ts` + `lib/services/ipoReport.ts`
- Best-designed surface in the repo: 14-step template → v2 strict JSON (18-section `IpoReport`), explicit key schema in the prompt, fence/braces extraction, `normalizeReport` never throws, 8192 maxTokens, 12h cache.
- **Weakness:** same `directPrompt()` — the model is instructed "Use the latest verifiable data" and to report GMP/news/peers/subscription, but it has no tools and no access to `getIpoIssueDetail`/NSE events/news. Sections are either "N/A" or hallucinated.

### 2.3 Screener agent — `lib/services/ai/screener-agent.ts` (the ONLY tool-capable agent)
- Uses Agent SDK `callModel()` with real tools: `get_stock_quote`, `get_top_gainers`, `get_top_losers`, `get_market_indices` (fetching internal `/api/nse/*`).
- **Weaknesses:**
  - `SCREENER_SYSTEM_PROMPT` advertises `search_stocks(query)` which does NOT exist in the tool array (mismatch).
  - Tool base URL resolves `INTERNAL_API_BASE_URL || NEXT_PUBLIC_BASE_URL || localhost:3000` — fragile on Netlify; no auth/secret for internal fetch (tools hit public API paths, acceptable but latency adds up).
  - `stopWhen: stepCountIs(5)` caps tool rounds; no token usage surfaced reliably.
  - Default model `openrouter/free` (flaky) when no config passed.

### 2.4 Orchestrator Q&A — `lib/services/ai/orchestrator.ts` + `app/api/ai/query/route.ts`
- **Confirmed bug #1:** `useTools` defaults to **false** in the route (`body.useTools === true`), so casual queries always hit tool-less `directPrompt`.
- **Confirmed bug #2:** even with `useTools: true`, the orchestrator calls `client.callModel({ model, input })` with **NO `tools` array** (line ~202). Tools only exist in `screener-agent.ts`, a separate endpoint. So "tool mode" in the orchestrator is effectively a plain completion.
- This is exactly why "what's the price of Reliance?" got "I can't browse the web".

### 2.5 Alert agent — `lib/services/ai/alert-agent.ts`
- `directPrompt()` with alert JSON. No tools (alerts are pre-fetched — acceptable). Minor: no market-context enrichment (index state, news).

### 2.6 Prompt manager — `lib/services/ai/prompt-manager.ts`
- **Dead code:** versioned prompt tracking with accuracy/auto-adjust exists, but NO agent calls `getActivePrompt()` — `recommendation-agent.ts` and `screener-agent.ts` define their own inline prompts. The manager is never wired, so the "self-adjusting prompt" feature is inert.

### 2.7 Support infra
- `config.ts` — `DEFAULT_MODEL` nemotron-3-ultra-550b:free; admin DB `ai_config` Secret overrides; `hasValidConfig` guard. ✓
- `connectionTestService.ts` (v3.7.1) — probes configured → `openrouter/free` → `openrouter/auto`; raw fetch, never throws; persisted via `trackAiCall` + audit; 30-min cron pre-market. ✓ Good — but its fallback list is not reused by the pipeline.
- `ai-monitoring.ts` — `trackAiCall` persisted to ServerLog (source "ai"). ✓
- `circuit-breaker.ts` — 3-strikes/30s; on open the pipeline falls back to HOLDs.

## 3. Root-cause summary

1. **No live-data tooling in the Q&A path** — user-facing AI cannot answer price questions (orchestrator tool bug + default-off).
2. **Under-specified analysis inputs** — the daily agent gets ~5 numeric fields; targets/SL are guesses, reasoning is thin, HOLD bias.
3. **Token ceiling too low** — 2048 tokens for 5-stock JSON batches truncates → parse failures → HOLD defaults.
4. **No fallback model chain in the pipeline** — a single model failure poisons the whole run; the connection-test fallback logic exists but is unused.
5. **Prompt/context claims data the model cannot obtain** — IPO prompt (GMP/news/peers) and screener prompt (`search_stocks`) promise inputs the model has no way to fetch.
6. **Prompt-manager not wired** — self-adjustment feature is inert.

## 4. What is needed (prioritized)

### P0 — fix the user-facing Q&A path (the "can't browse web" complaint)
1. Attach the NSE tools to the orchestrator's `callModel` path (reuse/extract the tool set from `screener-agent.ts` into a shared `lib/services/ai/tools.ts`).
2. Default `useTools: true` for `analysisType` in `screener|market|portfolio|alert` (keep false for `general`/`dividend` or make it automatic based on query intent).
3. Remove the non-existent `search_stocks` from `SCREENER_SYSTEM_PROMPT` or implement it (symbol fuzzy match against the DB/NSE symbol list).
4. Add a Telegram `/ask <query>` command hitting the tool-enabled agent (bot already has the infra; no AI chat exists today).

### P0 — enrich the daily recommendation prompt with real technicals/valuation
Extend `StockAnalysisInput` with a pre-fetched, server-side technical pack (follow the v3.6.1 context pattern — batched, best-effort, never blocks):
- RSI(14), 20/50/200 SMA trend (price above/below, golden/death cross), 52-week high/low, distance %, ATR or daily range, 5d/20d return %, volume vs 20d average.
- Valuation: P/E, P/B, dividend yield, sector/industry.
- Market regime: NIFTY 50 index change + trend (1d/1w), so the model knows the tape.
Data sources: TradingView `advancedScan` fields already fetched at screener time (`change`, `relative_volume_10d_calc`, `Perf.5D`, etc. — v3.5.2), `getStockQuote`/`getStockChart` (NSE), `daily_prices` (DB, Timescale — perfect for SMA/RSI/52w). Add `fundamentals` source if available (P/E, P/B, yield).

### P0 — raise output ceiling + harden JSON contract (mirror IPO v2)
- Per-batch `maxTokens: 4096–8192` (like `IPO_ANALYSIS_MAX_TOKENS`), never the 2048 default.
- Follow `ipoReport.ts`: embed the exact JSON schema shape in the prompt (already hinted via `RESPONSE_SCHEMA_HINT` — make it a first-class schema block), keep fence-tolerant parsing, keep the level evaluator.

### P1 — fallback model chain inside the pipeline
- In `analyzeStocks`, on configured-model failure, retry the batch on `AI_FALLBACK_MODELS` (`openrouter/free` → `openrouter/auto`) before giving up — exactly the sequence `runAiConnectionTest` uses. Log + `trackAiCall` each fallback attempt so monitoring shows which model actually produced picks.
- Keep circuit breaker as the final gate (it should open on repeated all-model failures, not single-model failures).

### P1 — fix prompt/context honesty
- IPO prompt: either (a) feed real GMP/news/peers data into the prompt when available (we have `getIpoIssueDetail`, NSE events, corporate results) and instruct the model to say "not available" otherwise, or (b) add a `search`/`fetch_news` tool for the IPO agent. Prefer (a) — cheaper and deterministic.
- Alert agent: enrich with index state + latest announcements for the symbol.

### P2 — wire (or retire) the prompt manager
- Either route the rec/screener prompts through `getActivePrompt(agentType)` so versioning/accuracy/auto-rollback actually functions, or delete the module. Recommend wiring the recommendation prompt (cheap win: prompt versions + accuracy tracking become real).

### P2 — model selection
- Consider `nvidia/nemotron-3-super-120b-a12b:free` (strong reasoning, structured outputs) as the default for recs, nemotron-3-ultra for the longer IPO reports, and document the trade-off (daily free quota vs output quality). Keep admin override.

## 5. Suggested implementation order

| Step | Work | Verify |
|---|---|---|
| 1 | Extract shared NSE tools → `lib/services/ai/tools.ts`; wire into orchestrator `callModel`; default `useTools` on for market types; fix screener prompt tool list | Playwright: `/api/ai/query` with `analysisType:"market"` asking for RELIANCE price returns live number |
| 2 | Technical/valuation pack → `StockAnalysisInput` (+ batched fetcher like `recommendation-context.ts`), prompt block, per-batch 8192 maxTokens | Unit tests on new pack builder + prompt; run one daily batch against OpenRouter, assert parsed JSON + non-HOLD mix |
| 3 | Fallback model chain in `analyzeStocks` | Unit tests simulating configured-model 404 → fallback success; monitoring shows fallback models |
| 4 | IPO prompt honesty (feed real data or "N/A" instruction) + alert enrichment | Manual IPO analysis run; assert no fabricated GMP when unknown |
| 5 | Wire prompt-manager into rec agent; add Telegram `/ask` | Unit tests; Playwright bot smoke |

## 6. Files touched (existing, for reference)
- `lib/services/ai/recommendation-agent.ts`, `recommendation-context.ts`, `config.ts`, `llm-provider.ts`, `orchestrator.ts`, `screener-agent.ts`, `prompts.ts`, `prompt-manager.ts`, `alert-agent.ts`, `connectionTestService.ts`
- `lib/services/ipoAnalysisService.ts`, `lib/services/ipoReport.ts`, `lib/services/dailyRecommendationService.ts`
- `app/api/ai/query/route.ts`, `app/api/ai/screener/route.ts`, `lib/services/telegramBotService.ts`

> This document is analysis-only. No production code changed on this branch yet — implementation starts after user approval of the plan.
