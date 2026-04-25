# Codeburn — AI Token Usage Tracker

**Source:** /Users/morteza/Desktop/tools/codeburn  
**Category:** Developer Tool  
**Role in Monobrain:** Token usage tracking and cost visualization via `token-tracker.cjs` + `monobrain tokens` CLI

---

## What It Is

Codeburn is an AI coding cost tracker that reads Claude Code session files (JSONL) directly from disk, parses token usage, calculates API costs using LiteLLM pricing, and renders an Ink/React terminal dashboard.

Data pipeline:
```
~/.claude/projects/**/*.jsonl → Parser → Classifier → SessionSummary → ProjectSummary[] → TUI
```

Key capabilities:
- **JSONL parsing**: Reads Claude Code's native session format (assistant/user message entries with `usage` field)
- **13-category activity classifier**: Deterministic keyword + tool-use classification (coding, debugging, feature, refactoring, testing, exploration, planning, delegation, git, build/deploy, conversation, brainstorming, general)
- **Cost calculation**: `multiplier × (inputTokens × in + outputTokens × out + cacheWrite × cw + cacheRead × cr + webSearch × $0.01)`
- **Deduplication**: `seenMsgIds` set prevents double-counting subagent chains
- **Provider plugins**: Claude Code, Claude Desktop — each with `discoverSessions()` + `createSessionParser()`

## What We Extracted

### `token-tracker.cjs` (`.claude/helpers/`)

A CJS port of codeburn's entire pipeline, adapted for monobrain's runtime constraints (pure built-ins, no Ink/React):

**Pricing**: Hardcoded fallback table for all Claude/GPT/Gemini models with `fastMultiplier=6` for Opus fast mode

**Parser**: Synchronous `parseSessionFile()` reads JSONL, deduplicates by `msg.id`, groups entries into turns (user → N assistant API calls), builds session summary with:
- Per-model breakdown (calls, cost, tokens)
- Per-category breakdown (turns, cost)
- Per-tool breakdown (calls)
- Per-MCP-server breakdown (calls)
- Daily cost aggregation

**Classifier**: `classifyTurn()` — first checks tools (edit=coding/feature/refactoring/debugging, bash=testing/git/build, plan=planning, agent=delegation), then falls back to keyword patterns

**`quickSummary()`**: Called at `session-restore`, scans only current UTC month's sessions, returns single line:
```
[TOKEN_USAGE] Today: $10.21 (246 calls)  |  Month: $2242.00 (39162 calls)
```

**`renderDashboard(period)`**: Full ANSI dashboard with 6 panels:
1. Overview (total cost, tokens, cache efficiency)
2. Projects (horizontal bars, sorted by cost)
3. Models + Activity (side-by-side on wide terminals)
4. Daily Spend chart (block characters, last 14 days)
5. Top Tools + MCP Servers (side-by-side)

**`runInteractive()`**: Keyboard-driven dashboard (1234=periods, r=refresh, q=quit) using raw TTY mode

**Important UTC fix**: JSONL timestamps are in UTC ISO format. Date comparisons must use `Date.UTC()` or `now.toISOString().slice(0,10)` — not `new Date(year, month, day).toISOString()` which gives the wrong UTC date for non-UTC timezones.

### Hook Integration

Wired at `session-restore` in `hook-handler.cjs`:
```javascript
try {
  var tokenTracker = require('./token-tracker.cjs');
  var tokenSummary = tokenTracker.quickSummary();
  if (tokenSummary) { console.log(tokenSummary); }
} catch (e) { /* non-fatal */ }
```

This injects today/month costs into every session context automatically.

### `monobrain tokens` CLI Command

Three subcommands:
- `monobrain tokens dashboard [--period today|week|30days|month]` — interactive TUI dashboard
- `monobrain tokens summary [--period] [--json]` — text or JSON summary
- `monobrain tokens today` — quick one-line cost check

## How It Improved Monobrain

Codeburn addressed a fundamental blind spot: agents had no awareness of how much they were costing. Now every session starts with token usage context, enabling:

1. **Cost awareness**: The `[TOKEN_USAGE]` line in session-restore context lets Claude see today's and month's spend before starting work
2. **Activity insight**: The 13-category classifier shows where time/cost is being spent (debugging vs. feature work vs. exploration)
3. **Model efficiency**: The per-model breakdown reveals when expensive models are being used for simple tasks
4. **Cache effectiveness**: Cache efficiency % shows how well prompt caching is working
5. **Project cost attribution**: Per-project breakdown identifies which codebases consume the most API budget

## Key Files Influenced

- `.claude/helpers/token-tracker.cjs` — core parser, cost calculator, classifier, ANSI dashboard
- `.claude/helpers/hook-handler.cjs` — `session-restore` handler calls `quickSummary()`
- `packages/@monobrain/cli/src/commands/tokens.ts` — TypeScript CLI command source
- `packages/@monobrain/cli/dist/src/commands/tokens.js` — pre-compiled JS for CLI runtime
- `packages/@monobrain/cli/src/commands/index.ts` — `tokens` registered in command loader
