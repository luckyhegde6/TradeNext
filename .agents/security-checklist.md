# Security Checklist — TradeNext

> Run this checklist before EVERY commit and after any auth/schema/API change. Security is not optional.

## Pre-Commit Security Gate

```
□ SECRETS: No hardcoded API keys, tokens, passwords, or secrets
□ ENV: All secrets in .env (gitignored) or environment variables
□ KEYS: No private keys, JWT secrets, or signing keys in code
□ AUTH: API routes use auth() + role check (admin routes admin-only)
□ INPUT: All user inputs validated (Zod schemas)
□ SQL: Parameterized queries only (Prisma — no raw string concatenation)
□ LOGS: No PII or secrets in log output
□ ERRORS: Error messages don't leak internal details
□ CORS: Only known origins allowed
□ DEPENDENCIES: npm audit clean
□ NETLIFY: New files with demo creds added to SECRETS_SCAN_OMIT_PATHS
```

## Detailed Security Checks

### 1. Secrets Management

```bash
# Check for hardcoded secrets
# (pre-commit hook already scans staged changes for this pattern)
git grep -nE "(password|secret|api_key|apiKey|auth_token)\s*[:=]\s*[\"'][A-Za-z0-9_!@#$%^&*()\-=+]{20,}[\"']" -- "*.ts" "*.tsx" "*.js"

# Verify .env is gitignored
git check-ignore .env
```

### 2. Authentication & Authorization

```
□ NextAuth sessions used for user identity (httpOnly, secure, sameSite cookies)
□ /admin/* and /api/admin/* routes protected (role check on server, not client)
□ Middleware is minimal (no NextAuth imports — avoided edge crashes)
□ No user data stored in localStorage (XSS prevention)
□ DB session tracking (UserSession model) — admin can invalidate sessions
```

### 3. Input Validation

```
□ API request bodies validated with Zod schemas (Zod 4)
□ safeInt() / parseInt guards on all numeric query params
□ No raw SQL string interpolation (Prisma parameterized queries)
□ Path traversal protection (sanitizeTaskIdForPath in worker-logger)
```

### 4. Error Handling

```typescript
// ✅ GOOD: Log full error server-side, return generic message
catch (e) {
  logger.error({ msg: 'Fetch failed', error: e instanceof Error ? e.message : String(e) });
  return NextResponse.json({ error: 'Service unavailable' }, { status: 502 });
}

// ❌ BAD: Exposing internal details to the client
catch (e) {
  return NextResponse.json({ error: e.message }); // leaks internals
}
```

### 5. Dependency Security

```bash
npm audit           # Check for known vulnerabilities
npm audit fix       # Fix vulnerable dependencies
```

### 6. Prisma Guardrails

```
□ AI agents CANNOT run destructive commands without explicit user consent
□ Protected: prisma migrate reset --force, prisma db drop
□ Safe: prisma migrate dev, prisma db push, prisma generate
□ Never commit .env or .env.local with real credentials
```

## Security Incident Response

If a security issue is found:

1. **IMMEDIATE**: Rotate compromised credentials
2. **ASSESS**: Determine scope of impact
3. **FIX**: Patch the vulnerability
4. **NOTIFY**: Inform affected users if needed
5. **DOCUMENT**: Add to `@Lessons.md` with prevention steps
6. **PREVENT**: Add test/rule to prevent recurrence

## Security Audit Schedule

| Check             | Frequency           | Tool                     |
| ----------------- | ------------------- | ------------------------ |
| Dependency scan   | Every commit        | npm audit                |
| Secret scan       | Every commit        | Pre-commit hook + git grep |
| Auth review       | Every auth change   | Manual + audit logs      |
| API key rotation  | Quarterly           | Manual                   |
| Penetration test  | Before launch       | External                 |
