# Session Decisions — Skills consolidation + WebMCP + rec/index fixes (2026-11-15)

## D1. Canonical skills location and format
**Decision:** Consolidate all skills into `.agents/skills/<name>/SKILL.md` (format A, optional `references/`) as the single source of truth for humans and all LLMs. Remove `.opencode/skills/*` and duplicate root `.agents/skills/*.md` mirrors.

- *Why:* User approved S1 (“always add skills in `.agents/skills` and rules/commands in `.agents`…”), and mixed locations caused confusion.
- *Impact:* Repo references, agent profiles, commands/rules/docs/matrix/opencode command template updated to `.agents/skills/...`; `nse-integration` canonicalized from richer `.agents` content; `webmcp` added as canonical skill.

## D2. WebMCP integration artifacts
**Decision:** Add `.agents/skills/webmcp/SKILL.md` and `.agents/agents/webmcp-integrator.md` to guide `document.modelContext` tool design/implementation in TradeNext pages (client-only, secure, schema-driven).

- *Why:* User requested WebMCP agent/skill support per webmachinelearning/webmcp.

## D3. Targeted runtime fixes (approved S3)
**Decision:** Keep and validate three lib fixes:
1. `lib/services/dailyRecommendationService.ts` — in performance no-price path, stamp `lastCheckedAt` in SQLite mirror and best-effort Prisma update (guarded by plan-limit breaker, non-fatal) to prevent stale perf state.
2. `lib/index-service.ts` — make `NIFTY TOTAL MARKET`/index resolution fallback/config-aware and cache resolved index metadata to reduce invalid-index 404/stale handling issues.
3. `lib/services/worker/worker-service.ts` — include index-aware error/diagnostic context in market/stock sync paths.

- *Why:* User approved validation of uncommitted fixes for stale Daily Recommendations/Swing/Performance and `NIFTY TOTAL MARKET` symptoms.

## D4. Agent/rule/command/orchestration optimization
**Decision:** Update agent profiles, `.agents/rules/session-memory-rules.md`, `.agents/commands/orchestrate.md`, `.agents/rules/README.md`, and `AGENT-SKILL-MATRIX.md` to emphasize canonical `.agents` skills, file-based resume/continuation, bounded handoffs, and Tier A/B orchestration health.

## D5. Prod DB diagnostics (S2)
**Decision:** Attempt minimal Prisma-Remote read-only diagnostics for reported prod symptoms, but do not block commit/push if approval/tool access is unavailable; record blocker and stay within ops budget constraints.

- *Status:* Blocked in-session (Prisma-Remote approval required earlier; tool not available in catalog at retry time). No prod data mutated.

## Approvals/requests
- User: “approve all” and “once done test, update docs, and then use the required skills to test and update all and then commit and push and update the PR”. Commits/push/PR update performed per explicit request.
