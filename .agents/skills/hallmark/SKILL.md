---
name: hallmark
description: High-design, pro-typography HTML page builder (downloads free fonts, wires self-hosting, mobile-first).
---

# hallmark — Pro HTML Pages

Source: https://github.com/nutlope/hallmark (installed copy: `.agents/skills/hallmark/SKILL.md`).

Goal: deliver a single self-contained `.html` file (dark + light themes, zoomable, expandable nodes) that renders the requested diagram/page.

Workflow (summary):
1. Identify scope: architecture, workflow, sequence, data-flow, class, ERD, timeline.
2. Derive entities + relationships from the repo (read files, grep imports, find deps) — never invent.
3. Build to `.agents/docs/diagrams/<topic>.html` (or user-specified path).
4. Verify: open the file, take a screenshot with Playwright MCP if a browser is up, report the path.

Floor rules (no text-all-caps labels, no gradients, focus states, overflow clip, tokens declared at :root, one accent element, etc. — see installed SKILL.md § Floor).

Keep the diagram readable first, accurate second.
