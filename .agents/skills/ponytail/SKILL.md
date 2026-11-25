---
name: ponytail
description: Minimal-code style — the smallest implementation that satisfies the ask, no speculative features.
---

# ponytail — Minimal Code

Source: https://github.com/DietrichGebert/ponytail — see `ponytail-review/SKILL.md` (installed copy: `.agents/skills/ponytail/SKILL.md`).

Review a change like the senior developer who will be paged when it breaks. Order of importance: correct, safe, holds under load, tested, fast, lean.

Look for: bugs (wrong result, missed edge cases), risk (security holes, data loss), scale, missing tests, speed, lean (dead code, speculative features, reuse existing helpers).

Output: findings with a concrete case + smallest fix; `Verdict: Ship.` or what to fix first.
