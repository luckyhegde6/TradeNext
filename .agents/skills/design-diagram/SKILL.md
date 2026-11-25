---
name: design-diagram
description: Create validated architecture, workflow, sequence, data-flow, and class diagrams as standalone HTML with dark/light themes and motion export. Use when the user asks for a visual of systems, pipelines, schemas, or code structure.
---

# design-diagram — Architecture & Flow Diagrams

Source: https://github.com/cathrynlavery/diagram-design/blob/main/skills/diagram-design/SKILL.md (installed copy: `.agents/skills/design-diagram/SKILL.md`).

Goal: deliver a single self-contained `.html` file (dark + light themes, zoomable, expandable nodes) that renders the requested diagram.

Workflow:
1. Identify scope: system context, data flow, sequence, architecture, class, ERD, timeline.
2. Derive entities + relationships from the repo (read files, grep imports, find deps) — never invent.
3. Write HTML to `.agents/docs/diagrams/<topic>.html` (or user-specified path).
4. Verify: open the file, take a screenshot with Playwright MCP if a browser is up, report the path.

Keep the diagram readable first, accurate second.
