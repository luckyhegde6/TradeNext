# Session Todos

## Current (2026-10-29 — Fix CI security scan: high-severity npm audit failures)
- [x] **Analyze npm audit failures** — deepmerge (high), next (critical), zod (high), nodemailer (moderate), qs (moderate)
- [x] **Update package.json** — zod ^4.3.4 → ^4.6.6, next ^16.3.8 → ^16.4.0, sanitize-html ^2.17.7 → ^2.18.1 (removes deepmerge dep)
- [x] **npm install** — updated lock file, audit now passes (0 high, 0 critical)
- [ ] **Run full test suite** — verify nothing broke
- [ ] **Run tsc** — verify type safety
- [ ] **Commit** — security dependency fixes
- [ ] **Push** — push to branch
- [ ] **PR** — will auto-update PR #137
