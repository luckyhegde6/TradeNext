# Serverless Logging & Netlify (v1.10.4 DB logs, v1.9.2 join flow, v1.9.1 notifications, v1.8.2 502 fix)

> ⚠️ **HISTORICAL / SUPERSEDED (v3.11.3)** — this deep-dive documents the SERVERLESS-era logging design
> (Blob-store mirroring, `/tmp` logs dir, `isServerless()` branches). **All of it was REMOVED in v3.11.3**
> (full serverless purge — Netlify now runs the app as a persistent Next.js server, so file logs in `logs/`
> + the DB-backed `ServerLog` table are the single source of truth; `lib/netlify-logger.ts` was deleted and
> `@netlify/blobs` dropped from dependencies). Keep reading this for HISTORY only — the file-level and
> DB-backed logging described below still exist, but any Blob/serverless-specific mechanism does not.
>
> Legacy feature deep-dive. Index: [../CHANGELOG.md](../CHANGELOG.md).

## Serverless Logging Fix (v1.10.4)

### Problem
- Worker logs and server logs were not working on serverless platforms (Netlify/Vercel)
- `.next/server_logs` directory doesn't exist or isn't writable in serverless environments
- No persistent storage for logs across deployments

### Solution
Added database-backed logging system that works everywhere:

#### ServerLog Model
```prisma
model ServerLog {
  id          String    @id @default(uuid())
  level       String    // "info" | "warn" | "error" | "debug"
  message     String
  source      String?   // "worker" | "api" | "sync" | "system" | "nse"
  taskId      String?   // Associated task ID (for worker logs)
  metadata    Json?     // Additional structured data
  ipAddress   String?
  userAgent   String?
  requestId   String?
  createdAt   DateTime  @default(now())
  
  @@index([level])
  @@index([source])
  @@index([taskId])
  @@index([createdAt])
}
```

#### db-logger.ts Service
Provides helper functions for logging:
- `logToDb(entry)` - Core logging function
- `dbInfo(message, metadata?, source?)` - Quick info log
- `dbWarn(message, metadata?, source?)` - Quick warning log
- `dbError(message, metadata?, source?)` - Quick error log
- `dbDebug(message, metadata?, source?)` - Quick debug log
- `getDbLogs(options)` - Retrieve logs with filtering
- `cleanupOldLogs(retentionDays)` - Automatic cleanup (default 7 days)
- `getLogStats()` - Get statistics

#### worker-logger.ts Updates
Updated to use fallback chain:
1. File logging (local only)
2. Netlify Blobs (if on Netlify)
3. Database fallback (always works)

#### API Route
`GET/DELETE /api/admin/logs` for managing server logs:
- Query params: `type` (db|worker|files|stats), `level`, `source`, `taskId`, `limit`, `offset`
- DELETE with `retentionDays` param for cleanup

---

## New Features (v1.9.2)

### Secure Join Request Flow
- **Admin Approval System**: Direct user creation is now restricted. Prospective users must submit a "Join Request" (Name, Email, Mobile, Message).
- **Admin Interface**: A new tabbed interface in User Management allows admins to review, approve, or reject pending requests.
- **Auto-Account Creation**: Upon approval, the system automatically creates a user account and generates a temporary password (stored securely).
- **RBAC Enforcement**: Middleware now strictly protects `/users/*` and `/admin/*` routes, redirecting unauthorized attempts.
- **Security Cleanup**: Removed legacy `/users/new` route and direct signup APIs to close security loopholes.

---

## New Features (v1.9.1)

### Notifications Page (/notifications)
- **Aggregated Updates Feed**: A unified view for all system activities, task completions, and alerts.
- **Role-Based Tabs**: 
    - **All**: Combined feed of system updates, alerts, and tasks.
    - **Alerts**: Focused view of price targets and market anomalies.
    - **Tasks**: (Admin Only) Real-time worker task statuses and success/failure logs.
    - **System**: Audit logs for sensitive actions (Login failures, Rate limits, NSE API calls).
- **Global Announcements**: Important admin announcements are now visible to all logged-in users.
- **Access Control**: Secure page requiring authentication, with modern "Access Denied" state.

### Persistent Serverless Logging (Netlify Blobs)
- **Problem**: Next.js file system logging is ephemeral on Netlify/Vercel.
- **Solution**: Integrated `@netlify/blobs` for persistent log storage.
- **Implementation**: Worker logs and server logs are now written to Netlify Blob storage, allowing the Admin Monitoring panel to display logs across deployments.
- **Async Logging**: Converted logging utilities to be asynchronous to support cloud storage writes.

### UX & Bug Fixes
- **Login Modal**: Centered and mobile-responsive modal implementation for seamless authentication.
- **NSE DB Logging**: Fixed a bug where NSE API calls weren't appearing in the Monitoring DB logs; integrated `logAPIRequest` into `nse-client.ts`.
- **Dependency Optimization**: Removed `date-fns` for notification time formatting in favor of a native, lightweight `formatTimeAgo` helper.
- **Prisma v7 Stability**: Resolved casing issues in the Prisma client (`aPIRequestLog`, `workerTask`) using type-safe workarounds.

---
