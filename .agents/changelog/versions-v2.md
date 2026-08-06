# Version History v2.x

> From TradeNext version history. Index: [../CHANGELOG.md](../CHANGELOG.md). Latest versions in [versions-v3.md](./versions-v3.md).

- **v2.2.0** — Admin Alert Config Management + Screener Template Expansion (July 18, 2026). Complete admin infrastructure for alert delivery management and expanded Chartink-inspired screener templates:
  - **Prisma Schema Updates**: Added `Secret` model (AES-256-GCM encrypted storage for credentials), `DeliveryLog` model (delivery tracking). Enhanced `AlertEvent` with `acknowledgedAt`, `channelId`. Enhanced `AlertChannel` with `lastTestedAt`, `lastUsedAt`, `failureCount`. Enhanced `Notification` with `deliveryStatus`, `acknowledgedAt`, `channelId`.
  - **Telegram Delivery Module**: `lib/alerts/delivery/telegram.ts` — fetch-based Bot API integration with HTML/Markdown formatting, config validation, error handling for common Telegram API errors.
  - **Delivery Manager Updates**: `lib/alerts/delivery/index.ts` — enhanced with Telegram support, system-wide channels (userId: 0), `getDeliveryStats()` with success/failure rates by channel, DeliveryLog recording per attempt.
  - **Encrypted Secrets Service**: `app/api/admin/alerts/secrets/route.ts` — AES-256-GCM encryption/decryption for SMTP passwords, API keys, bot tokens, webhook secrets. Hints/masked values for safe display. CRUD with name uniqueness validation, `safeInt()` NaN guard.
  - **Admin Channels API**: `app/api/admin/alerts/channels/route.ts` — full CRUD for system-wide delivery channels. Stats by type/active/system. Include `includeSecrets` mode to show resolved secret references.
  - **Admin Events API**: `app/api/admin/alerts/events/route.ts` — filtered/paginated delivery event view with user enrichment. Stats by status and channel type. Time window selection (1h-7d).
  - **Admin Alerts UI**: Tabbed management page (`/admin/alerts`) with four tabs: User Alerts (existing), Delivery Channels (table + create form with Email/Webhook/Telegram/In-App options + test/delete/toggle), Secrets (encrypted storage with show/hide toggle), Delivery Logs (filters + time window + acknowledge).
  - **Schema Fix**: Renamed `@@index([ruleId, triggeredAt])` → `@@index([ruleId, attemptedAt])` in AlertEvent model. Fixed `triggeredAt`→`attemptedAt` in alert event API routes.
  - **Screener Templates Expanded**: `lib/screener/screener-templates.ts` grew from 25 presets to **98 templates** across 9 categories:
    - Fundamental (15): Large/Mid/Small Cap, Low P/E, High EPS, Below Book Value, High Dividend, High ROE, Low Debt, Profit Jump 200%, Sales Jump 200%, Penny Stocks, Top Lowest PE, High Volume, Position Buy
    - Technical (16): RSI Oversold/Overbought/Bounce, 200 EMA, SMA50/SMA200, High Relative Volume, ATR Breakout, Strong ADX, High Volume Breakout, Top Gainers/Losers, Most Active, 52W High, Bollinger Squeeze, NR7
    - Candlestick (16): Doji, Bullish/Bearish Engulfing, Morning Star, Hammer, Shooting Star, Hanging Man, Marubozu, Dragonfly Doji, Tweezer Top/Bottom, Dark Cloud Cover, Piercing, Bullish/Bearish Harami, Spinning Top
    - Range Breakout (7): Short Term Breakouts, Potential Breakouts, NR7 Current Day, NR7 Inside Bar, 52W Low Bounce, Bollinger Outside, First 15min Breakout
    - Crossover (10): Bullish EMA (5,13,26), MACD Crossover, 4 MA Crossover, FNO ADX+MACD, SuperTrend, Weekly MACD, Monthly RSI, MA Crossover, 200 SMA, Ichimoku Cloud
    - Bullish (10): Bullish Momentum, Pure Bullish Trend, Engulfing Strong, RSI+Stochastic, BTST Engulfing, F&O Uptrend, Harami, RSI Divergence, NKS Best Buy, BOSS Scanner
    - Bearish (8): Perfect Bearish, Engulfing Strong, RSI+Stochastic, Volume Spike 5min, Downtrend, Perfect Sell, 3:15 PM Engulfing, Chanakya Scanner
    - Intraday Bullish (8): Open=Low, Momentum Bullish, Day Low=High, Jackpot Buy, BTST, RSI Breakout, Ichimoku, Santu Baba Open=Low+1%
    - Intraday Bearish (8): Sell Open=High, Intraday Reversal, Future Sell SuperTrend, Mohan's Sure Sell, Near Support, Shot Down, Last 15min Selling, Gap Up Open=High Short
  - **Bug Fixes**: Removed hardcoded fallback encryption key (security P1), added `safeInt()` NaN validation in API routes (P2), replaced `console.error` with `logger.error` in channels/secrets routes (P2), fixed `triggeredAt`→`attemptedAt` in alert event API routes.
  - **Files Created**: `lib/alerts/delivery/telegram.ts`, `app/api/admin/alerts/channels/`, `app/api/admin/alerts/events/`, `app/api/admin/alerts/secrets/`
  - **Files Modified**: `lib/screener/screener-templates.ts` (25→98 templates), `lib/alerts/delivery/index.ts` (Telegram + system channels + stats), `app/admin/alerts/page.tsx` (4-tab UI + Telegram type), `prisma/schema.prisma` (Secret, DeliveryLog models + AlertChannel/AlertEvent enhancements), `app/admin/page.tsx`, `app/api/admin/alerts/route.ts`, `app/api/alerts/evaluate/route.ts`, `app/api/alerts/events/route.ts`
  - **Tests**: All 190 existing tests pass (no regressions). Zero new TypeScript compilation errors in production code.

- **v2.1.0** - Enterprise Alert Engine (July 17, 2026). Complete Phase 2 of Alert Engine system:
  - **Prisma Models**: Added `AlertChannel`, `AlertRule`, `AlertEvent` models. Enhanced `Notification` with `deliveryStatus`, `acknowledgedAt`, `channelId`.
  - **Email Delivery**: `lib/alerts/delivery/email.ts` — nodemailer SMTP transport with config validation, HTML template builder with price/change display.
  - **Webhook Delivery**: `lib/alerts/delivery/webhook.ts` — fetch-based HTTP POST with Slack (attachments format), Discord (embeds format), Generic JSON formats. Config validation, color mapping.
  - **Delivery Manager**: `lib/alerts/delivery/index.ts` — routes to channels, records AlertEvent, creates in-app Notification, escalation scheduling.
  - **Alert Engine**: `lib/alerts/alert-engine.ts` — FilterGroup-based condition evaluation against live quotes via `getStockQuote()`, schedule restrictions (active hours/days), cooldown enforcement, message building.
  - **API Routes (7)**: `/api/alerts/rules` (GET/POST), `/api/alerts/rules/:id` (GET/PUT/DELETE), `/api/alerts/channels` (GET/POST), `/api/alerts/channels/:id` (GET/PUT/DELETE), `/api/alerts/channels/:id/test` (POST), `/api/alerts/events` (GET/POST acknowledge), `/api/alerts/evaluate` (POST trigger/GET stats).
  - **UI Components**: Tabbed alerts page with RuleList (FilterGroup-based rule builder), ChannelConfig (email/webhook setup wizard), EventHistory (filterable/paginated log).
  - **Tests (17)**: email-delivery (7 tests), webhook-delivery (7 tests), alert-engine (10 tests). All 190 existing tests unaffected.
  - **react-is**: Fixed missing recharts peer dependency.

