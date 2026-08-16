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
- [ ] Git hooks don't write to tracked files (check post-commit, pre-commit)
- [ ] Verify Prisma configuration (accelerateUrl vs adapter)
- [ ] Verify dependencies in package.json
- [ ] Test build locally (`npm run quickbuild`)
- [ ] Check for console.log in critical paths (debugging)
- [ ] **CODE HYGIENE: Clean up artifacts before commit**:
      - [ ] Run `git status` — review ALL untracked and modified files
      - [ ] Delete junk artifacts: Playwright snapshots (`*.yaml`), screenshots, temp logs
      - [ ] Verify `.gitignore` covers common artifact patterns (`.yaml`, `.log`, `test-results/`)
      - [ ] Ensure no dead code, commented-out code, or debug `console.log` statements
      - [ ] Check no secrets/tokens/passwords appear in the diff
      - [ ] Review diff size — if unexpectedly large, investigate each file
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
2026-08-16 (v3.12.0 — Lessons 78-80 added)

## Advanced Screener Lessons (v1.16.0)

### Handoff File Protocol
**Rule**: Always use the handoff file system for session context preservation.

**Problem**: Without standardized handoff files, agent sessions lose context on restart, preventing multi-agent collaboration and self-improvement.

**Solution**:
```yaml
# Required YAML frontmatter for all handoff files
---
handoff_version: "1.0"
session_id: "sess-YYYYMMDD-HHMMSS"
agent: "agent-type"
timestamp: "2026-07-16T10:30:00Z"
status: "in_progress"
priority: "high"
---
```

### Session Start Protocol
**Rule**: Every agent MUST read these files in order at session start:
1. `HANDOFF.md` - Current orchestration state
2. `.agents/handoffs/active/latest.md` - Current handoff context
3. `Primer.md` - Project status
4. `Lessons.md` - Rules and corrections

**Why**: Ensures that agents work with complete context even after session restarts or agent switches.

### Agent Pipeline Protocol
**Rule**: Use the defined agent pipeline for complex workflows:
- GH Helper → Integrator → QA → DevOps
- Observability runs cross-cutting at any stage

**Why**: Each agent has specialized tools and focus. The pipeline ensures quality gates at each step.

### Advanced Screener Lessons (v1.16.0)

**Chartink Architecture**: Chartink is a TradingView wrapper — `POST /screener/process` with DSL like `( {cash} ( market cap > 10000 ) )`, returns DataTables format. Our direct TV integration is architecturally superior: no middleman, no session cookies, no ToS concerns.

**FilterBuilder Type Safety**: `ConditionValue` is a union type; use `as any` on the full condition object in helper functions rather than fighting TypeScript union narrowing.

**Dev Server Management**: Use `start /B cmd /c "npx next dev -p 3000" > next-dev.log 2>&1` from cmd.exe to background the process. Never run long-lived processes in the main agent shell.

**Multi-Value Input**: For "in"/"not_in" operators, use comma-separated text with onBlur commit to array. Split, trim, filter empty. Simplest UX for list operators.

**Backtest Scope**: Backtest runs per-symbol against DailyPrice data, not a full scan set. UI flow: scan → select stock → backtest.

### Playwright Snapshot Cleanup & Code Hygiene (v1.16.0)

**Issue**: Playwright CLI `snapshot` command dumps `.yaml` files in the current working directory by default. These are artifacts, NOT source code, and must not be committed.

**Root Cause**: Calling `npx playwright-cli snapshot` without `--filename=` flag creates timestamped `.yaml` files in the root directory. These files are not covered by `.gitignore` and show up as untracked.

**Solution**:
1. **Always use `--filename=` flag** with a path inside a temp/ignored directory:
   ```bash
   npx playwright-cli snapshot --filename=.playwright-cli/snapshots/test-1.yaml
   ```
2. **If snapshots end up in root**, delete them immediately:
   ```bash
   del /f /q *.yaml
   ```
3. **Before committing, always run `git status`** to check for:
   - Junk artifact files (`.yaml`, `.png`, `.log`, etc.)
   - Unexpected untracked files
   - Stale build artifacts

**Code Hygiene Checklist Before Commit**:
```markdown
- [ ] Run `git status` — review all untracked and modified files
- [ ] Delete junk artifacts: Playwright snapshots (*.yaml), screenshots, temp logs
- [ ] Verify `.gitignore` covers common artifact patterns
- [ ] Ensure no dead code, commented-out code, or console.log statements remain
- [ ] Check no secrets/tokens/passwords in the diff
- [ ] Review diff line count — if unexpectedly large, investigate
```

**Why This Matters**:
- Junk files in git history bloat the repository forever
- Playwright snapshots contain volatile element IDs that change on every run
- Clean diffs make code review faster and more reliable
- Future agents trust the repository state — don't pollute it

### Self-Learning Loop
**Rule**: After every significant session, run `/self-learn` to extract patterns.

**What to Extract**:
- **Good Patterns**: Things that worked well → promote to practices
- **Anti-Patterns**: Things that failed → add to Lessons.md
- **Metrics**: Build success rate, test pass rate, time to first commit

### Pre-Commit Secrets Detection
**Issue**: Hardcoded credentials may leak to git history
**Solution**: Pre-commit hook checks staged changes for:
- `password`, `secret`, `api_key`, `auth_token` followed by long string values
- Rejects commit if potential secrets found
- Also warns about `console.log` statements

### Git Hooks Must NOT Modify Tracked Files ⚠️
**Issue**: Post-commit hook writing to `agent-memory.md` and `latest.md` (tracked files) created an infinite loop:
1. Commit → hook appends to tracked files → unstaged changes appear
2. Those get committed → hook runs again → infinite loop
3. Result: 2 auto-generated noise commits (`bb83e21`, `65ccaac`)

**Solution**: Git hooks must ONLY write to NON-TRACKED files:
```bash
# ✅ CORRECT - write to gitignored file
echo "checkpoint" >> .agents/handoffs/checkpoint.log  # *.log is in .gitignore

# ❌ WRONG - modifies tracked files, creates infinite loop
echo "checkpoint" >> agent-memory.md     # tracked!
echo "checkpoint" >> latest.md           # tracked!
```

**Rule**: Before any git hook writes to a file, verify it's gitignored:
```bash
git check-ignore <file>  # Returns filename if ignored, empty if tracked
```

**Also**: Pre-commit hook had a minor shell bug where `grep -c` output `"0\n0"` (two lines) instead of just `0` on some systems. Fixed by using simpler integer comparison.

## SEO & Analytics Implementation (v1.11.0)

### Google Analytics 4 Setup
1. Install `@next/third-parties` package
2. Create `app/components/analytics/GoogleAnalytics.tsx` - validates GA ID format before rendering
3. Add `NEXT_PUBLIC_GA_ID=G-XXXXXXXXXX` to environment variables
4. Import and add `<Analytics />` component in root layout

### SEO Best Practices
1. **Use Metadata API** - Next.js 16's built-in metadata beats manual `<head>` tags
2. **Create metadata.ts files** for each route with title, description, keywords
3. **JSON-LD Schemas** - Add structured data for Organization, WebSite, WebPage
4. **Generate sitemap dynamically** - Include all public pages, exclude `/api/*`, `/admin/*`
5. **robots.txt** - Configure crawlers with specific rules for Googlebot, Bingbot

### Security Considerations
- **Only use `NEXT_PUBLIC_` prefix** for client-side variables (GA ID is NOT a secret)
- **Sanitize all event tracking inputs** - prevent XSS in analytics data
- **Validate GA ID format** - reject invalid IDs before rendering
- **Never track PII** - don't pass user emails, names, or personal data to analytics

### Custom Event Tracking Pattern
```typescript
// Sanitize and validate before tracking
export function trackEvent(action: string, category: string, options?: { label?: string; value?: number }) {
  if (typeof window === "undefined" || !window.gtag) return;
  
  // Sanitize inputs
  const sanitizedAction = action.replace(/<[^>]*>/g, "").slice(0, 50);
  
  window.gtag("event", sanitizedAction, {
    event_category: category,
    event_label: options?.label,
    value: options?.value,
  });
}
```

---

### 24. Dev Server Startup — Avoid Blocking the LLM (v3.2.0, updated v3.3.1)
**Issue**: Running `npm run dev` in a shell via `start /B` or `Start-Process -NoNewWindow` blocks the LLM tool call, preventing further operations.

**Root Cause**: The shell tool waits for the process to exit. Even background processes that redirect output can hold the shell open if not properly detached. `start /B cmd /C "npm run dev > file.log 2>&1"` still blocks because Next.js keeps file handles open.

**Solution (v3.3.1 — Recommended)**: Use PowerShell `System.Diagnostics.ProcessStartInfo` with `CreateNoWindow = $true`:
```powershell
# scripts/start-dev-bg.ps1
$psi = New-Object System.Diagnostics.ProcessStartInfo;
$psi.FileName = 'cmd.exe';
$psi.Arguments = '/c cd /d <PROJECT_DIR> && npm run dev > <PROJECT_DIR>\dev-server.log 2>&1';
$psi.UseShellExecute = $false;
$psi.CreateNoWindow = $true;
$psi.RedirectStandardOutput = $false;
$psi.RedirectStandardError = $false;
$p = [System.Diagnostics.Process]::Start($psi);
Write-Output $p.Id
```
This returns immediately with the PID, and the dev server runs independently.

**npm script**: `"dev:bg": "powershell -ExecutionPolicy Bypass -File scripts/start-dev-bg.ps1"`

**Cleanup**: Kill the process when done:
```bash
taskkill /PID <PID> /F
```

### 25. Client-Server Separation — Extracting Types from Service Files (v3.2.0, recurred v3.6.4)
**Issue**: Build fails with `Module not found: Can't resolve 'dns'` or `pg` when client components import from service files that import Prisma.

**Root Cause**: Next.js client bundle attempts to resolve ALL VALUE imports from a client component, including Node.js built-in modules and database drivers used by services. `import type { … }` is erased at compile and is safe; a VALUE import of even one pure function from a service file pulls the service's entire top-level import graph into the browser bundle.

**Solution**: Extract the shared pure helpers/types/constants into a separate file that has ZERO server-side imports (both `rebalancerTypes.ts` and `ipoIssueSize.ts` follow this pattern):
```typescript
// lib/services/ipoIssueSize.ts — Client-safe pure helpers (zero imports)
export function formatIssueSize(...) { ... }

// lib/services/nseIpoService.ts — Server-only logic (imports prisma chain)
import { formatIssueSize } from "@/lib/services/ipoIssueSize";
export { formatIssueSize } from "@/lib/services/ipoIssueSize"; // re-export keeps server callers/tests unchanged
```

**Key Rules**:
1. Client components ONLY value-import from the `*Types.ts`/pure helper file; `import type { … }` from service files is fine (erased at compile)
2. Server API routes import from the main service file
3. NEVER import Prisma, database adapters, or Node.js modules in files that client components value-import
4. Check all client component imports of a service file when introducing a new one
5. Symptom signature: `Module not found: Can't resolve 'dns'` + import trace ending in a `.tsx` Client Component — grep that component's value imports immediately

## Lessons from Daily Recommendations Implementation (v3.3.0)

### 26. Hybrid API Fallback Pattern
**Issue**: External APIs (Chartink) may be unreliable or have rate limits.
**Solution**: Always implement fallback to equivalent data source.
**Example**: Try Chartink `POST /screener/process` first, fall back to TradingView screener templates with equivalent filters.
**Trade-off**: More code to maintain, but significantly higher reliability.

### 27. AI Batch Processing for Token Limits
**Issue**: Processing many stocks in a single AI call exceeds token limits.
**Solution**: Process in batches of 5 stocks, accumulate results, handle partial failures gracefully.
**Pattern**: 
```typescript
for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
  const batch = stocks.slice(i, i + BATCH_SIZE);
  try { const results = await analyzeBatch(batch); allResults.push(...results); }
  catch (e) { logger.warn({ msg: 'Batch failed', batchIndex: i/BATCH_SIZE }); }
}
```

### 28. Cron Job Timezone Handling
**Issue**: Cron expressions in UTC cause confusion for IST-based schedules.
**Solution**: Always document timezone in comments and use UTC offset with clear mapping:
- 10 AM IST = 04:30 UTC
- 3:30 PM IST = 10:00 UTC

### 29. Public vs Authenticated API Routes
**Issue**: Some routes need auth, others don't, but NextAuth middleware can't distinguish easily.
**Solution**: Define auth at the route handler level, not middleware:
```typescript
// Public route - no auth check
export async function GET() { return NextResponse.json(data); }
// Protected route - explicit auth check
export async function GET() { const session = await auth(); if (!session) return 401; }
```

### 30. Tracker Entity Pattern
**Issue**: Recommendation status needs to be tracked over time (active → target_achieved / stop_loss_hit / expired).
**Solution**: Use separate `RecommendationTracker` (long-lived) + `DailyRecommendationStock` (per-run) + `RecommendationStatusHistory` (audit trail). Don't cram status into a single model.

### 31. Circuit Breaker for External Services
**Issue**: AI provider failures cascade and block entire system.
**Solution**: Implement circuit breaker with 3 states (CLOSED → OPEN → HALF_OPEN), auto-recovery after cooldown period.
**Pattern**: Track failure count, reset on success, open circuit at threshold (3 failures), close after successful half-open probe.

### 32. Unified Event Model for Audit
**Issue**: Multiple event types (Telegram, AI, screener, system health) scattered across different models.
**Solution**: Create single `UnifiedEvent` model with `eventType` discriminator. Easier to query, paginate, and detect anomalies across all event types.

### 33. Prediction Accuracy Tracking
**Issue**: No way to measure if AI recommendations are actually good.
**Solution**: Track entry price vs current price after 1 week, 1 month, 3 months. Classify as win (>5%), breakeven (±5%), loss (>5% negative). Calculate overall accuracy and trigger prompt adjustment when accuracy drops below 40%.

### 34. Prompt Versioning with Auto-Adjustment
**Issue**: AI prompts degrade over time as market conditions change.
**Solution**: Version every prompt, track accuracy per version, auto-adjust when: (a) accuracy drops below 40%, (b) consecutive losses exceed 5, (c) 30 days have passed since last adjustment. Fall back to previous version if new version performs worse.

### 35. Screener Deduplication by Symbol
**Issue**: Multiple screeners returning same stock causes duplicates in recommendations.
**Solution**: Deduplicate by symbol, track which screeners found each stock (screenerAttribution), sort by screenerCount (more screeners = stronger signal).

### 36. SWC + jest.mock() — TDZ Pattern for Complex Mocks ⚠️
**Issue**: `import { jest } from "@jest/globals"` prevents SWC from hoisting `jest.mock()` calls. Also, complex mock objects (with Prisma) cause TDZ ReferenceError because SWC hoists the `jest.mock()` call ABOVE the `const` declaration.
**Root Cause**: SWC transformer hoists `jest.mock()` to top of file, but `const` variables are in temporal dead zone until their declaration line.
**Solution**: Define mock objects INSIDE the `jest.mock()` factory function (which runs at import time), then retrieve them via `require()` after imports:
```typescript
jest.mock("@/lib/prisma", () => {
  const mockPrisma = {
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    // ... other methods
  };
  return { __esModule: true, default: mockPrisma };
});

// After all imports:
const prisma = require("@/lib/prisma").default;
beforeEach(() => {
  prisma.user.findUnique.mockResolvedValue(null);
});
```
**Key Rules**:
1. NEVER use `import { jest } from "@jest/globals"` — use global `jest`
2. Complex mocks (Prisma, services) MUST be defined inside factory
3. Retrieve via `require()` after imports for `beforeEach` reset
4. Always add `{ __esModule: true }` for default exports

### 37. CodeQL Modulo Bias in Random Code Generation
**Issue**: `crypto.randomBytes(4).readUInt32BE(0) % 1000000` has modulo bias because 2^32 is not evenly divisible by 1000000.
**Impact**: Some 6-digit codes are slightly more probable than others (high-severity CodeQL alert).
**Solution**: Use `crypto.randomInt(1000000)` — cryptographically secure, no modulo bias, cleaner code.
**Alternative**: `Math.floor(Math.random() * 1000000).toString().padStart(6, '0')` for non-crypto contexts.

### 38. AI Response Parsing — Symbol Matching Priority
**Issue**: `parseAIResponse` in recommendation-agent.ts used `parsed[idx] || symbolMatch`, so when AI returns results in different order than input, symbol matching was deprioritized.
**Root Cause**: AI models (especially smaller ones) may return BUY/HOLD/SELL in arbitrary order, not matching input stock order.
**Solution**: Swap to `symbolMatch || parsed[idx]` — symbol matching is ALWAYS prioritized over positional matching.
**Lesson**: When parsing AI responses, never assume order matches input. Always match by content (symbol name) first.

### 39. Retry Mock Count Must Match RETRY_MAX
**Issue**: Test for batch retry failure only provided 1 `mockRejectedValueOnce()` but RETRY_MAX=2, so batch actually succeeded after first retry.
**Root Cause**: With RETRY_MAX=2, a batch fails twice before giving up. Need exactly 2 rejection mocks.
**Solution**: Match mock count to retry configuration:
```typescript
for (let i = 0; i < BATCHES; i++) {
  mockReject(2); // RETRY_MAX = 2
}
```
**Rule**: Always check retry configuration before writing retry failure tests.

---

### 40. Production Build Must Include Prisma Migrate Deploy
**Issue**: Netlify build used `quickbuild` (`next build`) which only generates the Prisma client but never applies schema migrations to the database. Production had 29 missing tables from v3.3.0, causing 500 errors on `/api/recommendations` and empty pages.
**Root Cause**: `netlify.toml` build command was `npx prisma generate && npm run quickbuild`. The `quickbuild` script was introduced for faster local builds but was accidentally used in production.
**Solution**: Use `npm run build` which runs `npx prisma migrate deploy && next build`.
**Rule**: **NEVER** use `quickbuild` in production build configs. Always ensure `prisma migrate deploy` runs before `next build` in any production/deployment pipeline.
**Pattern**:
```toml
# netlify.toml
[build]
  command = "npm run build"  # ✅ runs migrate deploy + next build
  # command = "npm run quickbuild"  # ❌ skips migrations!
```

---

### 41. Prisma @@map Table Names vs Model Names in Raw SQL
**Issue**: Raw SQL queries used model names (`daily_recommendation_runs`, `daily_recommendation_stocks`) but Prisma `@@map` renames them to different table names (`daily_recommendation_runs` → `daily_recommendation_runs` BUT `RecommendationTracker` → `recommendation_trackers`, `DailyRecommendationStock` → `daily_recommendation_stocks`).
**Root Cause**: Prisma model names and DB table names diverge when `@@map` is used. Prisma Client uses the model name, but raw SQL must use the actual DB table name from `@@map`.
**Solution**: Always check `prisma/schema.prisma` for `@@map()` directives before writing raw SQL. The pattern is:
```prisma
model DailyRecommendationStock {  // ← Prisma model name
  @@map("daily_recommendation_stocks")  // ← Actual DB table name
}
```
**Rule**: Raw SQL = `@@map` name. Prisma Client = model name. Never assume they match.

### 42. Prisma Column Naming — camelCase vs snake_case
**Issue**: Raw SQL queries used `trade_date` but the actual column in the DB is `"tradeDate"` (camelCase). Caused 500 errors on dividend calendar and corporate actions endpoints.
**Root Cause**: Prisma preserves the TypeScript field name as the column name by default. When the Prisma field is `tradeDate Date @map("tradeDate")`, the DB column is `"tradeDate"` (with quotes for camelCase). Raw SQL must use the exact column name including case.
**Solution**: Check the Prisma migration files or `prisma db pull` output for exact column names. When Prisma uses camelCase, raw SQL must quote it: `"tradeDate"`, not `trade_date`.
**Rule**: Before writing raw SQL against a Prisma-managed table, always verify exact column names from migration files or schema introspection.

### 43. AI Admin Test — Use directPrompt() Not Full Agent
**Issue**: AI admin "Test Connection" button called `/api/ai/screener` which runs the full agent pipeline with tools (DB writes, stock fetching). Connection test should be lightweight.
**Solution**: Create a dedicated `/api/admin/ai/test` endpoint that uses `directPrompt()` from `llm-provider.ts` — sends a simple "Say hello" message with DB-saved config. Returns `{ success, response, model, elapsed }`.
**Pattern**: For config test endpoints, always use the simplest possible prompt and skip all tool execution. Save DB writes for actual production runs.

### 44. Telegram Bot Webhook vs Local Database Mismatch
**Issue**: User links Chat ID on local dev server, but Telegram bot webhook hits production server — bot responds "Account not linked" because production DB has no record.

**Root Cause**: User linked Chat ID on `localhost:3000` (local PostgreSQL), but Telegram webhook was set to `tradenext6.netlify.app/api/telegram/webhook` (production Prisma Accelerate DB). Different databases = missing record.

**Solution**: Either (a) set webhook to local via tunnel (`ngrok http 3000`), or (b) re-link Chat ID on the production site so both databases have the record.

**Diagnostic Query**: To verify linking, query the User table for `telegramChatId`:
```typescript
await prisma.user.findMany({
  where: { telegramChatId: { not: null } },
  select: { id: true, name: true, email: true, telegramChatId: true, telegramVerified: true }
});
```

**Rule**: When testing Telegram bot locally, always verify which database the webhook is hitting. Use `ngrok` or similar tunnel for local webhook testing.

### 45. Prisma 7 Requires Adapter for External Scripts
**Issue**: Creating a `PrismaClient` without adapter in a standalone script fails with `PrismaClientInitializationError`.

**Root Cause**: Prisma 7 with driver adapters (e.g., `@prisma/adapter-pg`) requires the adapter to be passed during construction. Plain `new PrismaClient()` doesn't work when the project uses `PrismaPg` adapter.

**Solution**: For standalone scripts, always create a Pool + PrismaPg adapter:
```typescript
const { PrismaClient } = require('.prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = new PrismaClient({ adapter: new PrismaPg(pool) });
```

### 46. Prisma Interactive $transaction Expires in Serverless (5000ms) — Use runInChunks
**Issue**: Prod daily recommendation run failed with `Transaction API error: A rollback cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms, however 5501 ms passed`. The run took ~50s (AI batches of 5, RETRY_MAX=2) so the interactive `$transaction` exceeded the 5s Prisma limit.

**Root Cause**: Interactive `$transaction` (callback form) in Prisma has a 5000ms default timeout in serverless (Prisma Accelerate) environments. Long-running batch pipelines — screeners → dedup → AI analysis → DB writes — exceed this.

**Solution**: Replace interactive `$transaction` with a `runInChunks()` bounded-concurrency helper — sequential chunks with configurable batch size, each chunk awaited individually so no single DB call blocks a transaction:
```typescript
async function runInChunks<T>(items: T[], batchSize: number, fn: (chunk: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += batchSize) {
    await fn(items.slice(i, i + batchSize)); // each chunk is its own operation
  }
}
```
Also fire-and-forget non-critical writes (predictions/events) with `.catch()` so a slow DB write never blocks the run.

**Rule**: Any long-running multi-step DB pipeline must use chunked sequential writes, never one interactive `$transaction` that can exceed the serverless 5s limit.

### 47. Cache Invalidation After Background Price/Status Updates
**Issue**: Telegram daily recommendations stayed stale (showed old prices/statuses) for up to 23h even though `checkRecommendationPerformance()` updated tracker prices at the 3:30 PM IST cron.

**Root Cause**: The `recommendationsCache` NodeCache has a 23h TTL. The performance check updated the DB but never invalidated the cache (`LATEST_KEY`), so every read (`getLatestRecommendations`, Telegram handlers) returned cached data.

**Solution**: Any background job that mutates data behind a long-TTL cache MUST invalidate that cache when done:
```typescript
export async function checkRecommendationPerformance() {
  // ... update trackers ...
  invalidateRecommendationsCache(); // ← critical
}
```

**Rule**: Cache invalidation is part of the write path, not an afterthought. If a cron/worker mutates cached entities, invalidate the relevant cache keys at the end of the mutation.

### 48. GitHub Wiki Is Lazy-Created + Strict Mermaid Renderer
**Issue**: (1) `git clone git@github.com:<user>/<repo>.wiki.git` failed "Repository not found" even though the wiki URL resolved in a browser; (2) after publishing, three wiki pages showed "Parse error" / "Lexical error" in GitHub's mermaid renderer even though the same diagrams rendered fine elsewhere.

**Root Cause**: (1) GitHub creates the wiki **git repo lazily** — until the first page is saved via the logged-in web UI, the wiki repo doesn't exist on the server, so clone/`ls-remote` 404s. (2) GitHub's wiki mermaid renderer is **stricter** than other renderers:
- `User ||----o{ UserSession : "sessions"` (4 hyphens) → parse error — erDiagram cardinality is exactly `||--o{`.
- `AIMON[/api/admin/ai/monitoring]` → a label **starting with `[/`** is parsed as a parallelogram shape and needs `/]` to close — quote it: `AIMON["/api/admin/ai/monitoring"]`.
- Unquoted labels with `<br/>` or specials (`| + ( ) → · @ % & && <=`) can error — always quote: `A["text<br/>more"]`, `E3["action: none|buy|sell|paper_trade"]`.

**Solution**: Wiki creation: ask the user to create the first page via the web UI, then clone. Diagram authoring: quote ALL labels containing specials; never deviate from exact cardinality tokens; scan for `[/` at label start. Verify by opening the live wiki page and checking for error boxes (not just the GitHub-side rendered SVG).

**Rule**: GitHub wiki ≠ repo renderers. Treat mermaid for the wiki as its own dialect — quote aggressively and verify on the live page. (See `wiki-creator` skill / `.agents/AGENT-SKILL-MATRIX.md`.)

### 49. UI Sort Keys Must Match API Zod Enums (layer contract)
**Issue**: Performance tab UI offered `sortBy` values (entryPrice, currentPrice, targetPrice, stopLoss, daysTracked, lastCheckedAt) that the API's zod `sort` enum rejected — every such sort returned HTTP 400 (first discovered as "Entry column sort broken").

**Root Cause**: Two enums drifted apart — `PerformanceTab.tsx` state typed 10 keys, API route zod only allowed 4 (`createdAt|returnPercent|symbol|confidence`). The service `orderBy` map silently tolerated extra keys (passed through to Prisma), so the UI seemed fine until the API layer rejected them.

**Solution**: Widen the API zod enum to the full 10-key set shared by the UI. Keep a single source of truth: if UI offers a sortable column, the API must accept its key (and the service must map it to a real DB field or a JS-sort path for computed values like `returnPercent`).

**Rule**: When adding a sortable UI column, audit the full chain — UI key → API zod enum → service `orderBy`/sort path → DB field. Mismatches surface as 400s or wrong order, not compile errors.

### 50. Open PR Exists → Move Work to That Branch, Never Fork a New One
**Issue**: While an open PR (`#81`, head `ph20`) awaited merge, a separate branch (`feat/recs-run-source-picks-filter`) was created from `main` for follow-up changes (run `triggeredBy`, BUY/SELL filter, AI monitoring persistence). This created a divergent branch whose changes would either orphan the open PR or conflict on merge.

**Root Cause**: Creating a new branch from `main` for work that belongs to an in-flight feature branch splits the feature across two branches and risks an out-of-order merge (the new branch could merge before the PR, or PR #81 merges without the follow-ups).

**Solution**: When a feature has an OPEN PR with an existing head branch, move ALL related work onto that branch. The stash was applied onto `ph20` and the sole conflict (in `app/api/admin/recommendations/route.ts`) was resolved in favor of ph20's `spawnRegularTask` worker-based approach.

**Rule**: Before branching, always check for open PRs on the target feature (`gh pr list --head ph20`). If a PR is open, the head branch IS the workspace — `git stash`, `git checkout ph20`, apply, resolve, commit there.

### 51. Dev DB Without Migration History → Use `prisma db push`, Not `migrate deploy`
**Issue**: On a dev DB with no `_prisma_migrations` table history, `npx prisma migrate deploy` fails with `P3005` ("The database schema is not empty" / migration history missing), even though `migrate dev` and `db push` work.

**Root Cause**: Two separately-created migrations share the timestamp `20260807103000` (archive + triggered_by). `migrate deploy` needs the full history table to apply new migrations; a DB provisioned via `db push`/`db seed` lacks it.

**Solution**: For the local dev DB, sync the schema with `npx prisma db push` (non-destructive; verified `triggeredBy` column + `recommendation_archives` table + `trackerId` nullable). Keep both migration folders in the repo — the production history-based pipeline (Netlify build `prisma migrate deploy`) will apply them correctly.

**Rule**: Check for a `_prisma_migrations` table before choosing `migrate deploy` vs `db push`. On dev DBs provisioned without history, `db push` is the sanctioned sync path; never run `migrate reset --force`/`db drop` without explicit user consent.

### 52. React Hook — Caller-Passed Array Refs Cause Infinite Rerender Loops (Stabilize via Refs)
**Issue**: `useLivePrices(["RELIANCE","TCS"])` caused **"Maximum update depth exceeded"** — 196 console errors on the Watchlist empty state, page locked up.

**Root Cause**: The hook's `fetchAllPrices` `useCallback` depended on the `symbols` array (`[symbols, updatePrices]`). Callers pass freshly-created arrays every render (`watchlists.flatMap(...)` / `holdings.map(...)`), so `fetchAllPrices` got a new identity each render → the effect (`deps: [symbolsKey, fetchAllPrices]`) re-ran every render → the empty-symbol branch called `setState` synchronously → re-render → loop. Also `symbols.sort()` mutated the caller's array in place (aliasing bug).

**Solution**: Read the latest symbols from a `symbolsRef` (`symbolsRef.current = symbols` each render) and make `fetchAllPrices` depend only on the stable `updatePrices` callback. Effect deps become `[symbolsKey, fetchAllPrices, updatePrices]` — `symbolsKey` is a primitive join so it only changes when the symbol set actually changes. Use `symbols.slice().sort()` to avoid mutating the caller's array. Guard the empty case with a conditional setState (`prev.isLoading ? ... : prev`).

**Rule**: When a hook accepts an array prop, derive a primitive key (`join(",")`) and never depend on the array reference itself inside `useCallback`/`useEffect` deps unless it is truly stable. Mock `fetch` BEFORE `renderHook` in tests (the hook fetches at mount). Regression test: re-render with a fresh array reference N times and assert only ONE EventSource connection is created.

### 53. AI Fallback Values Must Be Price-Based, Never Literal Zeros
**Issue**: Production Performance tab showed `targetPrice: 0 / stopLoss: 0` on all 1666 trackers. The row showed "confidence 50 / AI analysis unavailable — defaulting to HOLD".

**Root Cause**: Prod AI isn't configured — Netlify `[build.environment]` in `netlify.toml` has no `OPENROUTERKEY` (only local `.env` has it) → `hasValidConfig()` false → `analyzeStocks()` short-circuits to `failedResult(s, "AI is not configured")` → `getDefaultRecommendation()` returned literal `targetPrice: 0, stopLoss: 0`. Those zeros then **overwrote** the good price-based tracker-creation defaults (`price*1.2`/`price*0.95`) at tracker-create time (AI update ran after creation).

**Solution**: `getDefaultRecommendation(stock?)` computes `target = round(price * 1.1)`, `stopLoss = round(price * 0.95)`, guarded `price > 0` (else 0). `normalizeRecommendation` falls back to `round(price*1.1*100)/100` / `round(price*0.95*100)/100` instead of `|| 0`. Constants `DEFAULT_TARGET_MULTIPLIER = 1.1` / `DEFAULT_STOP_LOSS_MULTIPLIER = 0.95` shared with the service fallback. Backfilled existing rows via `scripts/backfill-recommendation-targets.ts` (idempotent, `entryPrice > 0`).

**Rule**: Any AI/fallback path that produces price-derived fields (target/SL/exit) must derive them from the stock price — literal `0`/`null` defaults silently poison downstream UI and analytics. Also: `tsx` scripts need `--env-file=.env` (else `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string` on local Postgres).

### 54. TradingView `change` IS Percent Change on NSE — Never Use `change_percent`
**Issue**: ~60 screener templates using `change_percent` silently matched 0 stocks; `getTopMovers("gainers")` returned `[]`; "Short Term Breakouts" returned 0 (Chartink shows ~20).

**Root Cause**: On NSE via TradingView, the `change` column **is already the percent change** (RELIANCE 1334.8 vs prev 1325 = +0.74%; EEPL +20.0%, SBCL +19.99% — matches Chartink). `change_percent` is null/unsupported as a column, a TV-side filter, AND a sort key (probe `change_percent > 1` → 0 rows). Any filter group using `change_percent` evaluates to empty.

**Solution**: Use `change` everywhere: templates (`thr("change","gt",0,...)`), `getTopMovers` (gainers `change > 3`, losers `< -3`), advanced route (`percentChange ?? change` — TV change is already %; do NOT derive `(change/(close-change))*100`). When displaying, label the column "Change (%)" and derive the ₹ amount client-side only: `close * pct / (100 + pct)`. Before assuming a TV field exists, probe it as a filter AND a sort key — a field can exist in the response yet be unusable as a server-side filter.

**Rule**: For TradingView/NSE, treat `change` as % and `change_percent` as non-existent. Verify field semantics with a live probe (filter + sort) before mass-using them in templates; a template that silently matches 0 is worse than a broken one — it looks fine.

### 55. E2E Flakiness on a Live-Data App: Viewport, WebKit Inputs, or Dev-Server Starvation
**Issue**: The new Playwright suite failed differently on every full run — 7 Firefox nav failures, then 3 WebKit nav timeouts (a *different* page each run), an advanced-screener empty-state test showing "2000 stocks found" instead of empty, and a marquee assertion that never appeared.

**Root Causes** (in order of frequency):
1. **Viewport/media-query mismatch (Firefox)**: the header nav is `hidden xl:flex` (≥1280px), but the `Desktop Firefox` device defaults to exactly 1280×720 and Firefox evaluates media queries against the scrollbar-excluded width → the nav never renders. Fix: desktop viewport **1440×900** in all desktop projects.
2. **WebKit drops `fill()` on controlled `<input type="number">`**: Playwright's fill sets the value programmatically; React re-renders and restores the old value, so the scan silently ran with the default (`close > 0` → 2000 stocks). Fix: `click()` → `ControlOrMeta+a` → `Delete` → `pressSequentially(...)` and assert with `toHaveValue`.
3. **Single-threaded dev server starvation**: heavy TradingView scans (30–60s, running in 3 browser projects) starve parallel SSR navigations. Fix: serial nav describe + `Promise.all([waitForURL, click({ noWaitAfter: true })])` (URL commit, not load) + 60s URL timeout; `retries: CI ? 2 : 1`, `workers: CI ? 1 : 2`. A test that fails twice on the SAME assertion is a real bug; one retried-then-passed under full load is environment.
4. **Live-data widgets render null by design**: `MarqueeBanner` returns `null` when `/api/nse/marquee` is slow/empty — never assert live NSE values (prices/indices/marquee); assert containers, contracts, or row counts only.

**Rule**: When e2e flakiness appears on a live-data app, fix the root cause in config/specs (viewport, input strategy, serialization, timeouts). Do NOT loosen assertions, add `waitForTimeout` sleeps, or bump retries to hide a real regression. Keep `retries`/`workers` as documented load knobs, not failure-hiders. `tsc` typechecks `e2e/*.ts` — keep specs type-clean.

### 56. Serverless Cron Ledger — Scheduled Functions Must Write the `CronJob` Ledger Themselves
**Issue**: Admin → Utils → Cron showed no runs at all on prod: both system jobs `lastRun: null, runCount: 0, successCount: 0, failureCount: 0` with a stale `nextRun` — even though the daily recommendation cron ran (some) scheduled executions via Netlify functions.

**Root Cause**: `CronJob` ledger fields (`lastRun`/`runCount`/`successCount`/`failureCount`/`nextRun`) were only written by `spawnCronTask()` and the resident worker-engine scheduler loop — code paths that **never run on serverless** (no persistent process to poll the schedule). The real scheduled path (`netlify/functions/cron-recommendations` / `cron-performance` → `run-cron-background.ts`) called the domain service directly and never touched the ledger. Worse: `successCount`/`failureCount` had **no writer anywhere in the codebase**.

**Solution**: Add a single `recordCronRun(jobName, success)` in `recommendationCronService.ts` (name-based `CronJob` lookup → `lastRun: now`, `runCount +1`, `successCount|failureCount +1`, `nextRun` advanced via the shared `calculateNextRun`; log-and-return on missing job, never throw). Call it in the scheduled-function success **and** error branches, and in the admin PATCH runNow/retry path (`recordManualRunLedger`, which skips `cronJobId`-linked tasks `spawnCronTask` already records to avoid double-counting). 5 unit tests cover success/failure/missing-job/prisma-find-error/prisma-update-error.

**Rule**: On serverless, a cron ledger is only ever updated at the exact call sites that execute the job — the scheduled function, the admin runNow/retry handler, and any manual trigger. Grep for every execution path of a job before assuming the ledger is being written; the resident-scheduler path is a local-only illusion on Netlify. Also: every ledger column needs a writer — `grep successCount` should never return only the schema and the read side.

### 57. AI Config Must Flow Through the Pipeline — Never Rely on Env-Only Defaults at the Call Site
**Issue**: Daily recommendation runs produced all-HOLD recommendations on prod even after the DB `ai_config` Secret was correctly set via the admin API. Root cause: `dailyRecommendationService` called `analyzeStocks(aiInput)` with **no config argument**, so the pipeline used the env-only default and the DB-stored Secret (model/API key) never reached the LLM provider.

**Solution**: A shared async `loadConfig()` (`lib/services/ai/config.ts`) — DB `ai_config` Secret merged over env, returning `model/apiKey/temperature/maxTokens/enabled` — used by both the admin test route and the daily pipeline that now passes `aiConfig` into `analyzeStocks`. Also refresh `DEFAULT_MODEL`/`AVAILABLE_MODELS` against the live provider catalog: two of the three "free" model IDs didn't exist (`tencent/hy3:free`, `qwen/qwen3-next-80b-a3b-instruct:free` → HTTP 404), which meant even a correctly-passed config hit a nonexistent model.

**Rule**: When an admin-managed config Secret is load-bearing for a background pipeline, grep the call site chain (service → agent → provider) and verify the config actually reaches the provider call — an env-only default silently bypasses the DB Secret. And verify model IDs against the live catalog (`GET /api/v1/models`), never trust hardcoded free-model IDs from memory; a 404 model produces a clean all-HOLD fallback that looks like a strategy result, not a failure.

### 58. Auth Gates — The Password Compare Must Be the FINAL Gate; Never Early-Throw on Status Flags
**Issue**: Approved join-request users (and any user with `isVerified: false`) could never log in — the browser/API returned "Email not verified" for the correct password, and returned "Incorrect email or password" for the wrong one. The account was effectively bricked with no self-service path (no resend-verification flow existed for this user class).

**Root Cause**: `lib/auth.ts` authorize() evaluated the `!isVerified` branch and threw `"Email not verified"` **BEFORE** running the bcrypt password comparison. Any pre-password throw reorders the gate: users who can't satisfy the early condition are locked out regardless of credentials, and the branch is dead code for normal signup-verified users so nothing noticed.

**Solution**: Remove the pre-password status-gate; bcrypt compare is the single authoritative gate (`user.isBlocked` check kept BEFORE the compare so blocked users still fail uniformly). Approve-route users got a FIXED known default password (`********`, bcrypt cost 12) surfaced in the admin confirm dialog + success alert + API response — a random hex temp password nobody could see created the same lockout symptom a year later.

**Rule**: When multiple conditions gate a login (verified/blocked/password), the password compare MUST be last and authoritative — status flags that are meant to be non-fatal (unverified) must not throw before identity is established. If a flag is not self-service-recoverable for all user classes, it must not be an auth gate at all. And every credential the system issues must be surfaced to the admin flow that creates it; grep the creation path for fields the UI never displays.

### 59. Log Viewer Symmetry — Write Path and Read Path Must Construct the Same Key (Dir, Date Format, Blob Store)
**Issue**: The admin monitoring page's Server Logs tab was always empty on prod (and returned nothing locally) even though the app logged constantly — logs existed but were invisible by design.

**Root Cause**: Three independent asymmetries that each produce "empty logs": (a) write dir `server_logs/` vs new read/UI expectations → renamed to `logs/`; (b) `readLogsByDate` computed `logs/<YYYY>/<YYYYMM>/<date>.log` while the writer wrote `logs/<YYYY-MM>/<date>.log` → date-derived path NEVER matched → always `[]`; (c) on Netlify the general logger wrote to per-instance ephemeral `/tmp` and NEVER to the `server-logs` Blob store that `getLogFiles()` lists, and `readBlobLog`/`deleteBlobLog` hardcoded the OTHER store (`worker-logs`) so even blob paths resolved to the wrong store.

**Solution**: One source of truth per axis — `logs/<YYYY-MM>/<YYYY-MM-DD>.log` (both sides), store name derived from the key (`*.log` → `server-logs`), `listBlobLogs` strips `.log` so blob dates match local file dates in the UI, and the general logger mirrors every line to the date-keyed `server-logs` Blob store (fire-and-forget). 7 new `@jest-environment node` tests pin the paths (jsdom makes `isServer` false so the fs branch no-ops; guard window mocks in `jest.setup.js`).

**Rule**: Anywhere a resource is WRITTEN at path X and READ via path Y (files, blobs, cache keys), write a test asserting the exact string the writer emits equals the exact string the reader parses — grep both the format AND the store/dir name on both sides. Check via Playwright on a real server that the viewer lists reads, not just that the writer logs. Rename symmetrically; a one-sided rename is the classic silent bug.

### 60. Credentials Are Env-Var-Only — Never a Literal in Code or Docs; Enforce It With Git Hooks
**Issue**: The join-approval default password lived as a hardcoded literal in `app/api/admin/join-requests/[id]/approve/route.ts` and, worse, its actual value was written into committed docs (AGENTS.md, changelogs, session files). A commit of the docs would have shipped a real account credential into git history forever; Netlify's secrets scan is a build-time backstop but the repo itself was the leak.

**Root Cause**: Convenience — a constant was easier than wiring an env var, and docs repeated the value "to be helpful". Neither code nor docs distinguished "public sandbox demo creds" (documented, exempt) from "real per-environment credentials" (must be env-only).

**Solution**: (a) `process.env.DEFAULT_PASSWORD` in the approve route with NO code fallback + a 500 `logger.error` guard when the env var is missing (a missing env var fails loudly at runtime, never silently in a commit); `.env` (gitignored) carries the real value; `.env.example` documents only the NAME with "never hardcode the value in code or docs". (b) All literal occurrences in committed docs redacted to backtick-quoted `********`. (c) Enforced by hooks: `.githooks/commit-msg` blocks credential literals in commit messages; `.githooks/pre-commit` check #6 blocks staging the real `.env` and #7 blocks credential literals anywhere in the staged diff plus `password[:=] "…"` assignments in staged `.md` files. (d) UI now references the env-var NAME in the confirm dialog and shows the server-returned value in the success alert.

**Rule**: Classify credentials first: public sandbox demo creds (documented demo logins) may stay in the README/AGENTS tables + seed + e2e env fallbacks; EVERYTHING else is env-var-only — no literal in code, no literal in docs, no literal in commit messages. Reference env var NAMES in docs. When enforcement matters, ship it in git hooks (they run on every commit, unlike memory or prompts). Before any commit: `git diff | grep -iE 'password|secret|token|api[_-]?key'` and grep the working tree for known literal values. A credential that reaches git history is leaked — redaction later only removes the current copy.

### 61. Never Write `*/` Inside a JSDoc/Block Comment — It Terminates the Comment
**Issue**: `recommendationCronService.ts` suddenly showed dozens of LSP parse errors ("expression expected", "declaration or statement expected") across unrelated functions — looked like the file was corrupted mid-edit.

**Root Cause**: The new cron constant's documentation comment contained the literal text `*/30` (the cron step for "every 30 minutes"). `*/` is the block-comment terminator, so the comment closed early and the rest of the comment text became code → cascading parse errors through the whole file. The `.ts` file itself was fine.

**Solution**: Reworded the comment to avoid the sequence (`step 30 every min — `). The cron expression string `"*/30 3-10 * * 1-5"` is unaffected — it lives in a string literal, not a comment.

**Rule**: Never place the two characters `*/` inside a `/* */` (or `/** */`) comment — not even inside an example cron expression or regex. If you must mention such text, split it (`* /30`, `\*\/30`) or put it in a string literal. This applies to every comment style that terminates on `*/`.

---

### 62. Closures Must Not Reference `const` Declared Later (TDZ)
**Issue**: `runAiConnectionTest` threw `ReferenceError: Cannot access 'report' before initialization` — a runtime crash in a brand-new service.

**Root Cause**: An inner `track()` helper (declared and CALLED before `report` was assigned) closed over the outer `report` const. The helper ran during probing, before `const report = {...}` executed → Temporal Dead Zone access.

**Solution**: The helper no longer needs `report` — it stamps its own `new Date().toISOString()` per attempt instead of referencing the later-declared const.

**Rule**: A function that executes before a `const` declaration in the same scope must not reference that binding — even if the code "looks" like it will be in scope by call time. Keep helpers self-contained (pass values as arguments, or use `let` declared earlier), and watch for `AbortSignal.timeout`/Promise callbacks that fire during an async gap.

### 63. Netlify Secrets Scan Flags EVERY Repo File — Omit-List `.githooks`/Config + Keep Placeholders Non-Credential-Looking
**Issue**: Netlify build failed at scan time — "Secrets scanning found secrets in build." The demo-credential literals (redacted to `********`) that v3.5.7 moved INTO `.githooks/commit-msg` and `.githooks/pre-commit` (extensionless files) were never omit-listed; every build after the masking work failed.

**Root Cause**: Two compounding assumptions: (a) Netlify scans the whole repo (not just the publish dir), so any committed file with a credential-looking literal fails the build — `SECRETS_SCAN_OMIT_PATHS` exists for exactly this, and (b) include-pattern-based scanners (e.g. `*.ts|*.js|*.md|…`) don't match **extensionless** files, so `.githooks/commit-msg` was invisible to the "does this file trip the scanner" mental model. Separately, app/test files contained placeholder-looking six-digit numeric literals (bot tokens, chat IDs, verification codes) — harmless on their own, but a FUTURE env value containing that substring (e.g. a rotated password with the six-digit string inside) makes the scan fail and the code read like a real leaked secret.

**Solution**: (a) `netlify.toml` `SECRETS_SCAN_OMIT_PATHS` += `.githooks` (config-only; hooks keep enforcing hygiene). (b) Replace example/placeholder credential-like values with obviously-fake ones (`87654321:AAfake0token1for2docs3only`, `-1008765432100`, `876543210`, `654321`) so no numeric literal in scanned paths can match a future env value. (c) Verify by grepping the SCANNED extensions (`*.ts/tsx/js/json/toml/yaml/yml/prisma`) for every credential-shaped numeric string, plus a sweep of the whole tree for known demo creds to confirm the rest live only in omit-listed paths.

**Rule**: Before any change that touches credentials, placeholder examples, or env vars: (1) grep the tree for the literal value(s) you might introduce — if a value exists anywhere in scanned code as a literal, a future env var containing it breaks the Netlify build; (2) keep ALL example tokens/chat-IDs/codes in scanned files clearly fake (letters + a fake-looking token shape), never plain-six-digit-style; (3) anything with demo credentials that MUST stay committed goes into `SECRETS_SCAN_OMIT_PATHS` — including extensionless files like `.githooks/*` that include-pattern scans skip; (4) after changing env vars, re-run the grep to confirm no substring collision.

---

### 64. Config-Dependent Branches Open in Tests — Jest Loads `.env`/`.env.local`; Mock the Pre-Flight Gate's Default in `beforeEach`
**Issue**: `dailyRecommendationService.test.ts` broke when the v3.8.0 pre-flight gate was added — the module under test started pulling in Prisma/network at import time and the new gate branch (`hasValidConfig(aiConfig)`) could fire during existing tests, producing all-HOLD runs or network attempts instead of the expected AI path.

**Root Cause**: Next.js + Jest auto-load `.env`/`.env.local`, so `loadConfig()` resolves a VALID AI config in tests (env `OPENROUTERKEY`/model vars present locally) — the gate's `hasValidConfig` branch is therefore LIVE in tests, not a no-op. The real `runAiConnectionTest` calls OpenRouter over the network; without a default mock, tests either hit the network or hit a branch they weren't designed for.

**Solution**: In `beforeEach`, mock the pre-flight service's default return to `status: "ok"` (configured model) so the gate behaves exactly like pre-v3.8.0 for existing tests; add dedicated tests that override the mock per-case (`ok` → configured model, `fallback` → recommendedModel, `failed` → all-HOLD `aiSuccess:false`). Also note the real module imports Prisma/network — keep the mock default in `beforeEach`, not per-test.

**Rule**: Any NEW conditional branch keyed on env/config (valid AI config, feature flag, secrets present) WILL be live under Jest because Next.js loads env files. Add a benign default mock in `beforeEach` for the whole suite, then flip it per-test only where the branch itself is under test. Never assume an env-gated path is inert in tests.

### 65. `jest.mock` Specifier Must Resolve to the SAME Module Identity the Source Imports — `@/` Alias vs Relative Path
**Issue**: `worker-engine.test.ts` mock for the scheduler's dependencies silently didn't apply — the worker still hit the real service, and tests failed with confusing "real Prisma/network" errors.

**Root Cause**: The test mocked a module by RELATIVE path while the source file imports it via the `@/` alias (or vice versa). Jest keys module registries by resolved absolute path, so the mock and the real import resolved to two different module instances — the mock never replaced the dependency. Same failure mode as aliasing `@/lib/services/worker/…` in one place and `../../lib/services/worker/…` in the other.

**Solution**: Use the exact same specifier the source uses (`@/lib/services/worker/...`), or `jest.requireActual`/`jest.mock` by the resolved path, and verify with a `expect(...).toHaveBeenCalled()` assertion that the mock actually intercepted.

**Rule**: In every `jest.mock(...)` call, copy the import specifier VERBATIM from the file under test — don't "normalize" it to a relative path or shorten it. Jest matches by module identity (resolved absolute file path), not by string similarity. When a new module gets mocked and tests still hit real code, grep the test for BOTH spellings of the path.

### 66. DB-Stored Config Overrides Env Defaults — a Stale `ai_config` Row Defeats a New Default Until Re-Saved
**Issue**: v3.8.0 raised `maxTokens` default to 8192 in `config.ts`, but prod AI runs still truncated JSON — the new default appeared to "not work".

**Root Cause**: `loadConfig()` merges the DB `ai_config` Secret metadata OVER env-derived defaults (DB wins). Any previously-saved config row (e.g. maxTokens 2048 stored months ago) silently overrides the new default; the code default only applies when no DB row exists.

**Solution**: Document the caveat at the config-defaults change site (AGENTS.md/changelog) — the operator must re-save the AI config via the admin UI (or clear the row) to pick up new defaults. Prefer writing defaults INTO the saved row at load time (migrate-on-read) so new defaults propagate without manual action.

**Rule**: Whenever you change a default that is ALSO persisted in a DB/config store, the persisted value wins over the code default by design — changing the constant alone changes nothing for existing rows. Either migrate-on-read (merge + persist new defaults), or call out the manual re-save step explicitly in the changelog/docs and verify with a DB query that no stale row pins the old value.

### 67. Cache Keys Must Encode EVERY Distinguishing Scope — One Fixed Key Served Wrong Payloads Across Runs
**Issue**: The v3.5.6 unified Chartink/TV runner cached ALL screener results under ONE fixed key (`chartink-unified:screener-results`) — a daily-recs run (7 templates) and a swing run (34 templates, different category) hit the SAME cache entry, so whichever ran first served its template universe to the other. The swing service compounded it by caching the final payload under one key regardless of `analyze` — an `analyze=false` warm-up call then served a NO-AI payload to the `analyze=true` UI.

**Root Cause**: Cache keys described WHAT the endpoint is, not WHICH QUERY produced the data. Any cache shared by parameterized scopes must bake every distinguishing input into the key or the first writer wins for everyone.

**Solution**: NEW `unifiedCacheKey(options)` encodes templateIds (sorted) / categoryId / exclusions into the read+write key; the swing service uses `${key}:ai|noai` so AI and non-AI payloads are distinct cache entries. Regression test asserts the same template set hits the same key and different sets get different keys.

**Rule**: (1) Any cached function that takes options must include those options in the cache key — sort arrays first so order doesn't split keys; (2) payload-shape flags (AI vs no-AI, enriched vs raw) belong in the key, never in a shared entry; (3) when a regression test exercises a cache fix, verify it actually WRITES the cache (use real IDs that resolve to real data) — a test with fake/empty inputs silently no-ops and proves nothing.

### 68. Status Flags Must Be DERIVED From Actual Results — Never Set Unconditionally After a Swallow-Fail Batch
**Issue**: Live on tradenext6.netlify.app (v3.9.0), the Swing tab header badge showed **"AI targets ready"** (emerald) while EVERY card below it showed "AI targets unavailable (Swing batch failed after 2 attempts: Unusable AI response (p) — screener signals only)". The header lied — and it was live-visible to users.

**Root Cause**: `swingRecommendationService.ts` ran the AI batch and then set `analysisStatus = "done"` UNCONDITIONALLY. The swing agent (`analyzeSwingStocks`) is designed to SWALLOW per-stock failures — it attaches `analysisError` to each stock and returns normally instead of throwing. So the `catch` path (`"failed"`) only ever fired on a hard exception the agent-by-design never raises; a fully-failed batch walked past the loop and got "done". A resilient system with graceful degradation is only as honest as its outcome flags — the "done" was true about "the code ran", false about "the analysis succeeded".

**Solution**: NEW pure `analysisStatusAfterBatch(stocks)` — `"done"` only when ≥1 stock carries `analysis`; else `"failed"`. The `analyze=false` path keeps its initial `"skipped"`. Regression tests: partial-batch → "done", all-failed → "failed", empty → "failed". The UI badge (`ANALYSIS_STATUS_META` in `SwingTab.tsx`) now matches the cards.

**Rule**: Any status/badge/ledger field that summarizes an outcome must be COMPUTED FROM THE RESULTS (count of successes), never assigned a constant after a best-effort call. This applies doubly to functions whose failure mode is graceful per-item degradation instead of throwing — the try/catch "failed" path is unreachable by design, so the only honest status source is the data itself. Also: after any deploy, verify the UI's summary/header claims against the per-item details on the LIVE site — mismatches there are usually this exact class of bug.

### 69. `npx tsx` Scripts Finish but the Shell Reports "timeout" (Lingering Handle) + cmd Redirect Order
**Issue**: Running `npx tsx --env-file=.env scripts/backfill-daily-prices.ts --symbols TCS --days 5` produced complete, correct output (4 EQ bars fetched, 0 written, 0 errors, 0.8s) yet the shell tool appended a "timed out" marker afterward. A PowerShell-piped variant also showed empty stdout while the script was actually working.

**Root Cause**: The tsx/Prisma process keeps a lingering node handle (logger/DB client) after the script's work is done, so the process doesn't exit immediately — the shell wrapper's watchdog fires even though the script already finished. Separately, `cmd` redirect order matters: `2>&1 > file` sends stderr to the OLD stdout (console) while stdout goes to the file; the correct order is `> file 2>&1`.

**Rule**: (1) Judge `tsx` script success by the OUTPUT CONTENT (summary lines, exit summary), not by the "timeout" marker — the marker is cosmetic when output is complete. If the output is missing, it's usually a pipe/buffering artifact: run the command directly without PowerShell piping. (2) On Windows cmd, always write redirects as `> file 2>&1` so both streams land in the file. (3) When verifying a dry-run script, the strongest proof is "bars fetched > 0 AND bars written = 0".

### 70. Jest Mock Hygiene: resetAllMocks + Regex Param Guards + Falsy-Guard Bugs
**Issue**: While building `historicalPriceSyncService.test.ts`, several subtle test bugs produced false passes/failures: (1) `jest.clearAllMocks()` in `beforeEach` did NOT clear implementations set by `mockResolvedValue` in a previous test — state leaked across tests (use `jest.resetAllMocks()`); (2) the upsert-SQL assertion regex `\$1` also matched `$11`/`$12` — parameter-count checks must use `/\$1(?![0-9])/`; (3) a production guard `if (options.maxDurationMs && …)` treated `maxDurationMs: 0` as "no cap" — the `typeof === "number"` check fixes it; (4) `$executeRawUnsafe(...args)` spreads the SQL string + one param array — the array length is `first.length - 1`, not `first.length`.

**Root Cause**: clear-vs-reset confusion (clear empties call history, reset also drops implementations/mocks); greedy regexes; the eternal falsy-vs-undefined guard mistake.

**Rule**: (1) Default to `jest.resetAllMocks()` in `beforeEach` unless you specifically need to preserve implementations; (2) when asserting positional SQL params, anchor the regex so `$1` doesn't swallow `$11`; (3) treat `0` as a legitimate value — guards on numeric config options use `typeof x === "number"` (or explicit `!= null`), never bare truthiness; (4) when a test drives `$executeRawUnsafe`, count the spread args the way the code does. Same class of errors will hide again in any raw-SQL upsert test.

---

### 71. "Apply the Missing Migration on Prod" Requires the Migration to EXIST — grep `prisma/migrations` First
**Issue**: MCP `getHistoricalData` 500'd on prod because `public.backtest_history` was missing. The plan (`plan-backtest-history-prod-gap.md`) recommended Option A "identify the migration that creates `backtest_history`, run `prisma migrate deploy`". When the user overrode to build the fix, `grep -r "backtest_history" prisma/migrations` returned **ZERO hits** — no migration ever created the table. It existed locally only because dev `db push` (schema sync) built it; prod runs `prisma migrate deploy`, which only applies migrations in the folder, so the table never appeared on prod.

**Root Cause**: A model in `prisma/schema.prisma` + a working local DB does NOT imply a migration exists. `db push` silently creates tables without a migration record — those tables are invisible to `migrate deploy` on prod (Lesson 40's twin: deploy skips migration plumbing entirely).

**Rule**: (1) Before planning "apply the missing migration on prod", run `grep -r "<table>" prisma/migrations` — if zero hits, that option is impossible and the fix must be code-side (lazy `CREATE TABLE IF NOT EXISTS`, self-healing on serverless, e.g. `ensureBacktestHistoryTable` in `backtestDataService.ts`). (2) When the app creates DDL at runtime, mirror the Prisma model exactly (camelCase quoted columns, JSONB, TIMESTAMP(3), index/constraint names as Prisma would generate) and make it idempotent (`IF NOT EXISTS` everywhere). (3) Memoize the ensure-promise per process but DO NOT memoize failures — a transient DDL failure (permissions) should retry on the next call. (4) A missing table must never 500 the chain: skip the temp leg and degrade to the cheaper fallback source (daily_prices/NSE).

---

### 72. `jest.mock` Factories Can't Dereference Module-Scope Mock Vars — SWC Doesn't Hoist `const` Above Imports
**Issue**: While building `cron-daemon.test.ts`, the node-cron mock initially captured module-scope vars directly: `const mockSchedule = jest.fn(); jest.mock("node-cron", () => ({ schedule: mockSchedule, ... }))`. The mock never applied / threw "Cannot access 'mockSchedule' before initialization" (TDZ).
**Root Cause**: SWC/Babel does NOT hoist module-scope `const` declarations above the `import` statements. `jest.mock(...)` calls are themselves hoisted to the top of the module and their FACTORY functions run during import-graph evaluation — before any module-scope `let/const` below has been initialized. So a factory body that references `mockSchedule` reads it in the temporal dead zone.
**Solution**: The factory must only CAPTURE `mock`-prefixed names inside closures invoked LATER (at call time), never dereference them at factory-build time:
```typescript
const mockSchedule = jest.fn();
jest.mock("node-cron", () => ({
  schedule: (...args: unknown[]) => mockSchedule(...args), // capture in closure
  validate: (...args: unknown[]) => mockValidate(...args),
}));
```
This is the same pattern `dailyRecommendationService.test.ts` documents in its header comment (lines 10–11). Also: never read `mockX.mock.calls` from inside the factory — the assertions live in test bodies only.
**Rule**: (1) In any jest mock factory, ALL module-scope mock variables must appear only inside closures (`(...args) => mockVar(...args)`), never as direct references in the factory body. (2) Use `mock`-prefix names for everything a factory captures so the convention is greppable. (3) If a mock "silently doesn't apply", suspect TDZ/hoisting before suspecting the path specifier (Lesson 65) — the failure signature differs: TDZ throws on require, path mismatch silently runs real code.

### 73. Fire-and-Forget Async Callbacks Need a Microtask Flush in Tests — `void fireJob(...)` Never Awaitable
**Issue**: In `cron-daemon.test.ts`, the node-cron handler is registered as `void fireJob(job.id)` — deliberately fire-and-forget (the daemon must never block the scheduler tick). Calling the mocked callback `mockScheduled[0].fn()` and then immediately asserting left the job half-run: `fireJob` awaited a dynamic import + DB read + spawn chain, and the assertion ran before the promise chain settled.
**Root Cause**: The scheduler callback starts an async chain and returns nothing (`void`). Jest has nothing to await; the assertions race the pending microtasks. The chain passes through a dynamic `await import("./task-orchestrator")`, which adds at least one extra macrotask hop.
**Solution**: After triggering the callback, flush with a real event-loop turn:
```typescript
mockScheduled[0].fn();
await new Promise((resolve) => setTimeout(resolve, 0));
expect(mockWorkerTaskCreate).toHaveBeenCalledTimes(1);
```
If the chain involves dynamic import or `setImmediate`/timers, use `setTimeout(resolve, 0)` (macrotask) rather than `await Promise.resolve()` (microtask-only — insufficient when a dynamic import is in the path).
**Rule**: (1) When a system under test schedules work fire-and-forget, always identify the async hops (dynamic import, timers, DB) and flush with `setTimeout(0)` before asserting side effects. (2) Prefer asserting the OBSERVABLE side effect (workerTask create, cronJob update) over the intermediate promise. (3) If the flush is flaky in CI, extract the chain to an exported async function and unit-test that directly — keep the fire-and-forget wrapper as a one-liner.

### 74. PowerShell 5.1 UTF-8 BOM Breaks Node `--env-file` (Silently Skips the First Key) + Env-Var Daemon Kill-Switches Disable Silently
**Issue**: After removing a line from `.env` with PS 5.1 `Set-Content -Encoding utf8`, `npx tsx --env-file=.env` probes suddenly showed REMOTE (Prisma Accelerate) data while the Next.js app itself looked fine and local. Also: a restart of the dev server produced NO daemon heartbeat/log although an OLDER server (that predated the env var) had run the daemon fine.
**Root Cause 1 (BOM)**: PS 5.1 `-Encoding utf8` writes a **UTF-8 BOM (EF BB BF)**. Next.js's env loader tolerates the BOM, but Node's `--env-file` skips the FIRST key when a BOM precedes it. `.env` line 1 was `ENVIRONMENT=local` → every probe fell through to `DATABASE_REMOTE` / `ACCELERATE_URL` and hit the Netlify-era DB. Any probe result that "looks remote" while the app says `environment=local, isLocal=true`: check `fs.readFileSync(p)[0..2]` for `EF BB BF`.
**Root Cause 2 (kill-switch)**: `CRON_DAEMON_DISABLED=1` had been added to `.env` (so the Netlify serverless deploy keeps the daemon off) — local dev loads `.env` too, so EVERY restart silently disabled the daemon. The old server that "worked" predated the var. Grep `.env*` for the disable flag BEFORE debugging code when a daemon/service doesn't start after a restart.
**Fix**: Rewrite env files BOM-free via node: `node -e "const fs=require('fs');let s=fs.readFileSync(p,'utf8');if(s.charCodeAt(0)===0xFEFF)s=s.slice(1);fs.writeFileSync(p,s,'utf8')"`. Same trap applies to `netlify.toml`, JSON configs, and any file consumed by a Node CLI — never PS 5.1 `Set-Content -Encoding utf8` on config files. Keep kill-switch vars OUT of gitignored `.env` (set them only where needed: Netlify site env vars, not local).
**Rule**: (1) Verify env-file integrity with a byte check after any PowerShell edit. (2) When a subsystem "doesn't start after restart" but worked on an older server, grep `.env*` for its kill-switch before touching code.

### 75. Fallback Data Must NEVER Be Persisted as Real Analysis - Synthetic Verdicts Become "The Latest Run"
**Issue**: On an AI outage day the user saw ALL 50 Today's Picks as HOLD/confidence-50 — a screen full of meaningless rows. The daily-recs pipeline called `holdFallback(...)` (`success:false`) whenever the AI pre-flight failed or a batch threw, and those fallback rows were PERSISTED: every stock entry got HOLD/50/target price×1.1/stop price×0.95, and the `DailyRecommendationRun` was marked `completed` with `uniqueStocks: 50`. `getLatestRecommendations` then surfaced THAT run (newest), hiding the last good run behind a wall of synthetic HOLDs. The API route defaulting `s.aiRecommendation ?? "HOLD"` / confidence `?? 50` turned every NULL-AI entry into a fake verdict.
**Root Cause**: Persistence was keyed on "the run happened" instead of "the run produced real verdicts". A `success:false` AI result is NOT data — it's a signal to skip/rollback, but the pipeline treated "AI didn't throw" as "AI answered" and wrote everything.
**Fix (v3.11.1)**: Partition results on `success` FIRST — only `success:true` verdicts are written (entries/trackers/predictions). Zero successes → `deleteMany` all entries + mark the run `failed` (`uniqueStocks: 0`, `metadata.aiUnavailable: true`, `run_failed` event, `SCREENER_RUN_FAILED` audit, cache invalidate) so the consumer falls back to the previous good run and no broadcast fires. Partial failure → persist only the successful subset, then delete any entry that lacks a real verdict (failed symbols + capped overflow, `symbol: { notIn: analyzed }`).
**Rule**: (1) When a "fallback" produces rows that are indistinguishable from real data, it WILL be persisted — make fallback results carry `success:false` and gate ALL writes on it. (2) `?? default` in API/UI layers can resurrect deleted/missing verdicts as fake data — prefer explicit nulls and UI "unavailable" states over defaults that look real (the "AI unavailable" amber banner beats 50 fake HOLDs). (3) A run whose outcome is "AI failed" must record itself as `failed`, never `completed`.

### 76. In-Process Caches Are PER-MODULE-INSTANCE — Next.js Dev Loads `instrumentation.ts` and API Routes as SEPARATE Module Graphs
**Issue**: After the v3.11.1 no-fake-HOLD fix re-ran the daily recommendations, the public page STILL showed "Last updated: 14/8/2026" — the worker called `invalidateRecommendationsCache()` (which `flushAll`s `recommendationsCache`) but the API route kept serving the 23h-stale cached run.
**Root Cause**: Next.js dev (Turbopack) loads `instrumentation.ts` (the worker/cron-daemon entry) and API routes as **SEPARATE module graphs** — `lib/cache.ts` was evaluated TWICE, creating TWO independent `recommendationsCache` NodeCache instances. Invalidation is an object identity operation: `flushAll()` on the worker's instance does nothing to the route's instance. Module-scope singletons only work when the module is evaluated once per process.
**Fix**: Mirror `lib/prisma.ts`'s pattern — stash the cache on `globalThis`: `globalForCache.__recommendationsCache ?? (globalForCache.__recommendationsCache = new NodeCache({...}))`. Every importer resolves the SAME object regardless of module-graph boundaries.
**Rule**: (1) Any in-process state that must be SHARED across Next.js's module-graph boundary (worker/instrumentation ↔ routes) — caches with cross-module invalidation, connection pools, singleton services — belongs on `globalThis`, not at module scope. (2) A cache is only worth invalidating if the invalidator and the reader resolve the SAME instance — write a test that simulates two module loads (`jest.resetModules()` + re-`require`) and asserts identity + flush propagation. (3) Only apply this to caches with cross-module invalidation semantics; short-TTL caches with no invalidator don't need it (keeps the diff surgical).

### 77. When the Deployment Model Changes, the Kill-Switch Must Die With the Old Model — and Skipped Test Suites are Latent Failures
**Issue**: v3.11.0 introduced an in-process node-cron daemon (`instrumentation.ts`) but kept `CRON_DAEMON_DISABLED=1` "for serverless" (Netlify scheduled functions had been deleted, but the opt-out comment lingered). Lesson 74 even said to keep it. Every serverless branch, `isServerless()` helper, and the `@netlify/blobs` log mirror stayed in the codebase — dead weight with an active footgun: on Netlify (now a persistent server) the flag would SILENTLY disable the daemon in prod. Separately, `DataFetcher.test.tsx` sat `describe.skip`'d for a REMOVED API (`children`/`apiCall` props, undefined `mockUseApi`/`mockApiCall` globals) — a skipped suite that would never catch the next refactor of that component, and it skewed every suite run ("700/11" vs the honest "709/4").
**Root Cause**: Incremental evolution left the old model's escape hatches in place "just in case". The skip was the classic "fix later" — but the component was rewritten twice while the test stayed disabled, so the test grew stale and the LSP even reported undefined globals in it.
**Fix (v3.11.3)**: (1) DELETE the opt-out + guard + comments from `instrumentation.ts`/`cron-daemon.ts` — with Netlify running the app as a persistent Next.js server the daemon MUST self-start; keep only `NEXT_RUNTIME === "nodejs"` + `NEXT_PHASE !== "phase-production-build"` (build/Edge safety, not serverless). (2) `git rm lib/netlify-logger.ts` + drop `@netlify/blobs`; strip every Blob/serverless branch from `lib/logger.ts`/`worker-logger.ts`. (3) Rewrite the skipped suite for the CURRENT `apiUrl` + `render` render-prop API (9 tests, 9/9 pass) — it immediately caught a render-prop arg mismatch (raw data passed as the arg, not `{data}`).
**Rule**: (1) When a new deployment model supersedes the old one, audit and REMOVE the old model's kill-switches/opt-outs — an opt-out for a deleted mode is a prod footgun, not a safety net. Grep for the flag before merging (Lesson 74's "keep kill-switches in env" advice assumes the switch still has a legitimate target). (2) A `describe.skip`/`test.skip` is a latent failure: it hides regressions AND poisons suite counts — un-skip or delete when the covered code changes. Rewriting for the current API is cheaper than guessing from stale assertions. (3) Rewriting a test against a live component is a mini-integration test — write the mock of the hook/API you ACTUALLY import, not the one the old test invented.

### 78. Backfill Scripts' Default Scope Rarely Matches the Real Consumers — Verify COVERAGE, Not Just Rows Written
**Issue**: The prod `daily_prices` backfill pass 1 (`--days 120`, default scope) wrote **15,226 bars for 246 symbols, 0 errors** — but a coverage check showed **107 of 130 tracking trackers STILL had no price rows**. The "0 errors" summary hid a scope problem: the script's default scope is NIFTY 50 ∪ **30-day** trackers ∪ live screener results (capped 300), while most tracking trackers were created in **July** (the recs engine last ran then) — far outside the 30-day window.
**Fix**: Pass 2 used an explicit `--symbols` list built from the actual consumers: `SELECT DISTINCT ticker FROM "RecommendationTracker" WHERE "status" = 'tracking' AND NOT EXISTS (SELECT 1 FROM daily_prices dp WHERE dp.ticker = rt.ticker)` → 85 fetched / 5,596 bars; pass 3 for the 22 remaining → 7 fetched / 373 bars. Final coverage: **115/130 trackers (88%)**; the last 15 return NSE empty data (Lesson 79).
**Rule**: (1) After ANY backfill, measure coverage against the consumers that read the data (trackers → performance page, swing picks → indicators), not just total rows written — "0 errors" ≠ "the problem is solved". (2) The default scope parameter is the FIRST suspect when consumers still show gaps; read the scope code before re-running with bigger numbers. (3) Write the coverage query as a temp script (Lesson 80) and run it BEFORE deciding the backfill is done.

### 79. NSE `historicalOR` Returns HTTP 200 with EMPTY Data for Some Symbols — Not an Error, Don't Retry-Loop
**Issue**: After the prod backfill, 15 trackers still had no `daily_prices` rows (BAGMANE.RR, SIGACHI, DIGIKORE, ALPEXSOLAR, ELGNZ, GSMFOILS, JAINIK, UCL, BEACON, MAHICKRA, SUNLITE, VHLTD, CURRENT, TUNWAL, NEUEON). A direct probe with a ~180-day window + EQ series filter showed NSE returns **200 OK with `{data: []}`** — no error, no rate-limit signal, just no rows.
**Root Cause**: NSE-side data availability/anti-bot for those specific symbols (suspended, illiquid, or blocked per-symbol) — indistinguishable from a legit "no data" by the HTTP layer.
**Fix**: Accept empty-200 as "no data available". Never retry-loop it (it will never succeed). Cover the gap at CONSUMPTION time instead: `checkRecommendationPerformance` bridges symbols with no `daily_prices` rows (cap 50, chunked `Promise.allSettled`) via the live `getStockQuote` fallback so Current/Return % are never blank.
**Rule**: (1) A 200-with-empty-body from NSE is a legitimate state, not an error to retry — log it, move on, and treat per-symbol coverage gaps as data-availability, not code bugs. (2) When a data source permanently lacks symbols, build the fallback at the consumer (performance check, indicators) rather than trying to force the source. (3) Probing a handful of the missing symbols (not all 15) is enough to classify the pattern.

### 80. `tsx -e` + cmd Mangles `$`-Prefixed Prisma Methods — Use a Temp Script File (or the Prisma Client API)
**Issue**: A one-liner verification `npx tsx -e "prisma.$queryRawUnsafe(...)"` failed with an esbuild syntax error — on Windows cmd, `$q`/`$e`-style method names in `tsx -e` strings get mangled (variable-name parsing sees `$queryRawUnsafe` as an identifier it refuses to parse) and quoting a `$`-heavy SQL string across cmd layers is a nightmare (this is the same family as Lesson 69's cmd redirect/quoting hazards).
**Fix**: Write a temp script (`scripts/.tmp-verify-backfill.ts`), run it with `npx tsx --env-file=.env`, read the output, then DELETE it. Bonus: prefer the Prisma Client API over raw SQL when possible — `prisma.dailyPrice.count()` and `findMany({ distinct: ["ticker"] })` need no `$` escaping at all.
**Rule**: (1) Never fight `tsx -e` with `$`-prefixed identifiers or complex quoting — a temp file is always cheaper. (2) Name temp scripts `scripts/.tmp-*.ts` so they're obviously disposable and never accidentally committed; delete after use (Lesson 21 hygiene). (3) If a verification one-liner keeps failing, switch to the Client API before debugging the shell.

---

## Update Log
- 2026-08-16: Added Lessons 78-80 (backfill default scope = NIFTY 50 ∪ 30-day trackers ∪ live screener missed 107/130 tracking trackers — measure coverage against the real consumers after a backfill, "0 errors" ≠ solved; NSE `historicalOR` returns 200-with-empty-data for some symbols — data availability, not an error, cover gaps at the consumer with a live-price fallback; `tsx -e` on cmd mangles `$`-prefixed Prisma methods — use a temp `scripts/.tmp-*.ts` file or the Client API); added v3.12.0 prod-stability batch entry (perf-check live-price fallback, prod `daily_prices` backfill APPLIED — 21,195 bars / 0 errors / coverage 8 → 115/130 trackers, Prisma per-query timeout, heartbeat-aware reaper, worker-logger `resolveLogsDir`, error serialization — suite 722 pass / 4 skip, tsc 46 baseline)
- 2026-08-15: Added Lesson 77 (when the deployment model changes, the OLD model's kill-switch must die with it — `CRON_DAEMON_DISABLED=1` survived the v3.11.0 serverless→persistent-server switch as a prod footgun; Netlify now runs a persistent Next.js server so the daemon must self-start; deleted the opt-out + `lib/netlify-logger.ts` + `@netlify/blobs` and stripped every Blob/serverless branch; `describe.skip`'d suites are latent failures — rewrote `DataFetcher.test.tsx` for the current render-prop API, 9/9 pass, caught a render-prop arg mismatch); added v3.11.3 full-serverless-purge entry (suite 709 pass / 4 skip, tsc 46 errors — DOWN from 71 baseline, 0 new)
- 2026-08-15: Added Lesson 76 (in-process caches are PER-MODULE-INSTANCE — Next.js dev loads `instrumentation.ts` and API routes as SEPARATE module graphs, so `lib/cache.ts` was evaluated TWICE and the worker's `flushAll()` on ITS `recommendationsCache` copy never reached the route's instance; fix = `globalThis` singleton like `lib/prisma.ts`, and test with `jest.resetModules()` re-require asserting identity + flush propagation); added v3.11.2 stale-recs-cache-across-module-graphs fix entry (suite 700 pass, tsc 71 baseline)
- 2026-08-15: Added Lessons 74-75 (PS 5.1 `Set-Content -Encoding utf8` writes a UTF-8 BOM that Node `--env-file` silently tolerates by SKIPPING the first key → probes hit the remote DB while the app looks local; env kill-switches like `CRON_DAEMON_DISABLED=1` in gitignored `.env` disable subsystems on EVERY local restart — grep `.env*` before debugging a "doesn't start after restart" daemon; fallback data must never be persisted as real analysis — `success:false` holdFallback batches overwrote the last good run with synthetic HOLD rows; fix gates persistence on `success:true`, zero-success runs become `failed` with no entries + `latestRun` notice; `?? default` in API/UI can resurrect null verdicts as fake data); added v3.11.1 no-fake-HOLD Today's Picks entry (suite 696 pass, tsc 71 baseline, Playwright-verified banner)
- 2026-08-15: Added Lessons 72-73 (jest.mock factory bodies run during import-graph evaluation — SWC doesn't hoist `const` above imports, so factories must only CAPTURE `mock`-prefixed vars inside closures, never dereference them (TDZ); fire-and-forget async scheduler callbacks — `void fireJob(...)` — need a `setTimeout(0)` macrotask flush in tests when a dynamic import is in the chain); added v3.11.0 in-process node-cron daemon (Netlify scheduled functions deleted) + ledger outcome wiring (`skipSpawnCounted`) + `daysTracked` sort fix entry
- 2026-08-14: Added Lessons 69-71 (tsx scripts finish but shell reports "timeout" from a lingering node handle — judge by output content, redirect order `> file 2>&1` on cmd; Jest mock hygiene — `resetAllMocks` vs `clearAllMocks`, anchor `$1` regex so it can't match `$11`, `typeof` guard for `maxDurationMs: 0`, spread-arg count for `$executeRawUnsafe`; "apply the missing migration" requires the migration to EXIST — grep `prisma/migrations` first, `db push`-created tables never reach prod, fix via lazy idempotent DDL that degrades instead of 500); added v3.10.0 historical-price sync into `daily_prices` + `backtest_history` prod-gap FIX entry (local `--apply` executed: 266 symbols / 17,198 bars / 0 errors; PR #91)
- 2026-08-14: Added Lessons 69-70 (tsx scripts finish but shell reports "timeout" from a lingering node handle — judge by output content, redirect order `> file 2>&1` on cmd; Jest mock hygiene — `resetAllMocks` vs `clearAllMocks`, anchor `$1` regex so it can't match `$11`, `typeof` guard for `maxDurationMs: 0`, spread-arg count for `$executeRawUnsafe`); added v3.10.0 historical-price sync into `daily_prices` + `backtest_history` prod-gap plan entry
- 2026-08-14: Added Lesson 68 (status flags must be DERIVED from actual results — the live prod Swing header lied "AI targets ready" over an all-failed AI batch because `analysisStatus = "done"` was set unconditionally after a swallow-fail call whose catch path is unreachable by design; derive from `analysisStatusAfterBatch(stocks)`); added v3.9.1 swing analysisStatus honesty fix + live verification + prod data-gap findings entry
- 2026-08-13: Added Lesson 67 (cache keys must encode every distinguishing scope — sorted templateIds/category/exclusions in `unifiedCacheKey`, `${key}:ai|noai` for AI vs no-AI payloads, and regression tests must actually write the cache — fake IDs produce empty runs and prove nothing); added v3.9.0 Swing Trading Signals tab + scope-aware cache-key fixes + NSE candlestick chart buttons entry
- 2026-08-13: Added Lessons 64-66 (config-dependent branches are LIVE in Jest because Next.js loads `.env` — default-mock the pre-flight gate in `beforeEach`; `jest.mock` specifier must be VERBATIM from the source import — `@/` alias vs relative path resolves to different module instances; DB-stored `ai_config` metadata overrides env/code defaults — re-save via admin UI or migrate-on-read to pick up new defaults like maxTokens 8192); added v3.8.0 AI pre-flight gate + cron dedup + stale-task reaping + maxTokens default entry
- 2026-08-13: Added Lesson 63 (Netlify secrets scan flags EVERY repo file incl. extensionless `.githooks` — omit-list config files; keep example tokens/chat-IDs/codes clearly fake, never plain-six-digit-style, so future env values can't substring-collide; grep scanned extensions after env changes); added v3.7.2 secrets-scan fix + live-site staleness finding entry; v3.7.3 masked the incidental literals this lesson itself had printed
- 2026-08-13: Added Lessons 61-62 (never write `*/` inside a block/JSDoc comment — it terminates the comment early and shatters file parsing, reword `*/30` as `step 30 every min`; closures must not reference `const` declared later — TDZ, stamp per-attempt timestamps instead); added v3.7.1 BUY/SELL-only broadcast + AI connection-test cron + CI e2e fix entry
- 2026-08-11: Added Lesson 60 (credentials env-var-only — no literals in code/docs/commit messages; `DEFAULT_PASSWORD` env + `.githooks/commit-msg` + pre-commit #6/#7; redact literals to `********`; public sandbox demo creds exempt); added v3.5.7 credential-hygiene + llms.txt/robots discovery entry
- 2026-08-11: Added Lessons 58-59 (auth gate ordering — password compare must be the final gate, never early-throw on status flags, surface system-issued credentials in the admin flow; log viewer symmetry — write path and read path must construct the same dir/date/blob-store key); added v3.5.7 auth join→approve→login + server logs `logs/` dir entry
- 2026-08-11: Added Lessons 56-57 (serverless cron ledger must be written by the scheduled-function/admin call sites — `recordCronRun`; AI config must flow to `analyzeStocks` via shared `loadConfig` — env-only defaults + nonexistent free-model IDs caused prod all-HOLD runs)
- 2026-08-08: Added Lesson 55 (Playwright e2e flakiness on live-data apps: Firefox xl-nav viewport 1440×900, WebKit controlled number-input keystrokes, single-threaded dev-server nav starvation → serial + noWaitAfter + retries, live NSE values never asserted); added v3.5.3 e2e suite entry
- 2026-08-08: Added Lesson 54 (TradingView `change` = % on NSE; `change_percent` null/unsupported → 57 templates mass-fixed, Short Term Breakouts 0→250 via `change>0, relative_volume_10d_calc>1, Perf.5D>3`)
- 2026-08-07: Added Lessons 52-53 (React hook caller-array refs → infinite rerender loop, stabilize via refs + primitive key; AI fallback values must be price-based, never literal zeros — prod target/SL ₹0.00 bug)
- 2026-08-07: Added Lessons 50-51 (open PR → move work to existing head branch, never fork; dev DB without migration history → `db push` not `migrate deploy`); added v3.5.0 run trigger source + BUY/SELL filter + AI monitoring persistence lessons
- 2026-08-07: Added Lessons 48-49 (GitHub wiki lazy-creation + strict mermaid; UI sort keys vs API zod enums); added v3.5.0 performance/archival + wiki + skills-system lessons
- 2026-08-06: Added Lessons 46-47 (Prisma interactive $transaction expiry → runInChunks; cache invalidation after background updates); added v3.4.1 prod reliability fixes lessons
- 2026-07-22: Added Lessons 44-45 (Telegram webhook vs local DB mismatch, Prisma 7 adapter for scripts); added v3.4.0 Telegram bot integration lessons
- 2026-07-21: Added Lessons 41-43 (Prisma @@map table names, camelCase column naming, AI test endpoint pattern); updated Lesson 24 (dev:bg PowerShell script for reliable agent startup)
- 2026-07-20: Added Lesson 40 (Production Migration) — quickbuild skips prisma migrate deploy, causes missing tables in production
- 2026-07-19: Added Lessons 36-39 (Test Fixes & Security) — SWC TDZ mock pattern, CodeQL modulo bias, AI response parsing priority, retry mock count matching
- 2026-07-19: Added Lessons 26-35 (Daily Recommendations) — hybrid API fallback, AI batch processing, cron timezone, public/auth routes, tracker entity, circuit breaker, unified events, prediction tracking, prompt versioning, screener deduplication
- 2026-07-18: Added Lesson 24 (Dev Server Detach) — PowerShell Start-Process for non-blocking startup
- 2026-07-18: Added Lesson 25 (Client-Server Separation) — extract types to avoid bundling Node.js modules
- 2026-07-18: Added Playwright Snapshot Cleanup & Code Hygiene lesson (v1.16.1) — mandatory pre-commit cleanup checklist
- 2026-07-16: Added Git Hooks Must NOT Modify Tracked Files lesson (critical bugfix - infinite loop)
- 2026-07-16: Fixed pre-commit hook shell variable handling (integer expression bug)
- 2026-07-16: Added Agent Handoff & Self-Learning System lessons (v1.15.0)
- 2026-07-16: Added Handoff File Protocol lesson
- 2026-07-16: Added Advanced Screener lessons (v1.16.0): Chartink architecture, FilterBuilder type safety, dev server management, multi-value input patterns, backtest scope
- 2026-07-16: Added Session Start Protocol lesson
- 2026-07-16: Added Agent Pipeline Protocol lesson
- 2026-07-16: Added Self-Learning Loop lesson
- 2026-07-16: Added Pre-Commit Secrets Detection lesson
- 2026-03-21: Added SEO & Analytics lesson (v1.11.0)
- 2026-03-20: Added lesson 23 (Path Traversal Prevention) - sanitize user inputs in file paths
- 2026-03-20: Added lesson 22 (NSE API Field Casing) - NSE uses lowercase fields
- 2026-03-20: Added lesson 13b (Database-Backed Logging) for serverless platforms
- 2026-03-20: Added lesson 20 (Type Checking Before Method Calls)
- 2026-03-20: Added lesson 21 (MANDATORY Documentation Updates) and updated commit checklist
- 2026-03-20: Added lesson 19 (Prisma Unique Constraints & Deduplication)
- 2026-03-18: Added v1.9.1 lessons (Prisma casing, Netlify Blobs, Dependency minimization)
- 2026-03-16: Added middleware rules (main 502 cause discovered)
- 2026-03-16: Initial rules added based on Netlify 502 fix
