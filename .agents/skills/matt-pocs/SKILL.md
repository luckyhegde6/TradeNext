---
name: matt-pocs
description: Build + verify small POC spikes (onnxruntime-node, export scripts) with SMOKE + timing, record VERDICT.md, gate deploy on verdict.
---

# matt-pocs — POC Spikes

Workflow for time-boxed experiments (model exports, new runtimes, deploy changes):
1. Time-box: e.g., 2h; stop on first successful run of the core path.
2. Deliverables: working smoke script + results (`smoke.mjs`, `results.json`), `VERDICT.md` (status, timing, memory, next steps), root cause if it fails.
3. Gate: "deploy" only after VERDICT says verified.
4. Budget: small iterations; a 2nd failed attempt → change method or stop + document.
