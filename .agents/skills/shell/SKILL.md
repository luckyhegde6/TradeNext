---
name: shell
description: Windows cmd.exe shell workflow — avoid quoting/pipe traps (missing `grep`/`head`/`tail`/`find`, `;` not a separator, quotes mangling multi-word messages)
---

# shell — Windows cmd.exe Workflow

Environment notes (learned on TradeNext, cmd.exe):
- No `grep`, `head`, `tail`, `ls` in cmd — use the `grep`/`read`/`glob` tools on files, or `dir` for listings.
- `;` is NOT a command separator — use `&` or run calls separately.
- Redirects are flaky (`> file` can append the file as a git arg, mangles quotes with spaces) — prefer plain commands and the `read`/`grep` tools on output files; redirect to a file and `read` it.
- `node -e "..."` with complex/nested quotes fails with "Unterminated string constant" — write small scripts to `C:\Users\lucky\AppData\Local\Temp\opencode\` and run `node script.cjs`.
- `del` prompts "Are you sure (Y/N)?" when no files match — avoid deleting non-existent files.
- Long commands run in background automatically; don't poll — wait for the resume.
- Exit code 1 often means the tool chain, not the command.
- Budget: tokens replenish to 1000K per session; do NOT self-limit.

## Best practices / learnings (self-updating — append when seen)
- The `edit` tool fails with "Could not find oldString ... must match exactly, including whitespace and indentation" — use `read` first to get the exact text (the file may have changed), or use larger context blocks.
- Quoted strings with spaces in `git commit -m "msg with spaces"` get split by the tool — use single-word messages or `-F` file.
- `git commit -m <msg> 2>&1 | grep ...` breaks on the tool — commit plainly, read output separately.

