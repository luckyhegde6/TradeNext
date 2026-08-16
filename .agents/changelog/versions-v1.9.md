# Version History v1.9

> From TradeNext version history. Index: [../CHANGELOG.md](../CHANGELOG.md). All v1.x files: [versions-v1.md](./versions-v1.md).

- **v1.9.3** - Build Fixes (March 19, 2026). Fixed Next.js 15+ async params in dynamic route handlers (`Promise<{ id: string }>`). Fixed Zod v4 error property (`issues` instead of `errors`). Regenerated Prisma client.
- **v1.9.2** - Secure Join Request Flow (March 19, 2026). Replaced direct user signup with an admin-approved join request system. Implemented RBAC for `/users/*` and `/admin/*` routes. Added a tabbed management interface for admins and cleaned up legacy insecure routes.
- **v1.9.1** - Notifications & UX Enhancements (March 18, 2026). Implemented a comprehensive Notifications Page at `/notifications`. Integrated triggered alerts into the notification feed. Added persistent logging via Netlify Blobs for serverless environments. Fixed NSE DB logging and centered the login modal.
- **v1.9.0** - Worker Engine & NSE Sync (March 18, 2026). Implemented a persistent background worker and cron scheduler. Added automated NSE data synchronization for corporate actions, events, news, and market data. Introduced a dynamic logging system in `.next/server_logs` with elevated permissions.
