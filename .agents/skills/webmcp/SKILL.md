---
name: webmcp
description: Implement WebMCP (W3C Web Machine Learning CG) tools in TradeNext web pages so in-browser AI agents can discover and invoke page actions via document.modelContext - tool design, registration, schemas, permissions, and security.
metadata:
  audience: agents, developers
  workflow: webmcp-integration
---

# WebMCP Integration Skill

Add WebMCP tool surfaces to TradeNext (Next.js App Router, client components) so browser-integrated AI agents can interact with the app through explicit, schema-described tools instead of fragile UI scraping.

## When to use

- User asks to expose TradeNext features to in-browser AI agents / WebMCP / `document.modelContext` / `navigator.modelContext`.
- Adding agent-actuable actions on pages (screener search, get recommendations, portfolio/watchlist actions, alerts) with human-in-the-loop UI.

## Core API (spec direction)

- **Imperative registration** (primary): `await document.modelContext.registerTool(toolDef, options?)` where `toolDef` includes `name`, `description`, `inputSchema` (JSON Schema), and `async execute(args)` returning structured content/result.
- **Unregister** by aborting the `AbortSignal` passed in options (dynamic lifecycle).
- **Cross-origin/iframe exposure** via `exposedTo` and Permissions Policy `allow="tools"` (only for trusted origins; default to same-origin/top-level).
- **Discovery/invocation by in-page agents**: `getTools()` / `executeTool()` patterns where supported; listen for `toolchange` events for dynamic updates.
- **Declarative `<form>`-based tools** are exploratory (not in current spec) — prefer imperative tools.

> Spec is evolving (W3C Web Machine Learning CG: https://github.com/webmachinelearning/webmcp, https://webmachinelearning.github.io/webmcp/). Verify current API shape against the latest spec/types (`webmcp-types`) before shipping.

## Implementation pattern in TradeNext

1. **Client-only**: register tools from `"use client"` components/hooks after mount; guard with `typeof document !== "undefined" && "modelContext" in document`.
2. **Reuse existing logic**: tool `execute` should call the same client fetchers/services/actions the UI uses (or API routes) — do not duplicate business logic.
3. **Keep UI in sync**: update visible state immediately when a tool mutates page data (cooperative human+agent session).
4. **Dynamic registration**: register only tools relevant to current page/state; abort/unregister on unmount or state change to limit context-window/tool-budget pressure.
5. **Schemas & naming**: single-responsibility tools, precise verbs, descriptive parameter `description` fields, accept raw user-friendly inputs and normalize in `execute`.
6. **Validation & errors**: validate inputs/preconditions in `execute` (schema hints are not enough); return actionable error messages so agents can retry/correct. Handle rate limits/failures gracefully.
7. **Security**: never expose secrets; respect auth/RBAC (do not expose privileged actions to unauthenticated contexts); do not broaden iframe `exposedTo` without explicit need; follow `.agents/security-checklist.md`.
8. **Do not replace backend/MCP**: WebMCP complements server APIs; keep server-side `POST /api/mcp` and app APIs authoritative.

## Example (conceptual)

```ts
"use client";
import { useEffect } from "react";

export function useWebMcpExample() {
  useEffect(() => {
    const mc = (document as any).modelContext;
    if (!mc?.registerTool) return;
    const ac = new AbortController();
    mc.registerTool({
      name: "get_daily_recommendations",
      description: "Returns today's AI stock recommendations (read-only).",
      inputSchema: { type: "object", properties: {} },
      async execute() {
        const res = await fetch("/api/recommendations");
        const data = await res.json();
        return { content: [{ type: "text", text: JSON.stringify(data) }] };
      },
    }, { signal: ac.signal });
    return () => ac.abort();
  }, []);
}
```

## Checklist

- [ ] Client component/hook, feature-detected (`document.modelContext`)
- [ ] Minimal, state-relevant tool set (avoid tool-budget bloat)
- [ ] Accurate name/description/inputSchema; re-register if metadata changes
- [ ] `execute` validates, reuses app logic, syncs UI
- [ ] Auth/permissions respected; no secrets; safe defaults on error
- [ ] Tested with browser agent/Playwright where possible; no console errors
- [ ] Docs updated if user-facing or API/tool surface is added
