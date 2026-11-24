# gh learnings (append when new)

- gh is authenticated (luckyhegde6, token with `repo` scope) — verified via `gh auth status`.
- `gh pr create --title X --body-file F` works when F exists (created via `write` tool; deleted after with `del`).
- `gh pr create` sometimes exits 1 silently — retry with `--web` or create via the web URL: https://github.com/luckyhegde6/TradeNext/pull/new/<branch>.
- PRs created: #166 (new-pure-decision-engine, f8a1dd8); check live via `gh pr view --json url,state`.
