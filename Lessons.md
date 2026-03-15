# Lessons.md - Rules & Corrections

> Agent MUST read this file before making any commit. Apply all rules below.

---

## Rules for This Project

### 1. Prisma 7 Configuration
**Issue**: Build failing with "engine type client requires adapter or accelerateUrl"

**Root Cause**: Prisma 7 changed how database connections work

**Solution**: 
- Use driver adapter (PrismaPg) for PostgreSQL connections
- Do NOT use `accelerateUrl` unless using Prisma Accelerate
- Keep DATABASE_URL as standard `postgresql://` format

**Correct Code**:
```typescript
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prismaClient = new PrismaClient({ adapter });
```

---

### 2. Netlify Build - Dependencies
**Issue**: Build failing with missing module errors on Netlify

**Root Cause**: DevDependencies not installed on Netlify

**Solution**: 
- Move runtime-required packages to `dependencies` in package.json
- Especially: @types/*, typescript, postcss, @tailwindcss/postcss

**Packages That Must Be in Dependencies**:
- @types/node
- @types/bcryptjs
- @types/morgan
- @types/node-cache
- @types/pg
- @types/react
- @types/react-dom
- @types/sanitize-html
- @types/unzipper
- typescript
- postcss
- @tailwindcss/postcss

---

### 3. Netlify Environment Variables
**Issue**: 502 Bad Gateway - database connection failure

**Root Cause**: DATABASE_URL points to localhost which doesn't exist on Netlify

**Solution**:
- DO NOT set USE_REMOTE_DB=true in netlify.toml
- Set valid DATABASE_URL in Netlify Dashboard → Environment Variables
- Format: `postgresql://user:password@host:port/database`

---

### 4. Logger - Production Output
**Issue**: No logs visible in production to debug 502

**Root Cause**: Logger only outputting to file, not console

**Solution**:
- ALWAYS log to console for debugging
- Use console.log/console.error directly for critical errors
- Named exports needed for some imports: `export const info = logger.info`

---

### 5. Netlify TOML Syntax
**Issue**: "Unterminated inline array" error

**Root Cause**: Multi-line environment variables not allowed in TOML

**Solution**:
- Keep environment variables on single line
- Or set in Netlify Dashboard instead of netlify.toml

---

### 6. TypeScript Import Order
**Rule**: Follow this order:
1. React imports (useState, useEffect)
2. External libraries (clsx, swr)
3. Internal @/lib imports
4. Local imports

---

### 7. Switch Case Scope
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

## Before Every Commit Checklist

- [ ] Read Lessons.md
- [ ] Apply all relevant rules
- [ ] Check Prisma configuration (adapter vs accelerateUrl)
- [ ] Verify dependencies in package.json
- [ ] Test build locally (`npm run quickbuild`)
- [ ] Check for console.log in critical paths (debugging)
- [ ] Update Primer.md with session summary
- [ ] Update agent--memory.md with activity

---

## Common Mistakes to Avoid

1. ❌ Using `accelerateUrl` without Prisma Accelerate
2. ❌ Putting type packages in devDependencies for Next.js apps
3. ❌ Setting USE_REMOTE_DB=true without proper remote DB URL
4. ❌ Using localhost in DATABASE_URL for production
5. ❌ Conditional console.log that skips production
6. ❌ TOML multi-line environment variables

---

## Last Updated
2026-03-16

## Update Log
- 2026-03-16: Initial rules added based on Netlify 502 fix

