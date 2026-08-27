---
name: "source-command-ts"
description: "Toggle the Monomind statusline panel between full (multi-line dashboard) and compact (single-line) mode"
---

# source-command-ts

Use this skill when the user asks to run the migrated source command `ts`.

## Command Template

Toggle the Monomind statusline panel between full (multi-line dashboard) and compact (single-line) mode.

Run this shell command immediately without asking for confirmation:

```bash
node "${CLAUDE_PROJECT_DIR:-$(pwd)}/.Codex/helpers/toggle-statusline.cjs"
```

After running, tell me the new mode in one line (e.g. "Panel -> compact" or "Panel -> full"). No other output needed.
