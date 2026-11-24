---
name: cloudflare-security-audit
description: Static security audit of web-exposed code (forms, serverless, AI calls, CSP) for common vulns; used as a pre-commit/pre-PR check.
---

# cloudflare-security-audit — Pre-commit Vulnerability Audit

Run as a pre-commit or pre-PR check on the diff/changed files:
- Forms: unescaped HTML (XSS), parameterized SQL, no raw SQL on user input.
- Serverless/functions: auth on all routes, no hardcoded secrets, body size limits, no unsafe `eval`/`new Function`, no SSRF (URLs from users), safe content types.
- AI calls: no prompt injection in untrusted input, key isolation (no NEXT_PUBLIC_), timeouts, rate limits.
- Framework: CSP headers (repo has noscript headers — check), CSRF protection.

Output: list of findings (path + severity) and a one-line remediation per item; block commit if any HIGH/MEDIUM found without fix.
