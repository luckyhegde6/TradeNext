# Version History v1.8

> From TradeNext version history. Index: [../CHANGELOG.md](../CHANGELOG.md). All v1.x files: [versions-v1.md](./versions-v1.md).

- **v1.8.3** - Corp Actions Seeding & Auth Stability (March 18, 2026). Fixed broken database seeding logic for corporate actions, eliminating Prisma Accelerate connection timeouts by batching inserts. Resolved a stubborn NextAuth "ghost session" bug that prevented proper logout.
- **v1.8.2** - Netlify 502 Fix (March 16, 2026). Fixed 502 Bad Gateway error on Netlify. Root cause: Middleware with NextAuth was causing edge function crashes despite `runtime = 'nodejs'`. Solution: Created minimal middleware without NextAuth imports. Authentication now handled at API route level. Prisma Accelerate configuration fixed with `accelerateUrl` option.
- **v1.8.1** - Build Fixes (March 16, 2026). Fixed Prisma 7 adapter configuration. Moved type packages to dependencies for Netlify. Fixed logger to output in production. Fixed netlify.toml syntax. Added startup logging for debugging 502 errors.
