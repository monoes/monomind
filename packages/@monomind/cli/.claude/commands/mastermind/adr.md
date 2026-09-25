---
description: Draft an Architecture Decision Record from accumulated decision markers in this session's prompts
---

Run the hook handler's adr-draft action to scan `.monomind/decisions.jsonl` for the last 7 days of decision markers (e.g. "let's go with X", "we chose Y", "decision: Z") and produce an ADR template in `docs/adrs/`.

```bash
node "$CLAUDE_PROJECT_DIR/.claude/helpers/hook-handler.cjs" adr-draft
```

After running, open the generated `docs/adrs/ADR-NNNN-YYYY-MM-DD-session-decisions.md`, fill in the Context and Consequences sections, and change Status to Accepted/Rejected.
