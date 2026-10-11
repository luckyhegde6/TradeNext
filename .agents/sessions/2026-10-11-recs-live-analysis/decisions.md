# Session Decisions — 2026-10-11 — Recommendations "no proper results" live analysis

Branch: `fix/daily-rec-swing-cron-worker` (PR #135 open, 8/9 checks green — test job red from the uncommitted e2e rescan rewrite).

## D1 — Live-verified the failure before touching code
- **Decision**: Observe `https://tradenext6.netlify.app/recommendations` with Playwright (rendered DOM) AND query the public APIs (`/api/recommendations`, `/api/recommendations/history`) before proposing any fix.
- **Findings (all confirmed, 2026-10-11**)**:
  - Page header: **"Last updated: 4/9/2026, 2:50:52 pm"** — a full month stale.
  - Stats: **100 Total / 0 Buy / 100 Hold / 0 Sell**; "showing 0 after filters"; HOLDs collapsed banner "stored in History & Performance".
  - `/api/recommendations` → `run: {id:"347d6887-1139-4620-ab47-0940882b4109", runDate:"2026-09-04T09:20:52.065Z", status:"failed", totalScreeners:7, uniqueStocks:100, aiProcessed:0, executionTimeMs:null}` — the ONLY run returned is a **failed run from 2026-09-04 with `aiProcessed:0`** (AI stage never completed → every stock collapsed to HOLD, no Buy/Sell).
  - `/api/recommendations/history` → same single failed run; 100 stocks with screener attribution present (BSE first).
- **Reason**: The UI shows stale/failed state but that alone can't tell whether the read path (mirror fallback) or the write path (run producer) is broken. API + DOM together pin it: **the data we have IS the failed run** — the question is why no new run has succeeded in 30 days.

## D2 — Log evidence: the producer side is broken (Netlify can't reach Prisma Accelerate)
- **Decision**: Correlate the live 24-h log dump the user supplied with the run contract.
- **Findings (recurring, multiple instances)**:
  - `Stale recommendation-run reap failed, error=Unable to connect to the Accelerate API. This may be due to a network or DNS issue...` — **Accelerate (Prisma) unreachable from Netlify**; the stale-run reaper can't even connect.
  - `Intelligence cache restored from DB, count=0` — AI intelligence cache empty at boot (consistent with `aiProcessed:0`).
  - `Scheduled/Daily Recommendations (System) expression=30 4 * * 1-5` nextRun `2026-10-12T04:30:00Z` — weekday-only 10:00 IST cron; a weekend page view therefore has nothing NEW since the last weekday attempt.
  - `SQLite: mirror Blobs upload failed (fail-open) ... RequestTimeout` — secondary flakiness; mirror still serves reads.
- **Reason**: The chronological chain is: Sept 4 run started → screeners produced 100 stocks → **AI stage died (aiProcessed:0)** → run marked `failed` → every later attempt either failed at the same Accelerate connectivity step or the reaper killed it. On a weekend (no weekday cron fire) the page shows the last failed run forever.

## D3 — Scope of this session = document + todos only (NO code yet)
- **Decision**: Per user directive ("check analyse and add / update session and current todos for fixing workers and jobs and result and sheets update") this session writes the analysis + session docs + current-todo entries. No fix implementation without a spec + plan + approval (spec-driven gate).
- **Fix candidates to track (not yet specced)**: (a) Accelerate connectivity from Netlify (env/DATABASE_URL or fallback to mirror-first read on the recommendations API); (b) AI stage failure → run should still emit `aiProcessed>0` or a clear "AI unavailable" state instead of 100 HOLDs; (c) cron weekday-only means a weekend view is inherently stale — consider weekend catch-up or last-successful-date surfaced in UI; (d) Google Sheets (separate thread, Specs 19-27) — the OAuth refresh token/stale env is still open on the prod console.