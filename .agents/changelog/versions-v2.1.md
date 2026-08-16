# Version History v2.1

> From TradeNext version history. Index: [../CHANGELOG.md](../CHANGELOG.md). All v2.x files: [versions-v2.md](./versions-v2.md).

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
