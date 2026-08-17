# Documentation Standards — TradeNext

> Clean, maintainable, useful docs. TradeNext's doc set (root-level files use the `@File.md` convention):
> `@AGENTS.md`, `@README.md`, `@TODO.md`, `@Primer.md`, `@Lessons.md`, `@agent-memory.md`, `@HANDOFF.md` + `.agents/` files.
> Full index + one-liners: `@README.md` → **Documentation** section.

## 1. Documentation Types

| File | Purpose | When to Update |
|------|---------|----------------|
| `@AGENTS.md` | Dev guide + version history | Every change (version entry) |
| `@README.md` | User-facing overview | Major features, setup, credentials |
| `@TODO.md` | Roadmap + quick reference | Every feature/bug fix |
| `@Primer.md` | Session tracking / project status | Start + end of session |
| `@Lessons.md` | Rules & corrections | New discovery/gotcha |
| `@agent-memory.md` | Activity log | End of session / commit |
| `@HANDOFF.md` | Orchestration state | Start + end of session |
| `.agents/session-todos.md` | Current session todos | Before every commit |
| `.agents/sessions/` | Archived sessions | Session completion |
| `.agents/linear-history.md` | Git flow | When workflow changes |
| `.agents/code-hygiene.md` | Code quality rules | When standards change |
| `.agents/security-checklist.md` | Security gate | After auth/schema changes |
| `.agents/pre-commit-workflow.md` | Pre-commit checklist | When checks change |

## 2. Documentation Rules

### Code Comments
```typescript
// ✅ GOOD: Explain WHY
// runInChunks avoids Prisma's 5s interactive $transaction expiry in serverless
await runInChunks(items, 10, fn);

// ❌ BAD: Explain WHAT (redundant)
// Loop over items
for (const item of items) { ... }
```

### Version History (@AGENTS.md)
Every version entry must include:
- Version + date + title
- Bullet points describing each change
- `Files Modified` and `Files Created` lists
- Root cause (for bugs) or feature description (for features)

### Session Archives (.agents/sessions/)
Filename: `YYYY-MM-DD-<commit-hash>.md`. Contains completed session's todos.

## 3. Documentation Updates (MANDATORY)

```
□ After adding a feature     → @AGENTS.md version entry + @TODO.md + @README.md (if user-facing)
□ After fixing a bug         → @AGENTS.md version entry + @Lessons.md (root cause + fix)
□ After a new API endpoint   → @AGENTS.md (route table) + check Swagger/route docs
□ After a new discovery      → @Lessons.md
□ Before every commit        → .agents/session-todos.md (done/carry-forward)
□ Completed session          → archive to .agents/sessions/, update @Primer.md + @agent-memory.md
```

**Rule: If documentation is not updated, the task is NOT complete.**

## 4. Documentation Quality

- **Clear**: simple language, concrete examples
- **Concise**: bullet points over paragraphs, tables over lists
- **Complete**: all features, endpoints, env vars documented
- **Current**: updated with code changes, no stale info, version numbers match

## 5. Documentation Checklist

```
□ @AGENTS.md version history updated (date + what + files)
□ @TODO.md Quick Reference updated
□ @Primer.md Current Project Status + Session History updated
□ @agent-memory.md activity log updated
□ @Lessons.md updated if new discovery
□ @HANDOFF.md orchestration state updated
□ .agents/session-todos.md checked — all done/carried-forward
□ @README.md updated if user-facing change
□ No stale information or outdated examples
```
