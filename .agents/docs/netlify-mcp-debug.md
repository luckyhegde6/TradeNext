# Netlify MCP + Deploy Debugging — Reference (Spec 44-adjacent)

> Netlify MCP understanding (from [Netlify docs — Agent setup overview, MCP Server support](https://docs.netlify.com/build/build-with-ai/agent-setup-guides/agent-setup-overview/#mcp-server-support)) plus the deploy-debugging playbook used on 2026-11-21 for the TradeNext site. Read-only by design (all probes used).

## Netlify MCP — what it is

- **Purpose:** "Connect to Netlify's remote MCP server to equip your agent with the best of Netlify expertise and the Netlify CLI."
- **Remote (recommended, most current):** `npx -y add-mcp https://mcp.netlify.com/mcp` — click-install links exist for Cursor/VS Code/VS Code Insiders/LM Studio. Previous URL `https://netlify-mcp.netlify.app/mcp` still works (redirects).
- **Local:** `npx -y add-mcp "npx -y @netlify/mcp"`.
- **Agent setup CLI:** `npx netlify@latest init` — signs you in, installs Netlify agent skills, adds the MCP for the agents it finds, and links the folder to a project.
- **Agent skills:** `npx skills add netlify/context-and-tools --skill '*' --yes` — highlights: netlify-functions, netlify-edge-functions, netlify-blobs, netlify-db, netlify-image-cdn, netlify-forms, netlify-config, netlify-cli-and-deploy, netlify-deploy, netlify-frameworks, netlify-caching, netlify-ai-gateway.
- **netlify.toml schema:** point agents at `https://open-api.netlify.com/netlify.schema.json` (add `"$schema"` key) so they write valid config.

## Netlify MCP tools used in this session (2026-11-21)

| Tool (namespace `netlify`) | Operation | Purpose |
|---|---|---|
| `netlify-user-services-reader` | `get-user` | user id, teams, connected accounts (auth check) |
| `netlify-team-services-reader` | `get-teams`, `get-team` | team `luckyheghe6` (id `6010eb88e426f495a30364e8`) |
| `netlify-project-services-reader` | `get-projects` | site **TradeNext** id `78401e5d-b137-4b6d-94bb-ad1ec8de6b05`, name `tradenext6`, plan `nf_team_dev`, URL `https://tradenext6.netlify.app` |
| `netlify-project-services-reader` | `get-project` | project details (current deploy info) |
| `netlify-deploy-services-reader` | `get-deploy` / `get-deploy-for-site` | deploy details by id |

## Deploy / build debugging playbook (2026-11-21, TradeNext)

Tooling: `npx netlify --help` (CLI v24.2.0), `npx netlify api --list` (Netlify REST API method table via open-api.netlify.com), `npx netlify status`, `npx netlify logs:deploy` (streams logs of **active** builds — prints "No active builds" once a deploy has ended), `npx netlify logs:function`.

| Step | Command | Notes |
|---|---|---|
| Status (linked site) | `npx netlify status` | project/URL/env — no deploy state |
| Deploy list | `npx netlify api listSiteDeploys --data {"site_id":"78401e5d-b137-4b6d-94bb-ad1ec8de6b05"}` | newest deploy = production candidate; also `listSiteBuilds`, `getDeploy`, `getSiteDeploy` |
| Deploy detail (MCP) | `get-deploy-for-site {siteId, deployId}` | status, error_message, available_functions, summary |
| Active build logs | `npx netlify logs:deploy` | live tail; "No active builds" when none running |
| Local build log | `npx netlify logs:function` | function logs |
| Create deploy | `npx netlify deploy` / `npx netlify deploy --draft` | (write — requires explicit intent) |

**Findings (TradeNext, 2026-11-21):**
- Newest deploy `6b016da66c3283fcc534f726` (PR #164 merge, commit `d251258a`): state **error**, `error_message: "Failed during stage 'building site': Build script returned non-zero exit code: 2"` — created 10:08:38Z, updated 10:13:07Z. Not in progress — already ended in error.
- Production still serves the old ready deploy `6aef7712780133b526dae9fc` (published 2026-11-07, state ready).
- **Root cause of the exit-2 build failure:** build script line 1 = `npx prisma migrate deploy` — the deploy environment has the **local CLI at `8.0.0-rc.34`** while the repo is Prisma 7 — verified read-only: `npx prisma migrate status` → `[CLI.V7_COMMAND]` ("not available in Prisma 8"), exit code 2. (The function-upload 400 in the original paste — `worker-runner-background` "could not parse form file: http: request body too large" — was fixed on `fix/netlify-worker-runner-function-size` with `[functions] node_bundler = "esbuild"`; that deploy (`6b016da6`) no longer reports the 400, only the build exit-2.)
- Remediation paths: pin the Prisma CLI used in the build (`npx prisma7@7 migrate deploy`? — per the CLI.V7_COMMAND hint, `@prisma/prisma7@7` + `prisma7` alias), or complete the Spec 44 Prisma 8 migration (doc: `.agents/specs/44-prisma-8-upgrade.md`).

## Caveats

- All probing above was read-only (`api --list`, `api listSiteDeploys`, `logs:deploy`, MCP readers). No deploys, no writes.
- The production deploy state changes over time — re-run `listSiteDeploys` (or the MCP `get-deploy-for-site`) for the latest.
- When in doubt, the Netlify dashboard for the site (`https://app.netlify.com/projects/tradenext6`) shows the same data (deploys, logs, functions).
