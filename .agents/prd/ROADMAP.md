# TradeNext Evolution Roadmap: Screener, Alerts, Algo Trading & AI Agents

> **Status:** Draft PRD  
> **Date:** July 16, 2026  
> **Target Versions:** v2.0.0 through v3.0.0  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Phase 0: Current State Analysis](#2-phase-0-current-state-analysis)
3. [Phase 1: Chartink-like Advanced Screener (v2.0.0)](#3-phase-1-chartink-like-advanced-screener-v200)
4. [Phase 2: Enterprise Alert Engine (v2.1.0)](#4-phase-2-enterprise-alert-engine-v210)
5. [Phase 3: Algo Trading & Pine Script Platform (v2.2.0)](#5-phase-3-algo-trading--pine-script-platform-v220)
6. [Phase 4: AI Agent System with LangChain/LangGraph (v3.0.0)](#6-phase-4-ai-agent-system-with-langchainlanggraph-v300)
7. [Phase 5: Infrastructure & Security](#7-phase-5-infrastructure--security)
8. [Data Model Changes](#8-data-model-changes)
9. [UI/UX Architecture](#9-uiux-architecture)
10. [Testing Strategy](#10-testing-strategy)
11. [Migration Path](#11-migration-path)
12. [Success Metrics](#12-success-metrics)

---

## 1. Executive Summary

TradeNext currently has a functional stock screener (TradingView-backed), alert system (12 types), and basic market analytics. This roadmap proposes evolving it into a **comprehensive trading platform** with:

| Capability | Current | Target |
|---|---|---|
| Screener | Single-condition filters, preset-based | Multi-condition builder with AND/OR groups, technical indicators, candlestick patterns, backtesting |
| Alerts | DB-only, no delivery channels | Multi-condition, webhook/email/Telegram delivery, escalation rules, alert analytics |
| Algo Trading | None | Pine Script viewer/backtester, TradingView webhook integration, paper trading engine |
| AI Agents | None (only basic AIInsight model) | LangChain/LangGraph agents for market analysis, document processing, pattern recognition |
| Document Processing | CSV import only | PDF/OCR/Office doc processing via MarkItDown |
| File Operations | CSV/CSV-parse | Full file upload, multi-format conversion, pipeline processing |

**Key architectural principles:**
- **Incremental delivery** — each phase builds on the previous, tested locally before production
- **Self-hosted first** — AI agent keys added only after local orchestration verified
- **API-first** — all features accessible via MCP API for external tools
- **Netlify-compatible** — serverless-friendly where possible, worker-based for async tasks

---

## 2. Phase 0: Current State Analysis

### 2.1 Screener (`/markets/screener`)

**What exists:**
- Single POST endpoint `POST /api/screener` with flat filter object
- Data source: TradingView scanner API (primary) → DB cache (DailyScreenerSync) (secondary)
- Filters: 4 Quick Presets, 10 Basic fields, 6 Advanced fields
- Columns requested from TradingView: `name, close, change, volume, market_cap_basic, price_earnings_ttm, dividend_yield_recent, sector, industry, price_book_ratio, relative_volume_10d_calc, return_on_equity_fq, debt_to_equity_fq`
- Saved screens: `SavedScreen` model (userId, name, filters JSON)
- Prisma models: `ScreenerConfig`, `ScreenerResult`, `SavedScreen`, `DailyScreenerSync` exist but underutilized

**Gaps:**
- ❌ No multi-condition logic (AND/OR groups)
- ❌ No technical indicator scans (RSI, MACD, SMA crossover)
- ❌ No candlestick pattern recognition
- ❌ No backtesting
- ❌ No export (CSV/PDF)
- ❌ No scheduled scan execution
- ❌ No scan-to-alert workflow

### 2.2 Alert System (`/alerts`)

**What exists:**
- 12 alert types (6 price-based + 6 corporate action)
- `Alert` model (system alerts) + `UserAlert` model (user price alerts)
- Alert checking: Page-load trigger (`POST /api/alerts/check`) + background worker
- Notification records in DB via `Notification` model
- Corporate action alert scanning in `alertService.ts`

**Gaps:**
- ❌ No multi-condition alerts (e.g., "price > 2000 AND RSI > 70")
- ❌ No delivery channels (email, webhook, push)
- ❌ No escalation rules
- ❌ No quiet hours / scheduling
- ❌ No alert analytics dashboard
- ❌ No one-click action from alert (buy/sell)

### 2.3 Architecture

**What exists:**
- Clean Next.js App Router pattern with services layer
- Server-side proxies for all external APIs
- Worker system: custom polling-based (17 task types)
- Logging: File → Netlify Blob → DB fallback
- MCP API endpoint (`/api/mcp`) with 22 functions
- Prisma with 35+ models on PostgreSQL
- NextAuth with role-based access (admin/user)

**What's available but unused:**
- `ScreenerConfig` model — designed for multi-condition configs
- `ScreenerResult` model — designed for individual stock results per config
- `AIInsight` model — basic AI insights
- `BullMQ` installed but not used

---

## 3. Phase 1: Chartink-like Advanced Screener (v2.0.0)

### 3.1 Multi-Condition Filter Builder

**Problem:** Current filter is a flat object with `AND` logic only. Users cannot express complex queries like:
```
( (Price > 1000 AND P/E < 30) OR (Market Cap > 50000 AND Dividend > 2%) )
AND RSI > 70
AND Volume > 1,000,000
```

**Solution:** Build a condition tree UI and API that supports nested AND/OR groups.

#### Filter Grammar

```typescript
interface FilterGroup {
  id: string;
  logic: "AND" | "OR";
  conditions: FilterCondition[];
  groups: FilterGroup[]; // Nested sub-groups
}

interface FilterCondition {
  id: string;
  field: FilterField;
  operator: "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "between" | 
            "in" | "not_in" | "crosses_above" | "crosses_below" | 
            "is_true" | "is_false";
  value: number | string | string[] | { min: number; max: number };
}
```

#### Filter Fields (Expanded)

| Category | Field | TradingView Column | Type |
|----------|-------|--------------------|------|
| **Price** | Price | `close` | number |
| | % Change | `change_percent` | number |
| | Open | `open` | number |
| | High | `high` | number |
| | Low | `low` | number |
| | 52W High | `price_52_week_high` | number |
| | 52W Low | `price_52_week_low` | number |
| **Volume** | Volume | `volume` | number |
| | Relative Vol (10d) | `relative_volume_10d_calc` | number |
| | Avg Volume (50d) | `average_volume_50` | number |
| **Fundamentals** | Market Cap | `market_cap_basic` | number |
| | P/E (TTM) | `price_earnings_ttm` | number |
| | P/B | `price_book_ratio` | number |
| | Dividend Yield | `dividend_yield_recent` | number |
| | ROE | `return_on_equity_fq` | number |
| | Debt/Equity | `debt_to_equity_fq` | number |
| | EPS (TTM) | `eps_ttm` | number |
| | Revenue | `total_revenue` | number |
| | Sector | `sector` | string |
| | Industry | `industry` | string |
| **Technical** | RSI (14) | `RSI` | number |
| | MACD | `MACD.macd` | number |
| | MACD Signal | `MACD.signal` | number |
| | MACD Histogram | `MACD.histogram` | number |
| | SMA (20) | `SMA20` | number |
| | SMA (50) | `SMA50` | number |
| | SMA (200) | `SMA200` | number |
| | EMA (20) | `EMA20` | number |
| | Bollinger Upper | `BB.upper` | number |
| | Bollinger Middle | `BB.middle` | number |
| | Bollinger Lower | `BB.lower` | number |
| | %B | `BB.percent_b` | number |
| | Volume SMA (20) | `VolSMA20` | number |
| **Pattern** | Candlestick Pattern | `pattern` | string |
| | Technical Rating | `technical_rating` | string |
| | Analyst Rating | `analyst_rating` | string |
| **Performance** | 1W Performance | `Perf.W` | number |
| | 1M Performance | `Perf.M` | number |
| | 3M Performance | `Perf.3M` | number |
| | 6M Performance | `Perf.6M` | number |
| | YTD Performance | `Perf.YTD` | number |
| | 1Y Performance | `Perf.12M` | number |

#### Special Conditions (Crossover / Pattern)

| Condition | Meaning | Example |
|-----------|---------|---------|
| `crosses_above` | Line A crosses above Line B | `SMA50 crosses_above SMA200` |
| `crosses_below` | Line A crosses below Line B | `RSI crosses_below 30` |
| `is_true` | Pattern detected | `Candlestick Pattern is_true "Bullish Engulfing"` |
| `between` | Value in range | `Price between 1000 and 5000` |

### 3.2 Technical Indicator Scanning

**Architecture Decision:** Two-tier approach:

1. **Tier 1 (Fast):** Request technical columns directly from TradingView scanner API. TradingView supports RSI, MACD, SMA, EMA, Bollinger Bands as requestable columns.
2. **Tier 2 (Comprehensive):** For indicators TradingView doesn't expose via scanner, compute server-side using fetched historical OHLCV data and a technical analysis library.

**Implementation:**

```typescript
// lib/services/technical-analysis.ts
export function computeRSI(prices: number[], period: number = 14): number[];
export function computeMACD(prices: number[]): { macd: number[]; signal: number[]; histogram: number[] };
export function computeSMA(prices: number[], period: number): number[];
export function computeEMA(prices: number[], period: number): number[];
export function computeBollinger(prices: number[], period: number): { upper: number[]; middle: number[]; lower: number[] };
export function detectCandlestickPattern(ohlcv: OHLCV[]): CandlestickPattern | null;
```

**TradingView columns to request for technicals:**
```
RSI, MACD.macd, MACD.signal, MACD.histogram, SMA20, SMA50, SMA200, 
EMA20, BB.upper, BB.middle, BB.lower, BB.percent_b, 
Recommend.Other, Recommend.All, volatility_d, Chaikin_Money_Flow,
Williams_R, ADX, ADX.positive_di, ADX.negative_di, AO, 
Stoch.K, Stoch.D, Stoch.RSI.K, ATR, Beta_3Y
```

### 3.3 Pattern Recognition

**Built-in candlestick pattern detection** (computed server-side):
- Bullish/Bearish Engulfing
- Morning/Evening Star
- Hammer / Shooting Star
- Doji (various)
- Three White Soldiers / Three Black Crows
- Piercing Pattern / Dark Cloud Cover
- Harami (Bullish/Bearish)
- Marubozu
- Spinning Top

### 3.4 Saved Scan Configurations

**New Model:** `ScanConfig` (replacing underutilized `SavedScreen` and extending `ScreenerConfig`)

```prisma
model ScanConfig {
  id          String   @id @default(uuid())
  userId      Int
  name        String
  description String?
  filters     Json     // FilterGroup tree (complete condition tree)
  columns     Json?    // Custom column selection
  schedule    String?  // Cron expression for auto-run (optional)
  isPublic    Boolean  @default(false)
  lastRunAt   DateTime?
  runCount    Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  results     ScanResult[]
  @@index([userId])
  @@map("scan_configs")
}

model ScanResult {
  id          String   @id @default(uuid())
  configId    String
  runAt       DateTime @default(now())
  matchCount  Int
  totalCount  Int
  executionMs Int
  status      String   @default("completed") // running | completed | failed
  error       String?

  config      ScanConfig @relation(fields: [configId], references: [id])
  items       ScanResultItem[]

  @@index([configId, runAt])
  @@map("scan_results")
}

model ScanResultItem {
  id        String   @id @default(uuid())
  resultId  String
  symbol    String
  name      String?
  price     Decimal? @db.Decimal(30,6)
  change    Decimal? @db.Decimal(30,6)
  pChange   Decimal? @db.Decimal(30,6)
  volume    BigInt?
  data      Json?    // Full snapshot of all fields at scan time

  result    ScanResult @relation(fields: [resultId], references: [id])
  @@index([resultId])
  @@index([symbol])
  @@map("scan_result_items")
}
```

### 3.5 Scheduled Scans → Alert Integration

- Users can attach an alert to any `ScanConfig`
- When a scheduled scan runs and finds matches, an alert is fired
- Alert contains: scan name, match count, top matches with key metrics
- Creates a `Notification` record + optional webhook delivery

### 3.6 Export Capabilities

| Format | Implementation | Notes |
|--------|---------------|-------|
| CSV | Server-side generated, streamed to client | Use existing `csv-parse` / `csv-stringify` |
| PDF | Server-side via MarkItDown HTML→PDF pipeline | Requires headless browser or PDF library |
| XLSX | Server-side via `exceljs` npm package | Full formatting support |
| JSON | Direct API response | Already supported |

### 3.7 Backtesting Engine

**Scope:** A simplified backtester for strategy validation:
- Define entry/exit conditions using the filter grammar
- Fetch historical data for a date range
- Simulate trades based on conditions
- Generate performance report (win rate, P&L, Sharpe ratio, max drawdown)

**Data model:**

```prisma
model BacktestRun {
  id          String   @id @default(uuid())
  userId      Int
  name        String
  configId    String?  // Optional: linked scan config
  entryFilter Json     // Entry condition tree
  exitFilter  Json     // Exit condition tree
  startDate   DateTime
  endDate     DateTime
  initialCapital Decimal? @db.Decimal(30,2)
  totalTrades Int      @default(0)
  winRate     Decimal? @db.Decimal(10,4)
  totalPnl    Decimal? @db.Decimal(30,2)
  maxDrawdown Decimal? @db.Decimal(10,4)
  sharpeRatio Decimal? @db.Decimal(10,4)
  status      String   @default("pending")
  createdAt   DateTime @default(now())
  
  trades      BacktestTrade[]
  @@index([userId])
  @@map("backtest_runs")
}

model BacktestTrade {
  id        String   @id @default(uuid())
  runId     String
  symbol    String
  entryDate DateTime
  exitDate  DateTime?
  entryPrice Decimal? @db.Decimal(30,2)
  exitPrice  Decimal? @db.Decimal(30,2)
  quantity  Int?
  pnl       Decimal? @db.Decimal(30,2)
  pnlPercent Decimal? @db.Decimal(10,4)
  
  run       BacktestRun @relation(fields: [runId], references: [id])
  @@index([runId])
  @@map("backtest_trades")
}
```

### 3.8 API Endpoints (Phase 1)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/screener/advanced` | Execute multi-condition scan (condition tree) |
| `POST` | `/api/screener/advanced/columns` | Get available technical columns from TradingView |
| `GET` | `/api/screener/configs` | List user's saved scan configs |
| `POST` | `/api/screener/configs` | Save a new scan config |
| `PUT` | `/api/screener/configs/:id` | Update scan config |
| `DELETE` | `/api/screener/configs/:id` | Delete scan config |
| `POST` | `/api/screener/configs/:id/run` | Execute saved config |
| `GET` | `/api/screener/configs/:id/history` | View past scan results |
| `POST` | `/api/screener/export` | Export results (CSV/PDF/XLSX) |
| `POST` | `/api/backtest/run` | Start a backtest |
| `GET` | `/api/backtest/runs` | List user's backtest runs |
| `GET` | `/api/backtest/runs/:id` | Get backtest details with trades |

---

## 4. Phase 2: Enterprise Alert Engine (v2.1.0)

### 4.1 Multi-Condition Alerts

**Problem:** Current alerts fire on single conditions (price_above, volume_spike). Users want:
> "Alert me when RELIANCE price is above 2500 **AND** RSI > 70 **AND** volume > 2x average"

**Solution:** Reuse the same `FilterGroup` tree from the screener for alert conditions.

```typescript
interface AlertRule {
  id: string;
  userId: number;
  name: string;
  // Reuse the condition tree from screener
  condition: FilterGroup;
  // Delivery configuration
  channels: AlertChannel[];
  // Schedule
  schedule?: {
    activeHours?: { start: string; end: string }; // 09:15-15:30
    activeDays?: number[]; // 0=Sun, 1=Mon...
    cooldownMinutes?: number; // Prevent alert spam (default 60)
  };
  // Escalation
  escalation?: {
    enabled: boolean;
    delayMinutes: number; // If not acknowledged
    escalateTo: AlertChannel[]; // More urgent channels
  };
  // One-click action
  action?: {
    type: "none" | "buy" | "sell" | "paper_trade";
    quantity?: number;
    price?: number;
    symbol?: string;
  };
}
```

### 4.2 Delivery Channels

| Channel | Implementation | Notes |
|---------|---------------|-------|
| **In-App** | `Notification` model (already exists) | Always on, no setup |
| **Email** | `nodemailer` or SendGrid API | Requires SMTP config, user verification |
| **Webhook** | `POST` to user-configured URL | Generic — supports Discord, Slack, custom |
| **Telegram** | Telegram Bot API | Bot token stored in `AgentKey` model |
| **Push** | Web Push API / Service Worker | Browser push notifications |
| **SMS** (Future) | Twilio / MSG91 | Costs involved, opt-in only |

**Data model:**

```prisma
model AlertChannel {
  id        String   @id @default(uuid())
  userId    Int
  type      String   // email | webhook | telegram | push
  name      String
  config    Json     // Type-specific config (url, token, phone, etc.)
  isActive  Boolean  @default(true)
  verified  Boolean  @default(false)
  createdAt DateTime @default(now())

  @@index([userId])
  @@map("alert_channels")
}

model AlertRule {
  id          String   @id @default(uuid())
  userId      Int
  name        String
  description String?
  condition   Json     // FilterGroup tree
  schedule    Json?    // Active hours, days, cooldown
  escalation  Json?    // Escalation rules
  action      Json?    // One-click action config
  channels    String[] // References to AlertChannel IDs
  isActive    Boolean  @default(true)
  lastTriggeredAt DateTime?
  triggerCount    Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([userId])
  @@map("alert_rules")
}

model AlertEvent {
  id          String   @id @default(uuid())
  ruleId      String
  triggeredAt DateTime @default(now())
  channel     String   // Which channel delivered
  status      String   // delivered | failed | pending
  error       String?
  metadata    Json?    // Trigger details (symbol, price, values)
  acknowledgedAt DateTime?

  rule        AlertRule @relation(fields: [ruleId], references: [id])
  @@index([ruleId, triggeredAt])
  @@map("alert_events")
}
```

### 4.3 Alert Delivery Service

```typescript
// lib/services/alert-delivery.ts
interface AlertDeliveryService {
  send(rule: AlertRule, event: AlertEvent, context: AlertContext): Promise<DeliveryResult>;
}

// Channel implementations:
class EmailAlertChannel implements AlertDeliveryService { ... }
class WebhookAlertChannel implements AlertDeliveryService { ... }
class TelegramAlertChannel implements AlertDeliveryService { ... }
class PushAlertChannel implements AlertDeliveryService { ... }
```

**Delivery workflow:**
1. Worker picks up pending alert rule check
2. Evaluates `FilterGroup` condition against live data
3. If triggered, checks cooldown period
4. For each channel, calls delivery service
5. Records `AlertEvent` with status
6. If escalation configured, starts escalation timer
7. User acknowledges → stops escalation

### 4.4 Alert Analytics Dashboard

**New page: `/alerts/analytics`**
- Trigger frequency chart (per rule, per day)
- Delivery success rate per channel
- Most triggered symbols
- Response time to alerts
- Top 10 alert conditions that fired

### 4.5 API Endpoints (Phase 2)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET/POST` | `/api/alerts/rules` | CRUD for alert rules |
| `PUT/DELETE` | `/api/alerts/rules/:id` | Update/delete rule |
| `GET/POST` | `/api/alerts/channels` | CRUD for delivery channels |
| `PUT/DELETE` | `/api/alerts/channels/:id` | Update/delete channel |
| `POST` | `/api/alerts/channels/:id/test` | Send test message |
| `GET` | `/api/alerts/events` | Alert event history |
| `POST` | `/api/alerts/events/:id/acknowledge` | Acknowledge alert |
| `GET` | `/api/alerts/analytics` | Alert analytics data |

---

## 5. Phase 3: Algo Trading & Pine Script Platform (v2.2.0)

### 5.1 Pine Script Strategy Viewer

**Goal:** Allow users to view/capture Pine Script strategies from TradingView and test them.

**Implementation:**
- Pine Script editor/display component (code editor with syntax highlighting)
- Parse basic Pine Script indicators/strategies to extract:
  - Entry conditions
  - Exit conditions
  - Stop loss / take profit levels
  - Position sizing
- Store strategies in the DB for backtesting

```prisma
model TradingStrategy {
  id          String   @id @default(uuid())
  userId      Int
  name        String
  description String?
  source      String   // manual | tradingview | community
  pineScript  String?  // Raw Pine Script code
  language    String   @default("pine_script") // pine_script | custom
  entryLogic  Json?    // Parsed entry conditions (FilterGroup format)
  exitLogic   Json?    // Parsed exit conditions
  slPercent   Decimal? @db.Decimal(10,4)
  tpPercent   Decimal? @db.Decimal(10,4)
  maxPositions Int?    @default(1)
  isPublic    Boolean  @default(false)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  backtests   BacktestRun[]
  @@index([userId])
  @@index([name])
  @@map("trading_strategies")
}
```

### 5.2 TradingView Webhook Integration

**Architecture:**
1. User creates a strategy alert in TradingView
2. TradingView sends webhook POST to `/api/webhooks/tradingview`
3. TradeNext receives webhook payload
4. Parses message (JSON or text with strategy name, action, symbol, price)
5. Executes order in paper trading engine
6. Creates audit trail

**Webhook endpoint:**

```typescript
POST /api/webhooks/tradingview
// Accepts TradingView alert format:
// {"passphrase": "secret", "time": "...", "ticker": "NSE:RELIANCE", "action": "buy", "price": 2500}
// Or text format:
// {{strategy.order.action}} {{ticker}} at {{close}}
```

**Security:**
- Webhook secret validation (shared secret per user/strategy)
- IP allowlisting (TradingView IPs)
- Rate limiting (max N webhooks per minute)

### 5.3 Paper Trading Engine

**Core engine that simulates order execution without real money:**

```typescript
// lib/services/paper-trading.ts
interface PaperTradeEngine {
  executeOrder(order: PaperOrder): Promise<ExecutionResult>;
  getPortfolio(userId: number): PaperPortfolio;
  getPositions(userId: number): PaperPosition[];
  getHistory(userId: number): PaperTrade[];
}
```

**Data model:**

```prisma
model PaperPortfolio {
  id             String   @id @default(uuid())
  userId         Int      @unique
  cash           Decimal? @db.Decimal(30,2) @default(1000000) // ₹10L starting capital
  totalValue     Decimal? @db.Decimal(30,2) // Updated on every trade
  totalPnl       Decimal? @db.Decimal(30,2)
  totalTrades    Int      @default(0)
  winRate        Decimal? @db.Decimal(10,4)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  positions      PaperPosition[]
  trades         PaperTrade[]

  @@map("paper_portfolios")
}

model PaperPosition {
  id        String   @id @default(uuid())
  portfolioId String
  symbol    String
  quantity  Int
  avgPrice  Decimal? @db.Decimal(30,2)
  currentPrice Decimal? @db.Decimal(30,2)
  pnl       Decimal? @db.Decimal(30,2)
  pnlPercent Decimal? @db.Decimal(10,4)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  portfolio PaperPortfolio @relation(fields: [portfolioId], references: [id])
  @@index([portfolioId, symbol])
  @@map("paper_positions")
}

model PaperTrade {
  id          String   @id @default(uuid())
  portfolioId String
  symbol      String
  side        String   // buy | sell
  quantity    Int
  price       Decimal? @db.Decimal(30,2)
  totalValue  Decimal? @db.Decimal(30,2)
  pnl         Decimal? @db.Decimal(30,2) // Realized P&L (only for sells)
  strategyId  String?  // Optional link to strategy
  source      String   @default("manual") // manual | webhook | strategy
  executedAt  DateTime @default(now())

  portfolio PaperPortfolio @relation(fields: [portfolioId], references: [id])
  @@index([portfolioId, executedAt])
  @@map("paper_trades")
}
```

### 5.4 Strategy Performance Analytics

**Per strategy:**
- Equity curve over time
- Win rate, profit factor, Sharpe ratio
- Maximum drawdown
- Trade distribution (by symbol, by month)
- Comparison vs benchmark (NIFTY 50)

### 5.5 API Endpoints (Phase 3)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET/POST` | `/api/trading/strategies` | CRUD for strategies |
| `PUT/DELETE` | `/api/trading/strategies/:id` | Update/delete strategy |
| `POST` | `/api/trading/strategies/:id/backtest` | Run backtest |
| `GET` | `/api/trading/portfolio` | Paper trading portfolio |
| `POST` | `/api/trading/orders` | Place paper trade |
| `GET` | `/api/trading/orders` | Order history |
| `GET` | `/api/trading/positions` | Open positions |
| `POST` | `/api/webhooks/tradingview` | TradingView webhook receiver |
| `GET` | `/api/trading/analytics` | Strategy performance analytics |

---

## 6. Phase 4: AI Agent System with LangChain/LangGraph (v3.0.0)

### 6.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     User Interface                        │
│  Screener UI  │  Alerts UI  │  Strategy UI  │  Agent UI  │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                   API Layer (Next.js)                      │
│   /api/agent/*  │  /api/mcp  │  /api/screener/*  etc.     │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│              LangGraph Agent Orchestrator                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Market    │  │ Pattern  │  │Document  │  │Sentiment │  │
│  │ Analyst   │  │ Scout    │  │  Analyst │  │ Analyzer │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  │
│       │             │             │             │         │
│  ┌────▼─────────────▼─────────────▼─────────────▼─────┐   │
│  │              LangChain Tool Registry                 │   │
│  │  ScreenerTool  │  AlertTool  │  FetchTool  │  ...    │   │
│  └────────────────────────────────────────────────────┘   │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                 Processing Pipeline                        │
│  MarkItDown (PDF→MD) │  Technical Analysis │  NSE API     │
│  TradingView Scanner │  Database (Prisma)  │  Web Search  │
└─────────────────────────────────────────────────────────┘
```

### 6.2 Agent Definitions

#### Agent 1: Market Analyst
**Purpose:** Provide comprehensive market analysis, answer questions about stocks, indices, trends.

**Tools:**
- `getStockQuote(symbol)` — Current price data
- `getIndexData(indexName)` — Index performance
- `getStockChart(symbol, period)` — Historical chart data
- `scanStocks(filterGroup)` — Run a screener query
- `getTopGainers(limit)` / `getTopLosers(limit)` — Market movers
- `getCorporateActions(symbol, type)` — Corporate events
- `getNews(symbol)` — Recent news

**Workflow (LangGraph):**
1. User asks "What's happening with banking stocks?"
2. Agent: `scanStocks({ sector: "Banks" })` → gets data
3. Agent: `getNews("NIFTY BANK")` → gets news
4. Agent: Synthesizes response with key insights
5. Returns structured analysis

#### Agent 2: Pattern Scout
**Purpose:** Detect technical patterns, chart formations, and trading opportunities.

**Tools:**
- `getStockChart(symbol, period, interval)` — OHLCV data
- `detectCandlestickPatterns(ohlcv)` — Pattern detection
- `computeTechnicalIndicators(ohlcv)` — RSI, MACD, Bollinger, etc.
- `scanStocksByPattern(pattern)` — Find stocks with specific patterns
- `getScannerMeta()` — Available technical fields

**Workflow:**
1. User asks "Find stocks showing Bullish Engulfing on daily chart"
2. Agent: Fetches OHLCV for NSE stocks
3. Agent: Runs pattern detection on each
4. Agent: Returns matched stocks with supporting charts/indicators

#### Agent 3: Document Analyst (MarkItDown Integration)
**Purpose:** Process uploaded documents (PDFs, images, Excel) to extract market intelligence.

**Tools:**
- `markitdownConvert(filePath)` — Convert any file to Markdown
- `analyzeDocumentContent(markdown)` — Extract financial data
- `searchDocument(query)` — RAG-like search within documents
- `saveInsights(symbol, insights)` — Store extracted insights

**Workflow:**
1. User uploads a quarterly report PDF
2. Agent: Converts PDF → Markdown via MarkItDown
3. Agent: Extracts key financial metrics (revenue, profit, margins)
4. Agent: Compares with previous quarter from DB
5. Agent: Saves `AIInsight` record + creates summary
6. Agent: Optionally triggers alert if significant finding

#### Agent 4: Sentiment Analyzer
**Purpose:** Analyze market sentiment from news, social media, and corporate announcements.

**Tools:**
- `getMarketNews(symbol)` — News articles
- `getAnnouncements(symbol)` — Corporate announcements
- `webSearch(query)` — Search recent mentions
- `analyzeSentiment(text)` — Sentiment scoring
- `getInsiderTrading(symbol)` — Insider activity

### 6.3 LangGraph Workflow Orchestrator

```typescript
// lib/agents/orchestrator.ts
import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";

// Define agent state
interface AgentState {
  messages: BaseMessage[];
  query: string;
  context: {
    symbols?: string[];
    timeRange?: { start: Date; end: Date };
    filters?: FilterGroup;
  };
  intermediateResults: ToolResult[];
  finalResponse?: string;
  confidence: number;
}

// Build workflow
const workflow = new StateGraph(AgentState)
  .addNode("classify_query", classifyQueryNode)
  .addNode("market_analyst", marketAnalystNode)
  .addNode("pattern_scout", patternScoutNode)
  .addNode("document_analyst", documentAnalystNode)
  .addNode("sentiment_analyzer", sentimentAnalyzerNode)
  .addNode("synthesize", synthesizeNode)
  .addEdge(START, "classify_query")
  .addConditionalEdges("classify_query", routeBasedOnIntent, [
    "market_analyst", "pattern_scout", "document_analyst", "sentiment_analyzer", "synthesize"
  ])
  .addEdge("market_analyst", "synthesize")
  .addEdge("pattern_scout", "synthesize")
  .addEdge("document_analyst", "synthesize")
  .addEdge("sentiment_analyzer", "synthesize")
  .addEdge("synthesize", END);

const agent = workflow.compile();
```

### 6.4 Tool Registry

```typescript
// lib/agents/tools/screener-tool.ts
export const screenerTool = new Tool({
  name: "scan_stocks",
  description: "Scan NSE stocks with complex multi-condition filters. Returns matching stocks with key metrics.",
  schema: z.object({
    filterGroup: FilterGroupSchema,
    limit: z.number().optional().default(50),
    sortBy: z.string().optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
  }),
  func: async ({ filterGroup, limit, sortBy, sortOrder }) => {
    return await executeScreenerAdvanced(filterGroup, { limit, sortBy, sortOrder });
  },
});
```

### 6.5 AI Agent API

```typescript
POST /api/agent/query
// Body: { query: string, context?: { symbols?: string[] } }
// Response: { response: string, agent: string, confidence: number, sources: Source[] }

POST /api/agent/analyze-document
// Multipart: file (PDF/Image/Excel), symbol?, options?
// Response: { insights: Insight[], summary: string, documentText: string }

POST /api/agent/scan-market
// Body: { intent: "patterns" | "opportunities" | "risks" | "custom", filters?: FilterGroup }
// Response: { analysis: string, findings: Finding[], recommendations: string[] }

GET /api/agent/insights?symbol=X
// Returns stored AI insights for a symbol
```

### 6.6 LangChain Dependencies

```
@langchain/core          ^0.3.0    — Base interfaces
@langchain/langgraph     ^0.2.0    — Workflow orchestration (state graphs)
@langchain/community     ^0.3.0    — Community integrations
@langchain/openai        ^0.4.0    — OpenAI LLM integration
langchain                ^0.3.0    — Main LangChain package
cheerio                   ^1.0.0   — HTML parsing (for web scraping)
pdf-parse                ^2.0.0    — PDF text extraction (alternative to MarkItDown)
```

**Note:** Agent API keys (OpenAI, etc.) will be added via `AgentKey` model only after local orchestration is verified.

---

## 7. Phase 5: Infrastructure & Security

### 7.1 MarkItDown Integration

**Deployment Architecture:**
- MarkItDown runs as a Python subprocess on the server
- For Netlify serverless: Use a Netlify Function with Python runtime (or call an external service)
- For local dev: Direct `node scripts/markitdown.mjs` call

**File Processing Pipeline:**

```
Upload (PDF/Image/Office) 
  → Save to temp directory /tmp/tradenext/uploads/
  → Call MarkItDown CLI for conversion
  → Process converted Markdown (extract financial data)
  → Store extracted data in DB (AIInsight model)
  → Clean up temp files
```

**Security considerations:**
- File size limits (5MB default, configurable)
- Allowed file types whitelist
- Temp file cleanup with TTL (15 minutes)
- No direct file serving — data extracted and stored in DB

### 7.2 Agent Key Management

```prisma
model AgentKey {
  id        String   @id @default(uuid())
  userId    Int?
  name      String
  provider  String   // openai | anthropic | groq | custom
  keyType   String   // api_key | bearer_token
  encryptedValue String // AES-256 encrypted
  mask      String   // Show last 4 chars only: "sk-...abcd"
  isActive  Boolean  @default(true)
  usageCount Int     @default(0)
  lastUsedAt DateTime?
  createdAt DateTime @default(now())
  expiresAt DateTime? // Optional key expiry

  @@index([userId])
  @@index([provider])
  @@map("agent_keys")
}
```

**Key management principles:**
- All API keys encrypted at rest (AES-256 with server-side secret)
- Keys never exposed to client (server-side proxy only)
- Usage tracking with rate limits per key
- Automatic expiry support
- Admin can view masked keys and usage stats

### 7.3 File Upload System

**Route:** `POST /api/files/upload`  
**Storage:** Local filesystem for dev, Netlify Blobs for prod  
**Pipeline:**

```typescript
// lib/services/file-processor.ts
interface FileProcessor {
  accept(file: File): boolean; // Check file type
  convert(file: File): Promise<string>; // Convert to markdown (MarkItDown)
  extract(file: File): Promise<ExtractedData>; // Domain-specific extraction
}

class PDFReportProcessor implements FileProcessor { ... }
class ImageProcessor implements FileProcessor { ... }
class ExcelProcessor implements FileProcessor { ... }
class CSVProcessor implements FileProcessor { ... }
```

### 7.4 Netlify Deployment Considerations

| Feature | Challenge | Solution |
|---------|-----------|----------|
| MarkItDown (Python) | Serverless doesn't support Python | Use standalone binary or external API |
| File temp storage | Ephemeral filesystem | Netlify Blobs or external storage (S3-compatible) |
| Long-running agents | 10s function timeout | Use streaming responses + worker tasks |
| LangChain heavy deps | Large bundle size | Lazy import, tree-shake, or external API calls |
| WebSocket/realtime | Netlify limited | Polling with SWR or SSE via worker |

---

## 8. Data Model Changes Summary

### New Models (8 total)

| Model | Phase | Table | Purpose |
|-------|-------|-------|---------|
| `ScanConfig` | 1 | `scan_configs` | Multi-condition screener configs |
| `ScanResult` | 1 | `scan_results` | Screener run results (batch) |
| `ScanResultItem` | 1 | `scan_result_items` | Individual stock in scan result |
| `BacktestRun` | 1 | `backtest_runs` | Backtest execution |
| `BacktestTrade` | 1 | `backtest_trades` | Individual backtest trade |
| `AlertRule` | 2 | `alert_rules` | Multi-condition alert rules |
| `AlertChannel` | 2 | `alert_channels` | Delivery channel configs |
| `AlertEvent` | 2 | `alert_events` | Alert trigger history |
| `TradingStrategy` | 3 | `trading_strategies` | Pine Script / custom strategies |
| `PaperPortfolio` | 3 | `paper_portfolios` | Paper trading accounts |
| `PaperPosition` | 3 | `paper_positions` | Open paper positions |
| `PaperTrade` | 3 | `paper_trades` | Paper trade history |
| `AgentKey` | 4 | `agent_keys` | AI provider API keys (encrypted) |

### Extended Models

| Model | Phase | Changes |
|-------|-------|---------|
| `ScreenerConfig` | 1 | Migrate to `ScanConfig` (or merge fields) |
| `SavedScreen` | 1 | Deprecated in favor of `ScanConfig` |
| `AIInsight` | 4 | Add `symbol`, `source`, `confidence`, `metadata`, `agentType` fields |
| `Notification` | 2 | Add `channelId`, `deliveryStatus`, `acknowledgedAt` fields |

---

## 9. UI/UX Architecture

### 9.1 Navigation Structure

```
Markets
├── Overview        (existing)
├── Screener        (Phase 1 - enhanced: /markets/screener)
│   ├── Simple      (current UI, preserved)
│   └── Advanced    (NEW: multi-condition builder)
├── Calendar        (existing)
└── Analytics       (existing)

Alerts
├── My Alerts       (existing, enhanced)
├── Alert Rules     (NEW: multi-condition rules)
├── Channels        (NEW: delivery channel config)
└── Analytics       (NEW: alert performance)

Trading             (NEW section: Phase 3)
├── Dashboard       (overview)
├── Strategies      (Pine Script viewer)
├── Portfolio       (paper trading)
├── Positions       (open positions)
└── Backtest        (run/view backtests)

AI                  (NEW section: Phase 4)
├── Market Analyst  (Q&A interface)
├── Pattern Scout   (pattern detection)
├── Document Analysis (file upload/analyze)
└── Insights        (saved AI insights)
```

### 9.2 Key UI Components

**Phase 1 - Filter Builder:**
```
┌──────────────────────────────────────────────────┐
│  [AND] + Add Condition  + Add Group  ──────────  │
│  ┌────────────────────────────────────────────┐  │
│  │ [OR] + Add Condition  + Add Group          │  │
│  │ ├── Price [gt] [2500]               [×]   │  │
│  │ └── P/E   [lt] [30]                 [×]   │  │
│  └────────────────────────────────────────────┘  │
│  ├── Volume [gte] [1000000]              [×]   │  │
│  └── RSI    [gt] [70]                    [×]   │  │
│                                                 │
│  Save As: [________________________] [Save]     │
│  [Run Scan]  [Schedule] [Export ▼]             │
└──────────────────────────────────────────────────┘
```

**Phase 2 - Alert Rule Builder:**
```
┌──────────────────────────────────────────────────┐
│  Alert Rule: "RELIANCE Breakout"                 │
│                                                   │
│  Condition:                                        │
│  [AND] ├── Symbol [eq] [RELIANCE]                 │
│        ├── Price [gt] [2500]                      │
│        └── RSI [gt] [70]                          │
│                                                   │
│  Channels: [✓ Email] [✓ Webhook] [Telegram]       │
│                                                   │
│  Schedule: Active Hours [09:15 ─ 15:30]           │
│            Cooldown [60] min                      │
│                                                   │
│  Escalation: After [15] min → [✓ SMS] [✓ Call]   │
│                                                   │
│  Action: [Paper Trade: Buy 10 shares]             │
└──────────────────────────────────────────────────┘
```

### 9.3 Mobile Responsiveness
- Filter builder collapses to single-column on mobile
- Technical charts render as full-width on mobile
- Alert rules show simplified view on phone
- Paper trading: quick buy/sell buttons accessible

---

## 10. Testing Strategy

### 10.1 Unit Tests

| Module | Test Focus | Files |
|--------|-----------|-------|
| `FilterGroup` evaluation | Condition tree logic, AND/OR evaluation | `lib/__tests__/filter-group.test.ts` |
| Technical indicators | RSI, MACD, SMA values vs known outputs | `lib/__tests__/technical-analysis.test.ts` |
| Pattern detection | Candlestick patterns against labeled data | `lib/__tests__/patterns.test.ts` |
| Alert delivery | Channel dispatch, retry, escalation | `lib/__tests__/alert-delivery.test.ts` |
| Paper trading engine | Order execution, P&L calc, positions | `lib/__tests__/paper-trading.test.ts` |
| Backtesting engine | Trade simulation, performance metrics | `lib/__tests__/backtest-engine.test.ts` |

### 10.2 Integration Tests

| Test | Description |
|------|-------------|
| Screener API → TradingView → DB | Full multi-condition scan flow |
| Alert Rule → Check → Delivery | Alert trigger through all channels |
| Webhook Receiver → Paper Trade | TradingView webhook to order execution |
| Document Upload → MarkItDown → AI Insight | File processing pipeline |

### 10.3 Playwright E2E Tests

| Test | Page |
|------|------|
| Filter builder interaction (add/remove groups) | `/markets/screener` |
| Alert rule creation with channels | `/alerts` |
| Paper trade execution flow | `/trading/portfolio` |
| Strategy backtest run | `/trading/strategies` |
| AI agent chat interface | `/ai` |

### 10.4 Prisma Guardrails

All destructive DB operations (migrate reset, db push --force-reset) require explicit user consent per project policy.

---

## 11. Migration Path

### Phase 1: Advanced Screener (v2.0.0)
**Effort:** ~3 weeks  
**Dependencies:** None  
**Test locally:** ✓ Yes, no external keys needed  
**Netlify deploy:** Safe (uses existing TradingView API)

```
Week 1:
├── Filter grammar + condition tree evaluation engine
├── TradingView technical column expansion
├── Backend API endpoints (advanced scan, configs)
└── Unit tests for filter evaluation
  
Week 2:
├── Filter builder UI component (drag/drop groups)
├── Technical indicator display in results table
├── Saved configs with run history UI
└── Integration tests
  
Week 3:
├── Backtesting engine (simplified first pass)
├── Export functionality (CSV)
├── Scan scheduling + alert integration
└── Playwright E2E tests
```

### Phase 2: Enterprise Alerts (v2.1.0)
**Effort:** ~2 weeks  
**Dependencies:** Phase 1 (reuses filter grammar)  
**Test locally:** ✓ Yes (email/webhook with local SMTP)  
**Netlify deploy:** Requires external SMTP/webhook

```
Week 1:
├── Alert rule model + CRUD API
├── Delivery channel models + API
├── Channel implementations (Email, Webhook, Telegram)
└── Alert evaluation engine (reuses FilterGroup)
  
Week 2:
├── Alert rule UI (builder from Phase 1)
├── Channel configuration UI
├── Alert analytics dashboard
└── Escalation + cooldown logic
```

### Phase 3: Algo Trading (v2.2.0)
**Effort:** ~3 weeks  
**Dependencies:** Phase 1 (backtesting), Phase 2 (alert actions)  
**Test locally:** ✓ Yes (paper trading needs no external keys)  
**Netlify deploy:** Webhook endpoint is serverless-friendly

```
Week 1:
├── Paper trading engine
├── Portfolio/position model
├── Trading strategy model
└── Paper trading API
  
Week 2:
├── Strategy management UI
├── Paper trading dashboard
├── TradingView webhook receiver
└── Backtest → strategy integration
  
Week 3:
├── Strategy performance analytics
├── Integration with alerts (one-click trade)
├── Playwright E2E tests
└── Documentation
```

### Phase 4: AI Agents (v3.0.0)
**Effort:** ~4 weeks  
**Dependencies:** Phase 1, 2, 3 (agents need all tools)  
**Test locally:** ✓ Yes (with local LLM or mock)  
**Agent keys:** Added only after local orchestration verified  
**Netlify deploy:** Requires careful bundle optimization

```
Week 1:
├── LangChain tool definitions (screener, alert, fetch, etc.)
├── Agent state machine with LangGraph
├── Market Analyst agent
└── Unit tests with mocked LLM
  
Week 2:
├── Pattern Scout agent
├── Document Analyst agent (MarkItDown integration)
├── Sentiment Analyzer agent
└── Agent orchestration workflow
  
Week 3:
├── File upload + MarkItDown processing pipeline
├── Agent key management (encrypted storage)
├── AI agent API endpoints
└── Agent UI (chat interface)
  
Week 4:
├── Agent memory and conversation history
├── Caching and rate limiting for AI calls
├── Performance optimization
└── E2E tests + documentation
```

---

## 12. Success Metrics

### Phase 1 - Screener
- [ ] Users can build multi-condition scans with AND/OR groups
- [ ] 20+ technical indicators available as filter fields
- [ ] 10+ candlestick patterns detectable
- [ ] Scan results exportable to CSV
- [ ] Backtester produces valid performance reports
- [ ] Scans can be scheduled and trigger alerts

### Phase 2 - Alerts
- [ ] Users can create multi-condition alert rules
- [ ] At least 3 delivery channels functional (Email, Webhook, Telegram)
- [ ] Escalation rules trigger correctly after timeout
- [ ] Alert analytics shows trigger frequency and delivery rates
- [ ] One-click action from alert works

### Phase 3 - Algo Trading
- [ ] Paper trading engine executes orders correctly
- [ ] TradingView webhook successfully creates paper trades
- [ ] Backtest results match manual calculation
- [ ] Strategy performance dashboard shows accurate metrics
- [ ] Users can view strategy equity curves

### Phase 4 - AI Agents
- [ ] Market Analyst answers stock queries with live data
- [ ] Pattern Scout finds stocks with specific patterns
- [ ] Document Analyst extracts key metrics from uploaded PDFs
- [ ] Sentiment Analyzer provides actionable sentiment scores
- [ ] Agent keys stored encrypted, never exposed to client
- [ ] All agents work with mock LLM in test mode

---

## Appendix A: Prisma Migration Note

All new models use `@@map()` to ensure consistent snake_case table names. The `prisma db push` command should be used for development, with `prisma migrate dev` for production schema changes.

**Safe commands:**
```bash
npx prisma generate        # Regenerate client
npx prisma db push         # Sync schema (safe for dev)
npx prisma migrate dev     # Create migration
```

**Protected commands (require user consent):**
```bash
npx prisma migrate reset --force    # Destroys ALL data
npx prisma db push --force-reset    # Destroys ALL data
```

## Appendix B: Key Dependencies to Install Per Phase

```
Phase 1:
  npm install exceljs          # XLSX export
  
Phase 2:
  npm install nodemailer       # Email delivery
  npm install @types/nodemailer
  
Phase 3:
  (no new dependencies - reuses existing)
  
Phase 4:
  npm install @langchain/core @langchain/langgraph @langchain/community
  npm install @langchain/openai langchain
  npm install cheerio pdf-parse
  
Phase 5:
  npm install crypto-js        # For agent key encryption
  npm install @types/crypto-js
```

## Appendix C: File Structure Additions

```
lib/
├── screener/
│   ├── filter-engine.ts       # FilterGroup evaluation
│   ├── condition-tree.ts      # Condition tree builder/validator
│   └── technical-analysis.ts  # RSI, MACD, SMA, etc.
├── alerts/
│   ├── alert-engine.ts        # Multi-condition alert evaluation
│   └── delivery/
│       ├── email.ts           # Email delivery channel
│       ├── webhook.ts         # Webhook delivery channel
│       └── telegram.ts        # Telegram delivery channel
├── trading/
│   ├── paper-trading.ts       # Paper trading engine
│   ├── strategy-parser.ts     # Pine Script parser (basic)
│   └── webhook-handler.ts     # TradingView webhook processor
├── agents/
│   ├── orchestrator.ts        # LangGraph workflow
│   ├── nodes/
│   │   ├── market-analyst.ts  # Market analysis agent
│   │   ├── pattern-scout.ts   # Pattern detection agent
│   │   ├── document-analyst.ts # Document analysis agent
│   │   └── sentiment.ts       # Sentiment analysis agent
│   ├── tools/
│   │   ├── screener-tool.ts   # Screener tool
│   │   ├── alert-tool.ts      # Alert tool
│   │   ├── fetch-tool.ts      # Data fetching tool
│   │   └── document-tool.ts   # Document processing tool
│   └── memory.ts              # Agent memory management
└── services/
    ├── file-processor.ts      # File upload + MarkItDown pipeline
    └── backtest-engine.ts     # Backtesting engine

app/
├── api/
│   ├── screener/advanced/     # Phase 1 new endpoints
│   ├── screener/configs/      # Scan config CRUD
│   ├── screener/configs/[id]/ # Individual config operations
│   ├── screener/export/       # Export endpoint
│   ├── backtest/              # Backtest endpoints
│   ├── alerts/rules/          # Phase 2 alert rules
│   ├── alerts/channels/       # Delivery channels
│   ├── alerts/events/         # Alert history
│   ├── alerts/analytics/      # Alert analytics
│   ├── trading/               # Phase 3 trading endpoints
│   ├── webhooks/tradingview/  # TradingView webhook receiver
│   └── agent/                 # Phase 4 AI agent endpoints
├── markets/screener/
│   ├── page.tsx               # Enhanced screener page
│   └── components/
│       ├── FilterBuilder.tsx  # Multi-condition filter builder
│       ├── ConditionRow.tsx   # Single condition row
│       ├── FilterGroup.tsx    # AND/OR group component
│       └── ScanHistory.tsx    # Past scan results
├── alerts/
│   ├── page.tsx               # Enhanced alerts page
│   └── components/
│       ├── AlertRuleList.tsx  # Alert rule management
│       ├── AlertRuleForm.tsx  # Multi-condition rule form
│       ├── ChannelConfig.tsx  # Delivery channel settings
│       └── AlertAnalytics.tsx  # Alert metrics dashboard
├── trading/
│   ├── page.tsx               # Trading dashboard
│   ├── strategies/            # Strategy management
│   ├── portfolio/             # Paper trading view
│   └── backtest/              # Backtest results
└── ai/
    ├── page.tsx               # AI agent chat interface
    └── components/
        ├── ChatInterface.tsx  # Conversation UI
        └── InsightCard.tsx    # AI insight display
```

---

> **Next Steps:**
> 1. Review and approve this PRD
> 2. Begin Phase 1 implementation (Advanced Screener)
> 3. Test all endpoints locally with mock data
> 4. Add agent API keys after Phase 4 local verification
> 5. Deploy to Netlify incrementally per phase
