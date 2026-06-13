# Monomind Improver — Foundation

## Mission
Continuously find and implement improvements to the Monomind system. Each cycle:
1. Analyze the codebase for the highest-value improvement not yet done
2. Implement it
3. Review and commit to `improve/auto` branch
4. Wait 60 seconds, then repeat

## Branch
All improvements are committed to `improve/auto`. The branch is rebased onto `main` each cycle to stay current.

## Completed Improvements Log
_(The boss appends one line here after each successful commit so future cycles don't repeat the same work)_

<!-- FORMAT: - [YYYY-MM-DD HH:MM] <commit-hash-short> — <what was improved> -->
- [2026-06-14 00:00] 0a1b7b80 — fix(collector): add missing claude-opus-4-5 pricing entry to _TOK_PRICES; was falling back to sonnet default causing ~40% cost underreporting in Tokens view
- [2026-06-14 00:01] 09687954 — fix(server): rename stale mcp__monobrain__ prefix to mcp__monomind__ in categorizeTool/buildToolLabel/TOOL_CAT; memory MCP calls were falling through to generic 'mcp'/'other' category making them invisible in session timeline and Agent Graph
- [2026-06-14 00:02] 78f0a31a — fix(server): compute session cost in /api/graph from message.usage via _sjCalcCost(), not the nonexistent e.costUSD field; was causing all Agent Graph session nodes to show cost: 0
- [2026-06-14 00:03] 49cf64e1 — fix(ui): resolve shorthand model aliases ('haiku','opus','sonnet') in _sjGetPricing() and _tokPrice(); server returned null (cost $0) and collector used wrong sonnet rates — 155 cost-bearing turns affected across project sessions
- [2026-06-14 00:04] debbc635 — fix(server): correct 7-day cutoff in /api/org/:name/health success-rate calc; ev.ts is numeric ms but cutoff was ISO string, causing number<string comparison to yield NaN→false so ALL historical events counted instead of only 7-day window

## Off-Limits (do not re-implement)
- Nothing yet

## Focus Areas (in priority order)
1. Bug fixes — things that are broken or produce errors
2. UX improvements — dashboard, loops, orgs views
3. Performance — server response times, large JSONL parsing
4. Missing features — gaps between what's documented and what's implemented
5. Tech debt — dist/src parity, dead code, inconsistent patterns

## Conventions
- Always read a file before editing it
- Use `git add -f` for `dist/` files (gitignored)
- Commit message format: `fix(area): description` or `feat(area): description`
- Co-Authored-By: nokhodian <nokhodian@gmail.com>
- Never commit secrets, credentials, or .env files
- Stay on `improve/auto` — never push to `main` directly
