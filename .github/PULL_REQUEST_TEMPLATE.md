## 🔍 Pre-PR Self-Check (Required)

### Architecture
- [ ] No Prisma usage in client components
- [ ] Business logic moved to `lib/services`
- [ ] External integrations isolated

### API & Swagger
- [ ] All new/changed routes documented in `/api/openapi`
- [ ] Request & response schemas defined
- [ ] Admin routes marked and protected

### Security
- [ ] Admin-only routes protected (NextAuth or ADMIN_KEY)
- [ ] No secrets exposed to client
- [ ] Inputs validated (Zod or equivalent)

### Performance
- [ ] Pagination/limits applied
- [ ] Caching added where appropriate
- [ ] No N+1 queries introduced

### Logging & Observability
- [ ] `lib/logger.ts` used
- [ ] Start, success, and error logged

### UI / UX
- [ ] Loading states present
- [ ] Error & empty states handled
- [ ] Responsive layout verified

### Docs & Readability
- [ ] README updated if behavior changed
- [ ] Code readable without external context

### Interview Readiness
- [ ] Feature can be explained in a system-design interview
- [ ] Trade-offs are clear and defensible

---

🚨 **PRs failing this checklist should not be merged.**
