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
- [2026-06-14 00:05] 249fa1e7 — fix(ui): resolve missing token stats in Memory Usage period view; loadMemUsagePeriod() read s.totalTokensIn/totalTokensOut/todayCost/todayCalls from data.summary which is always undefined for /api/token-usage (flat response shape) — all four chunk-stat cards were permanently hidden
- [2026-06-14 00:06] fadac7f4 — fix(collector): derive todayCost/todayCalls from fresh JSONL dailyMap instead of stale token-summary.json cache; token-summary.json is only updated when telemetry hooks fire so values could be weeks old — fixes topbar cost badge, per-project Tokens view "Today Cost" card, and Global Tokens view all at once
- [2026-06-14 00:07] 5337667b — fix(server): align /api/token-usage response shape with dashboard client; endpoint returned flat fields + dict breakdowns but client expected summary:{} sub-object + array breakdowns (models[], categories[], tools[], mcpServers[], rows[]); Tokens view cards and Memory Usage bar charts were all permanently blank/showing "—"
- [2026-06-14 00:08] 1fbe2fae — fix(collector): derive monthCost/monthCalls from fresh JSONL dailyMap instead of stale token-summary.json; scan window extended back to month start (Math.min of 14-day cutoff and monthStartMs) so all days in billing period are included; Month Total card in topbar and Month Cost card in Tokens view now show correct data
- [2026-06-14 00:09] 0066a2e2 — fix(dashboard): check l.type === 'tillend' for tillend loop detection in _buildLoopRowHtml() and mini-loops panel; server sends field name `type` but both renderers checked the nonexistent `loopType` field — tillend loops never showed ∞ badge or gradient progress bar unless they also lacked maxReps
- [2026-06-14 00:10] 44b12044 — fix(server): emit compactCount and errorCount in /api/session-journal response; JSONL parser never tracked is_error tool_result blocks or derived compactCount from summaries.length, so both the "+N compacted" and "N err" session-list badges in the dashboard were permanently invisible
- [2026-06-14 00:11] f6a5311c — fix(server): send roles array (not length number) in /api/orgs list endpoint; dashboard v2RenderOrgList() checks Array.isArray(o.roles) to build role avatar images but received a number so shownRoles was always [] — all org card avatars were permanently suppressed
- [2026-06-14 00:12] aae231b6 — fix(dashboard): correct v2RenderOrgBudgets field name mismatches; renderer read b.tokens/b.tokenLimit/b.usd/b.usdLimit (non-existent) instead of b.org_budget.limit_tokens/limit_usd; per-agent cost read a.cost instead of a.total_cost_usd and used wrong agents source; budget tab always showed "No budget data" even when budgets.json existed
- [2026-06-14 00:13] e040c46f — fix(dashboard): derive org budget used totals from per-agent spend in v2RenderOrgBudgets; fillBar() was always called with used=0 so token and USD budget bars permanently showed 0% utilization; fixed by summing tokens_used/tokens_in/tokens_out and total_cost_usd across budgetAgents; labels now show "used / limit" instead of just "limit: X"
- [2026-06-14 00:14] c093651c — fix(dashboard): normalise /api/token-usage flat response in setTokPeriod and loadMemUsagePeriod; server returns flat (totalCost, totalCalls, totalIn, totalOut) and object-keyed breakdowns (modelBreakdown, toolBreakdown, categoryBreakdown, mcpBreakdown) but both functions read data.summary (always undefined) and data.models/tools/categories (always undefined arrays); Tokens view period-selector stat cards always showed "—" and Memory Usage breakdown bar charts showed "No data" for every section
- [2026-06-14 00:15] 495c5eea — fix(server): emit summary string in /api/session-journal response; JSONL parser built summaries[] array (compact boundary texts) but never derived the scalar summary field that renderSessRow() reads to show the session summary card — compact summaries were never visible in the sessions list

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

- [2026-06-14 03:20] 26d7c964 — fix(dashboard): renamed "Top Tools" to "Tool Categories" in agent-graph selectAgSession(); the section rendered bar charts of n.toolCounts keys which are TOOL_CAT() categories (file/bash/agent/memory/web/skill/other) not individual tool names — the "Top Tools" heading falsely implied per-tool breakdown