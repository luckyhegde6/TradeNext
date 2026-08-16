# Version History v3.2

> From TradeNext version history. Index: [../CHANGELOG.md](../CHANGELOG.md). All v3.x files: [versions-v3.md](./versions-v3.md).

- **v3.2.0** — Phase 4: Intelligence & Reporting — Telegram Bot + All Planned Features (July 18, 2026):
  - **Bug Fix**: Corporate Actions Price/Yield columns now correctly fetch live prices from `daily_prices` and compute yield using `(dividendPerShare / currentPrice) * 100`
  - **Telegram Bot (@tradenext6Bot)**: Full-featured bot with command routing, per-chat rate limiting (5/min, 20/hr), user verification via 6-digit code, audit logging, and proactive alert delivery
  - **Bot Commands**: `/start`, `/chatid`, `/help`, `/recommendations`, `/alerts`, `/updates`
  - **User Subscription**: Alerts page "Telegram Bot" tab with register → verify → test flow
  - **Verify API**: `/api/user/telegram/verify` with send (generate code) and confirm (validate) actions
  - **Test API**: `/api/user/telegram/test` sends test message to verify delivery
  - **Bot Service**: `lib/services/telegramBotService.ts` — Centralized handler with command map, rate limiter, user lookup, broadcast support
  - **Webhook Updated**: `app/api/telegram/webhook/route.ts` now delegates to `handleBotCommand()`
  - **Rate Limiting**: In-memory sliding window with cooldown enforcement
  - **Audit Logging**: All commands logged with chatId, userId, command, args, success status
  - **Broadcast**: `broadcastToSubscribers()` sends announcements to all verified users
  - **Documentation Updated**: README.md, AGENTS.md, Contact FAQ page with Telegram bot info
  - **PRD Created**: `.agents/PRD.md` — Comprehensive product requirements doc covering all Phase 4 features
  - **TODO.md Updated**: Full roadmap with PRD reference and UI/UX testing checklists
  - **Build Fix — Rebalancer Client Import**: Extracted types (`AllocationCategory`, `RebalancerAction`, `DEFAULT_SECTOR_TARGETS`) from `lib/services/rebalancerService.ts` to `lib/services/rebalancerTypes.ts` to prevent Next.js client bundle from resolving `pg`, `dns`, etc. Updated `TargetAllocationEditor.tsx`, `AllocationTable.tsx`, `TradeSuggestionList.tsx` imports.
  - **Dev Server Lesson**: PowerShell `ProcessStartInfo` with `CreateNoWindow=true` avoids LLM blocking; `start /B` with output redirection does not.
  - **Files Created**: `lib/services/telegramBotService.ts`, `app/api/user/telegram/test/route.ts`, `app/api/user/telegram/verify/route.ts`, `app/components/alerts/TelegramSubscription.tsx`, `lib/services/rebalancerTypes.ts`
  - **Files Modified**: `app/api/telegram/webhook/route.ts`, `app/alerts/page.tsx`, `app/contact/page.tsx`, `README.md`, `AGENTS.md`, `next.config.ts`, `app/components/rebalancer/AllocationTable.tsx`, `app/components/rebalancer/TargetAllocationEditor.tsx`, `app/components/rebalancer/TradeSuggestionList.tsx`
