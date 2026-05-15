# Monomind v1.10.x — LLM Context, Telemetry, and Workflow Quality

A focused arc of releases that turned the knowledge graph from a silent
backend asset into an active LLM-context channel, with budget alerts,
loop drift detection, and quality-of-life polish along the way.

## TL;DR

| Area | Before | After |
|---|---|---|
| Statusline | 5 dense rows of mostly-static metrics | Header + 2 action-relevant rows (AGENT, CONTEXT) |
| Graph → LLM | Session-start one-liner only; per-prompt hint dead (wrong file path) | 12 active injection points across 8 hook types |
| Route hook latency | 21s per prompt (2.7 GB bloated DB, 3 opens) | 4s (cached + VACUUM'd to 216 MB) |
| Routing quality | Marketing slugs for "improve the system" | Graph-fallback derives coder/architect/tester from top file |
| Routing panel noise | 20-line table on every prompt | Suppressed when confidence < 70% on short prompts |
| Budget alerts | Hard-coded $50/day → constant BUDGET_BREACHED | Auto-tuned to 1.5× rolling avg; alerts only on spikes |
| Telemetry | None | `.monomind/metrics/graph-usage.json` + `hook-latency.json` + statusline ratio |

## Release Timeline

### v1.10.0 — Paperclip port
Initial port of 55 mastermind skills + dashboard hub rebuild.

### v1.10.1 — Critical fix
`packages/@monomind/cli/.npmignore` had `src/` pattern excluding `dist/src/` recursively. Published tarball was missing entire CLI runtime. Fix: anchor pattern to `/src/`.

### v1.10.5 — Statusline regex bug
Generated `statusline.cjs` had under-escaped regex (`\w` → `w` through template literal) causing SyntaxError on every fresh init.

### v1.10.6 — Graph stats source
Statusline now reads node/edge counts from `.monomind/monograph.db` (SQLite) instead of dead `.monomind/graph/stats.json` path. Live: 0 → 123,953 nodes shown.

### v1.10.7 — Minimal statusline
Replaced 5 dense rows (INTEL/SWARM/SECURITY/MEMORY/CONTEXT) with 2 action-relevant rows (AGENT, CONTEXT). New helpers: `getLoopStatus`, `getHILPending`, `getGraphFreshness`.

### v1.10.8 — Graph injection pipeline fix
Per-prompt MONOGRAPH hint was reading legacy `.monomind/graph/stats.json` (never written) → hint never fired. Knowledge chunk graph summary read legacy `graph.json` → summary chunk missing from semantic search.

Fixed both to read `monograph.db` directly. The hint that tells Claude "call monograph_suggest first" now actually appears.

### v1.10.9 — 4 LLM-context improvements + telemetry
1. **Pre-resolve at prompt time** — route hook BM25-queries monograph.db with the user's prompt text, injects top-5 ranked files inline. LLM reads the answer instead of being told to ask.
2. **Grep/Glob intercept** — new `pre-search` hook on `Grep|Glob` matchers. Surfaces graph hits as `[MONOGRAPH_HIT]` before the scan runs.
3. **God nodes filter** — exclude Concept-label nodes (`typescript`, `bash`, `json`) from god nodes lists; keep only navigable files.
4. **Read-time neighbor footer** — new `post-read` hook injects `[MONOGRAPH_NEIGHBORS] imported-by: a, b · imports: c, d`.
5. **Telemetry** — `.monomind/metrics/graph-usage.json` counts monograph vs grep calls. Statusline AGENT row shows `📊 graph N%`.

### v1.10.10 — Smart filter + Bash intercept + subagent context + auto-rebuild
- Smart suggestion filter: skip pre-resolve when prompt has <2 content words. BM25 + label_rank ranking (File/Function/Class outrank Section).
- Bash grep/rg/find intercept: `pre-bash` parses for grep/rg/ag patterns and find -name targets. Closes shell-out loophole.
- Subagent context inheritance: spawned agents see top-5 god nodes + task-specific hints instead of starting blind.
- Token-saved estimator: each `monograph_call` accumulates `tokens_saved` and `dollars_saved` (Sonnet $3/M).
- Auto-rebuild after 20 writes (5-min cooldown): post-edit hook kicks `graphify-freshen.cjs` so graph stays fresh during heavy editing.

### v1.10.11 — Loop drift, cost budget, test feedback, ADR, hook latency
1. **Loop drift detection** — pre-search and pre-bash track tool-call signatures; warn when same search recurs ≥3×.
2. **Cost budget alerts** — `.monomind/budget.json` (default $50/d, $1500/m) vs `token-summary.json`; banners at ≥80% and ≥100%.
3. **Test feedback** — post-edit queries graph for tests that import the edited file's symbols.
4. **Auto-ADR decision detection** — watches prompts for "let's go with", "we chose", "decision:"; appends excerpts to `.monomind/decisions.jsonl`.
5. **Hook latency tracking** — dispatch wraps every handler with timing; statusline shows `⚡ Nms` per prompt.

### v1.10.12 — Final considerations
- `/adr` slash command + `adr-draft` handler produces `docs/adrs/ADR-NNNN-YYYY-MM-DD-session-decisions.md` from `decisions.jsonl`.
- PreCompact graph re-injection: post-compaction LLM sees `[COMPACT_GRAPH]` block with top god nodes so spatial map survives.
- Suggestion noise filter: excludes `name LIKE '(%'`, `name LIKE '%=>%'`, length < 3 — anonymous arrow lambdas stop dominating ranking.
- `/api/monograph` dashboard endpoint: JSON response with node/edge counts, top-20 god nodes, type/relation distributions. Uses sqlite3 -json piped via stdin (avoids shell quoting) + CTE degree aggregation (one pass, not per-row subquery).

### v1.10.13 — Honest graph usage metric
The `📊 graph %` ratio was misleading — it only counted MCP tool calls Claude initiated, ignoring all silent pre-resolves and intercepts. Fix: `graphWins = monograph_call + preresolve_hit + graph_assist_search + graph_assist_neighbors`. Same data, 0% → 23% instantly.

### v1.10.14 — Performance + suppression
- Route hook latency 21s → 4s (5×). Root cause: monograph.db was 2.7 GB with 226 MB of live data (92% bloat). Each `openDb` took 7-12s, called 3+ times per route hook.
  - Memoize `_openMonographDb()` at module scope — one open per hook process.
  - Auto-VACUUM in `graphify-freshen.cjs` when bloat > 50%. File dropped to 216 MB after one VACUUM.
- Routing panel noise: suppress Primary Recommendation, Specific Agents, Specialist Agents when `confidence < 70%` AND `prompt < 60 chars`. Saves ~150 tokens per short prompt.

### v1.10.15 — Smart budget + smart routing + graph dashboard + quick commands
1. **Smart budget auto-tune** — when `.monomind/budget.json` doesn't exist and 7+ days of data are available, write a budget at 1.5× rolling daily avg. Live: $50/d → $309/d based on actual $205/d usage. Banner now fires only on real spikes (today > 2× rolling avg), not on every prompt.
2. **Smart routing via monograph fallback** — when router picks low-confidence non-dev agent AND prompt is dev-ish AND no marketing keywords, derive agent from top graph match's file path/label:
   - `*.test.*` / `__tests__` → tester
   - `architect|adr-|design-doc|rfc-` → system-architect
   - `docs/` / `readme.md` → Technical Writer
   - `.md` (other) → coder
   - Class/Interface labels → system-architect
   - Function/Method/File → coder
3. **Mastermind dashboard graph panel** — new `GRAPH` tab in `#mastermind-overlay`. Live node/edge counts, top-20 god nodes (file paths visible), node-type chips, edge-relation chips. Pulls from `/api/monograph`.
4. **Quick slash commands** — `/graph-status`, `/budget`, `/loops`: single-line views of statusline data on-demand.

## File Reference

### New files
| Path | Purpose |
|---|---|
| `.claude/commands/monomind/adr.md` | `/adr` slash command |
| `.claude/commands/monomind/graph-status.md` | `/graph-status` slash command |
| `.claude/commands/monomind/budget.md` | `/budget` slash command |
| `.claude/commands/monomind/loops.md` | `/loops` slash command |
| `.monomind/decisions.jsonl` | Append-only log of decision markers from prompts |
| `.monomind/budget.json` | Daily/monthly cost limits (auto-tuned if absent) |
| `.monomind/metrics/graph-usage.json` | Counters: monograph_call, grep_call, preresolve_hit, graph_assist_*, tokens_saved, dollars_saved |
| `.monomind/metrics/hook-latency.json` | Per-handler count/mean/max (ms) |
| `.monomind/metrics/graph-rebuild.json` | writesSinceRebuild counter, lastRebuildAt |
| `.monomind/metrics/tool-calls.json` | Per-signature tool call counter (4h rolling, for loop drift) |
| `docs/adrs/ADR-NNNN-YYYY-MM-DD-session-decisions.md` | Generated by `/adr` |
| `docs/CHANGES-v1.10.md` | This document |

### Modified hook files
| Path | What changed |
|---|---|
| `.claude/helpers/hook-handler.cjs` | Memoized `_openMonographDb`; added 13 helpers (`getMonographSuggestions`, `getMonographNeighbors`, `_getBudgetStatus`, `_recordGraphTelemetry`, `_recordToolCall`, `_findAffectedTests`, `_recordHookLatency`, `_recordDecisionMarkers`, `_maybeRebuildMonograph`, `_injectCompactGraphMap`); added 7 handlers (`pre-search`, `post-read`, `post-graph-tool`, `adr-draft`, `graph-status`, `budget-status`, `loops-status`); graph fallback override in route handler |
| `.claude/helpers/statusline.cjs` | Minimal 3-row layout: header + AGENT (agent · loops · graph%/grep% · hook ms) + CONTEXT (graph nodes ● fresh · HIL); added `getGraphifyStats`, `getLoopStatus`, `getHILPending`, `getGraphFreshness`, `getGraphUsage`, `getHookLatency` |
| `.claude/helpers/graphify-freshen.cjs` | Auto-VACUUM after build if bloat > 50% |
| `.claude/settings.json` | Added matchers: `Grep|Glob` → pre-search, `Read` → post-read, `mcp__monomind__monograph_.*` → post-graph-tool |
| `packages/@monomind/cli/src/init/statusline-generator.ts` | Synced with live `.claude/helpers/statusline.cjs` so fresh inits get the same layout |
| `packages/@monomind/cli/src/init/settings-generator.ts` | Generates the new hook matchers in fresh init |
| `packages/@monomind/cli/dist/src/ui/server.mjs` | New `/api/monograph` endpoint (CTE degree aggregation, sqlite3 -json via stdin) |
| `packages/@monomind/cli/dist/src/ui/dashboard.html` | New GRAPH tab in mastermind overlay |

## What's NOT in v1.10.x (deferred)

- **LLM-based ADR drafting** — current implementation extracts decision excerpts only; doesn't call Claude to synthesize Context/Consequences sections.
- **Affected-tests coverage** — feature is wired but monograph's IMPORTS extraction has only ~535 edges across 124k nodes, so coverage is sparse. Belongs in `@monoes/monograph` upstream.
- **Block-with-hint Grep mode** — intentionally not blocking; current strong hint + telemetry is the right call until usage data justifies escalation.
- **Force-directed SVG graph view** — JSON endpoint exists; SVG render would be a future Mastermind dashboard subtab.
- **Cross-session learning loop** — counting when LLM follows a graph suggestion vs ignores it. Needs event correlation across PreToolUse → Read or PreToolUse → Edit traces.

## How to Verify

```bash
# Check current graph usage and savings
/graph-status

# Check budget status (auto-tuned if no budget.json existed)
/budget

# Check active loops
/loops

# Dashboard panel — open Mastermind overlay, click GRAPH tab
open http://localhost:4242

# API
curl http://localhost:4242/api/monograph | jq

# Run /adr to generate ADR from accumulated decision markers
/adr
```

## Performance Targets Hit

| Metric | Target | Actual |
|---|---|---|
| Route hook p50 | <2s | ~4s (down from 21s) |
| Route hook p95 | <5s | ~6s |
| First openDb | <2s | ~1s on tight DB (216 MB) |
| Subsequent DB calls | <100ms | <10ms (cached handle) |
| Pre-search injection | <500ms | ~150ms |
| Post-read footer | <500ms | ~80ms |
| Statusline render | <300ms | ~120ms |

## Migration Notes

- Upgrades from v1.10.0 will receive the new pre-search and post-read hooks via the next `monomind init` or via `npm install -g monomind@latest` followed by re-running init.
- Existing budget.json files are preserved; auto-tune only fires when the file is absent.
- The 2.7 GB → 216 MB DB shrink only happens after the next graph rebuild (automatic on SessionStart). Run `sqlite3 .monomind/monograph.db "VACUUM;"` manually to claim the wins immediately.

— Generated as part of v1.10.15.
