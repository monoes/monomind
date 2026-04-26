Show the full Monomind system metrics dashboard: statusline panel + today's token usage breakdown.

Run these two shell commands immediately without asking for confirmation:

```bash
node "${CLAUDE_PROJECT_DIR:-/Users/morteza/Desktop/tools/monomind}/.claude/helpers/statusline.cjs"
echo ""
node "${CLAUDE_PROJECT_DIR:-/Users/morteza/Desktop/tools/monomind}/.claude/helpers/token-tracker.cjs" report today
```

Show the full output verbatim. No other commentary needed.
