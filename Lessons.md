# Lessons.md - Rules & Corrections

> Agent MUST read this file before making any commit. Apply all rules below.

---

## Rules for This Project

### 1. Prisma 7 + Prisma Accelerate on Netlify
**Issue**: Build/runtime failing with database connection errors

**Root Cause**: Prisma 7 requires either adapter or accelerateUrl to be specified

**Solution for Prisma Accelerate**:
```typescript
// lib/prisma.ts
import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.DATABASE_URL || '';

// Check if using Accelerate (URL starts with prisma+postgres:// or prisma://)
const useAccelerate = databaseUrl.startsWith('prisma+postgres://') || databaseUrl.startsWith('prisma://');

if (useAccelerate) {
  // Use accelerateUrl option
  prismaClient = new PrismaClient({ 
    accelerateUrl: databaseUrl 
  } as any);
} else {
  // Use driver adapter for direct PostgreSQL
  const pool = new Pool({ connectionString: databaseUrl });
  const adapter = new PrismaPg(pool);
  prismaClient = new PrismaClient({ adapter });
}
```

---

### 2. MIDDLEWARE - THE MAIN 502 CAUSE ⚠️
**Issue**: 502 Bad Gateway even when Prisma works during build

**Root Cause**: Middleware with NextAuth causes edge function crashes on Netlify

**Symptoms**:
- Build succeeds
- Prisma initializes correctly during build
- Runtime returns 502
- All pages (including static) return 502

**Solution**: 
- DO NOT use NextAuth in proxy on Netlify
- Create minimal proxy WITHOUT NextAuth imports
- Handle authentication at API route level instead
- Use `proxy.ts` (not `middleware.ts`) in Next.js 16+

**CORRECT Minimal Proxy**:
```typescript
// proxy.ts - Next.js 16+ compatible
import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {  // Export name MUST be "proxy"
    const response = NextResponse.next();
    
    // CORS headers
    const origin = request.headers.get('origin');
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        response.headers.set('Access-Control-Allow-Origin', origin);
    }
    
    // Security headers
    response.headers.set('X-Content-Type-Options', 'nosniff');
    
    return response;
}

export const config = {
    matcher: '/((?!_next|[^?]*\\.(?:html?|css|js)).*)',
};
```

**What NOT to do**:
```typescript
// ❌ DON'T - This causes 502 on Netlify
import NextAuth from "next-auth";
const { auth } = NextAuth(authConfig);
export default auth((req) => { ... });
```

**Key Points for Next.js 16+**:
- File MUST be named `proxy.ts` (not `middleware.ts`)
- Export MUST be named `proxy` (not `middleware`)
- No `runtime = 'nodejs'` needed (proxy runs on Node.js by default)

---

### 3. Netlify Build - Dependencies
**Issue**: Build failing with missing module errors on Netlify

**Root Cause**: DevDependencies not installed on Netlify

**Solution**: 
- Move runtime-required packages to `dependencies` in package.json

**Packages That Must Be in Dependencies**:
- @types/node, @types/bcryptjs, @types/morgan
- @types/node-cache, @types/pg
- @types/react, @types/react-dom
- @types/sanitize-html, @types/unzipper
- typescript, postcss, @tailwindcss/postcss

---

### 4. Netlify Environment Variables
**Issue**: 502 Bad Gateway - database connection failure

**Root Cause**: DATABASE_URL points to localhost or invalid URL

**Solution**:
- DO NOT set USE_REMOTE_DB=true in netlify.toml
- Set valid DATABASE_URL in Netlify Dashboard → Environment Variables
- For Prisma Accelerate: use prisma+postgres://... format
- For direct PostgreSQL: use postgresql://user:pass@host:port/db

---

### 5. Logger - Production Output
**Issue**: No logs visible in production to debug

**Solution**:
- ALWAYS log to console for debugging
- Use console.log/console.error directly for critical errors
- Named exports needed: `export const info = logger.info`

---

### 6. Netlify TOML Syntax
**Issue**: "Unterminated inline array" error

**Root Cause**: Multi-line environment variables not allowed in TOML

**Solution**:
- Keep environment variables on single line
- Or set in Netlify Dashboard instead of netlify.toml

---

### 7. TypeScript Import Order
**Rule**: Follow this order:
1. React imports (useState, useEffect)
2. External libraries (clsx, swr)
3. Internal @/lib imports
4. Local imports

---

### 8. Switch Case Scope
**Issue**: Variable hoisting between switch cases

**Solution**: Always use block scope `{}`:
```typescript
switch (type) {
  case "alerts": {
    const alerts = await getAlerts();
    return NextResponse.json(alerts);
  }
  default: {
    return NextResponse.json({ error: "Unknown type" });
  }
}
```

---

### 9. Prisma Bulk Updates & Accelerate Limits
**Issue**: `ECONNREFUSED` errors or `P2002` constraint errors combined with dropped connections during `npx prisma db seed` or large data inserts when using Prisma Accelerate.
**Root Cause**: Iterating large arrays and calling `prisma.model.create()` or `upsert()` inside a loop exhausts the connection pool and rate limits of remote databases like Prisma Accelerate.
**Solution**: Always use `createMany({ skipDuplicates: true })` in batches (e.g., 500 records) instead of looping singular insert operations.

---

### 10. NextAuth Ghost Sessions & Custom Routes
**Issue**: User signs out but immediately appears signed back in because a ghost session persists.
**Root Cause**: Manual overrides of auth routes (like a custom `app/api/auth/session/route.ts`) conflict with NextAuth's internal lifecycle. Also, old cookies might stick around if domain/path configs drift.
**Solution**: 
- NEVER create custom routes overlapping with `[...nextauth]` functionality unless absolutely necessary.
- If sessions are stubbornly stuck, change the `sessionToken` cookie name in `auth.config.ts` to nuke all existing client sessions and force a clean slate.

---

### 11. Dynamic Directory Creation & Permissions
**Issue**: Background tasks failing to write logs in restricted environments (e.g., .next folder).
**Root Cause**: Sub-processes or monitoring servers may lack write/read access to dynamically created directories.
**Solution**: 
- Create directories with explicit octal permissions: `fs.mkdirSync(path, { recursive: true, mode: 0o777 })`.
- Use `fs.chmodSync(path, 0o777)` after creation to ensure permissions are applied regardless of umask.
- Always provide a local fallback (e.g., `process.cwd() + "/worker_logs"`) if the target path is non-writable.

---

### 12. Prisma v7 Casing Handling
**Issue**: Prisma client generated with idiosyncratic casing (e.g., `aPIRequestLog` or `workerTask` missing from types) causes lint errors or runtime crashes.
**Root Cause**: Prisma's name normalization can sometimes mismatch the developer's expectations or schema casing in complex setups.
**Solution**: Use `(prisma as any)` to access models that are throwing type errors, while ensuring the underlying runtime property name is correct.
```typescript
// ✅ Fixes lint errors for custom cased models
await (prisma as any).aPIRequestLog.create({ ... });
```

---

### 13. Persistent Logging on Serverless (Netlify Blobs)
**Issue**: `/tmp` and local file systems in Netlify/Vercel are ephemeral; logs are wiped after every execution or deployment.
**Root Cause**: Local file system writes don't persist in serverless environments.
**Solution**: Use cloud-native storage like **Netlify Blobs** or **S3** for persistent log files.
- Convert logging utilities to `async` functions and **ALWAYS await them** in API routes and worker logic.
- **Handling Netlify Blob Data Types**: When reading from Netlify Blobs using `store.get`, always specify `{ type: 'text' }` if a string is expected, otherwise it returns an `ArrayBuffer`.
- **Duplicate Key Errors in Request Logging**: When logging API requests that have multiple lifecycle states (e.g., pending -> success/error), use `prisma.upsert` with a unique ID (like `requestId`) instead of `prisma.create` to avoid `P2002` unique constraint violations on status updates.
- **Serverless File Logging Warnings**: On serverless platforms like Netlify, file logging is typically disabled. Suppress noisy warnings by detecting `process.env.NETLIFY` or `process.env.AWS_LAMBDA_FUNCTION_NAME`.
- Check environment at runtime: `process.env.NETLIFY === 'true'`.
- Implement a fallback to local logging for development environments.

### 13b. Database-Backed Logging (v1.10.4)
**Issue**: Netlify Blobs require special SDK and configuration; not always available.
**Solution**: Use database-backed logging as the most reliable fallback:
```typescript
// lib/services/db-logger.ts
export async function logToDb(entry: LogEntry): Promise<void> {
  try {
    await prisma.serverLog.create({ data: entry });
  } catch (error) {
    // Fallback to console if DB fails
    console.error(`[${entry.level.toUpperCase()}] ${entry.message}`);
  }
}
```
- Works on ANY platform (local, Netlify, Vercel, AWS Lambda)
- Use Prisma Accelerate for serverless databases
- Add indexes on frequently queried fields (level, source, taskId, createdAt)
- Implement automatic cleanup with `deleteMany` for retention policy

---

### 14. Dependency Minimization for UI Helpers
**Rule**: Avoid heavy libraries like `date-fns` for simple, repetitive UI tasks like "time ago" formatting.
**Solution**: Use a native JavaScript helper function. This reduces bundle size and avoids dependency overhead.
```typescript
// Example helper
export function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
  // ... calc intervals ...
  return `${interval} ${unit} ago`;
}
```

---

### 15. Role-Based Access Control (RBAC) & Middleware (v1.9.2)
**Rule**: Always wrap middleware with `auth` from `@/lib/auth` if you need to check session/roles for routing.
**Solution**:
```typescript
// middleware.ts
export default auth((req) => {
  const role = req.auth?.user?.role;
  const isProtected = req.nextUrl.pathname.startsWith('/admin') || req.nextUrl.pathname.startsWith('/users');
  
  if (isProtected && role !== 'ADMIN') {
    return NextResponse.redirect(new URL('/auth/signin', req.url));
  }
  // ... other logic ...
});
```

---

### 16. Next.js 15+ Async Params (v1.10.0)
**Rule**: In Next.js 15+, dynamic route params are now Promises, not synchronous objects.
**Solution**: Always use async params:
```typescript
// ❌ Wrong - synchronous params (Next.js 14)
export async function POST(
    request: Request,
    { params }: { params: { id: string } }
) {
    const { id } = params; // Direct access
}

// ✅ Correct - async params (Next.js 15+)
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params; // Await the promise
}
```

---

### 17. Zod v4 Error Handling (v1.10.0)
**Rule**: In Zod v4, access validation errors via `error.issues` not `error.errors`.
**Solution**:
```typescript
// ❌ Wrong - Zod v3 syntax
if (error instanceof z.ZodError) {
    return NextResponse.json({ error: error.errors[0].message }, { status: 400 });
}

// ✅ Correct - Zod v4 syntax
if (error instanceof z.ZodError) {
    return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
}
```

---

### 18. Secure Onboarding (Join Requests) (v1.9.2)
**Rule**: Avoid direct user signup in production for high-security applications. Use a request-approval workflow.
**Solution**:
- Prospective users submit a `JoinRequest`.
- Admins review and approve the request.
- The system generates a temporary password and creates the user account only after approval.
- Delete any legacy direct creation routes (e.g., `/users/new`).

---

### 19. Prisma Unique Constraints & Deduplication (v1.10.1)
**Rule**: When syncing data, ALWAYS match the deduplication logic to the schema's unique constraint.
**Problem**: Corporate actions showed duplicates because code checked `symbol + exDate` but schema had `@@unique([symbol, actionType, exDate])`.
**Solution**:
1. Check the schema's unique constraints before implementing deduplication
2. Use `upsert` with the exact field combination from the unique constraint
3. Normalize dates to UTC noon to avoid timezone mismatches:
   ```typescript
   // ❌ Wrong - timezone issues
   new Date(parseInt(yr), month, parseInt(dd))
   
   // ✅ Correct - UTC noon
   new Date(Date.UTC(parseInt(yr), month, parseInt(dd), 12, 0, 0, 0))
   ```
4. Use atomic `upsert` operations instead of find + create/update to avoid race conditions:
   ```typescript
   // ❌ Wrong - race condition possible
   const existing = await prisma.model.findFirst({ where: { ... } });
   if (existing) await prisma.model.update(...);
   else await prisma.model.create(...);
   
   // ✅ Correct - atomic operation
   await prisma.model.upsert({
     where: { field1_field2_field3: { field1, field2, field3 } },
     update: { ... },
     create: { ... }
   });
   ```

---

### 20. Type Checking Before Method Calls (v1.10.2)
**Rule**: Always verify the type of a variable before calling string/object methods on it.
**Problem**: `indexName.replace is not a function` error occurred because `indexName` was truthy but not a string.
**Solution**:
```typescript
// ❌ Wrong - only checks truthiness
if (indexName) {
  return indexName.replace(...); // Error if indexName is number/object
}

// ✅ Correct - explicitly check the type
if (typeof indexName === 'string' && indexName.length > 0) {
  return indexName.replace(...); // Safe
}
```
**Also apply this to**:
- `.split()`, `.join()`, `.map()`, `.filter()`, etc. on union types
- Any method call on a variable that could be `unknown` or union type

---

### 21. MANDATORY Documentation Updates (v1.10.1) ⚠️
**Rule**: Documentation MUST be updated IMMEDIATELY after completing any implementation. This is NOT optional.
**Why**: Without proper documentation, future agents cannot understand what was done, why changes were made, or what files were modified. The project loses institutional knowledge.

**Files to Update After Every Change**:

| File | When to Update | What to Add |
|------|---------------|-------------|
| `AGENTS.md` | Every change | Add version entry, detailed change description, files changed |
| `Primer.md` | Every change | Add to "Current Project Status" section |
| `agent-memory.md` | Every change | Add detailed activity log entry |
| `Lessons.md` | Bugs/patterns | Add new lesson if new pattern discovered |
| `README.md` | Major features | Update feature list, commands, or tech stack |

**MANDATORY Checklist - Do This BEFORE Finishing ANY Task**:

```markdown
- [ ] Implementation complete (code written, tested, builds pass)
- [ ] AGENTS.md updated:
      - [ ] Added entry to "Version History" (top of file)
      - [ ] Added detailed section under "New Features" or "Bug Fixes"
      - [ ] Listed all files changed
      - [ ] Explained root cause (for bugs) or feature (for new features)
- [ ] Primer.md updated:
      - [ ] Added to "Current Project Status" with issue/fix/status
      - [ ] Added to "Session History"
- [ ] agent-memory.md updated:
      - [ ] Added detailed activity log entry with files
- [ ] Lessons.md updated (if new pattern/bug discovered):
      - [ ] Added new lesson with problem/solution
      - [ ] Updated "Last Updated" and "Update Log"
```

**What This Looks Like in Practice**:

1. **Bug Fix**: After fixing a bug, immediately add:
   - Root cause analysis
   - Solution explanation  
   - Files that were changed
   - SQL scripts if database cleanup needed

2. **New Feature**: After adding a feature, immediately add:
   - Feature description
   - How it works
   - API endpoints (if any)
   - Files created/modified

3. **Refactoring**: After refactoring, immediately add:
   - Why the refactoring was needed
   - What changed
   - Files affected

**Enforcement**: 
- The `Before Every Commit Checklist` in this file explicitly requires documentation updates
- Agents MUST NOT skip documentation - it is part of completing the task
- If you forget, the user will need to remind you - don't let it get to that point!

---

### 23. Path Traversal Prevention (v1.10.6)
**Issue**: CodeQL security warning - uncontrolled data used in path expression.

**Problem**: User-controlled values (like taskId) used directly in filesystem paths without validation.

**Solution**: Sanitize all user inputs before using in filesystem operations:
```typescript
const sanitizeTaskIdForPath = (taskId: string): string | null => {
  const trimmed = taskId.trim();
  if (!trimmed || trimmed.length > 128) return null;
  
  // Allow only safe filename characters
  const safePattern = /^[A-Za-z0-9_\-:.]+$/;
  if (!safePattern.test(trimmed)) return null;
  
  return trimmed;
};
```

**Usage**:
```typescript
// Before (UNSAFE)
const logFile = path.join(logsDir, `${taskId}.log`);

// After (SAFE)
const safeTaskId = sanitizeTaskIdForPath(taskId);
if (!safeTaskId) return; // Skip for invalid IDs
const logFile = path.join(logsDir, `${safeTaskId}.log`);
```

**Key Points**:
- Reject path separators (`/`, `\`) and traversal (`..`)
- Limit length to prevent buffer overflow attacks
- Always validate BEFORE constructing the path

---

### 22. NSE API Field Name Casing (v1.10.5)
**Issue**: Corporate actions sync saved all records as "OTHER" type because field names didn't match.

**Root Cause**: NSE India API returns lowercase field names, not uppercase:
- `symbol`, `subject`, `comp`, `series`, `faceVal`, `exDate`, `recDate`

**Solution**: Always check actual API response before mapping fields:
```bash
# Always verify field names by checking actual API response
curl -s "https://www.nseindia.com/api/endpoint" | node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync(0,'utf-8'))[0]))"
```

**Safe Field Mapping Pattern**:
```typescript
// Check BOTH uppercase and lowercase versions
const purpose = item.PURPOSE || item.purpose || item.subject || '';
const companyName = item['COMPANY NAME'] || item.companyName || item.comp || '';
const recordDate = item['RECORD DATE'] || item.recordDate || item.recDate || "";
const faceValue = item['FACE VALUE'] || item.faceValue || item.fv || item.faceVal || null;
```

**Lesson**: Never assume API field casing. Always verify with actual API response.

---

## Before Every Commit Checklist

- [ ] Read Lessons.md
- [ ] Apply all relevant rules
- [ ] Check middleware doesn't use NextAuth (for Netlify)
- [ ] Verify Prisma configuration (accelerateUrl vs adapter)
- [ ] Verify dependencies in package.json
- [ ] Test build locally (`npm run quickbuild`)
- [ ] Check for console.log in critical paths (debugging)
- [ ] **MANDATORY: Update ALL documentation files**:
      - [ ] **AGENTS.md** - Version history + detailed change section
      - [ ] **Primer.md** - Current status + session history
      - [ ] **agent-memory.md** - Activity log entry
      - [ ] **Lessons.md** - New lesson if new pattern discovered
- [ ] If documentation is NOT updated → DO NOT COMMIT until it is

---

## Common Mistakes to Avoid

1. ❌ Using NextAuth in middleware on Netlify (causes 502)
2. ❌ Using `accelerateUrl` without Prisma Accelerate
3. ❌ Putting type packages in devDependencies for Next.js apps
4. ❌ Setting USE_REMOTE_DB=true without proper remote DB URL
5. ❌ Using localhost in DATABASE_URL for production
6. ❌ Conditional console.log that skips production
7. ❌ TOML multi-line environment variables

---

## Debugging 502 on Netlify

1. **Check build logs** - Do you see Prisma initializing correctly?
2. **Check function logs** - Runtime logs show actual errors
3. **Test without middleware** - Rename middleware.ts temporarily
4. **Verify DATABASE_URL** - Check it's set correctly in Netlify Dashboard

---

## Last Updated
2026-03-20 23:30

## Update Log
- 2026-03-20: Added lesson 23 (Path Traversal Prevention) - sanitize user inputs in file paths
- 2026-03-20: Added lesson 22 (NSE API Field Casing) - NSE uses lowercase fields
- 2026-03-20: Added lesson 13b (Database-Backed Logging) for serverless platforms
- 2026-03-20: Added lesson 20 (Type Checking Before Method Calls)
- 2026-03-20: Added lesson 21 (MANDATORY Documentation Updates) and updated commit checklist
- 2026-03-20: Added lesson 19 (Prisma Unique Constraints & Deduplication)
- 2026-03-18: Added v1.9.1 lessons (Prisma casing, Netlify Blobs, Dependency minimization)
- 2026-03-16: Added middleware rules (main 502 cause discovered)
- 2026-03-16: Initial rules added based on Netlify 502 fix
