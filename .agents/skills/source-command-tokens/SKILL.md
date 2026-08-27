---
name: "source-command-tokens"
description: "Show the Monomind token usage dashboard — reports spend and call counts for today, week, 30days, or month"
---

# source-command-tokens

Use this skill when the user asks to run the migrated source command `tokens`.

## Command Template

Show the Monomind token usage dashboard for the requested period.

Run this shell command immediately without asking for confirmation:

```bash
node "${CLAUDE_PROJECT_DIR:-$(pwd)}/.Codex/helpers/token-tracker.cjs" report "${1:-today}"
```

Valid periods: `today` (default), `week`, `30days`, `month`.

Examples: `/tokens`, `/tokens week`, `/tokens month`

After running, show the full output verbatim. No other commentary needed.
