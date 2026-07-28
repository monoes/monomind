# Hooks System

> Monomind's hook system intercepts Claude Code lifecycle events, routes tasks, records patterns, runs background workers, and injects context into every conversation. All hooks run as CJS files — no compilation required for the core runtime.

---

## Architecture

```
Claude Code event (JSON via stdin)
          ↓
.claude/helpers/hook-handler.cjs  ← Central dispatcher
  ├── router.cjs                  ← Routing decisions (4-tier waterfall)
  ├── session.cjs                 ← Session state
  ├── memory.cjs                  ← KV store
  ├── intelligence.cjs            ← Pattern matching + context injection
  ├── learning-service.mjs        ← SQLite-backed learning (singleton)
  ├── utils/telemetry.cjs         ← Budget tracking, hook latency
  ├── utils/monograph.cjs         ← Knowledge graph integration
  └── utils/micro-agents.cjs      ← MicroAgent trigger scanning
          ↓
@monoes/hooks (TypeScript, ESM)  ← Full hook registry + workers
```

All async operations use a 1500ms timeout guard (`runWithTimeout`) to prevent blocking Claude.

**Bridge mechanism — dynamic import, not a copy or symlink.** Each hook event fires a fresh `node` process running `.claude/helpers/hook-handler.cjs`; that process lazily does `await import('@monoes/hooks')` (`_ensureHooksModule()`), falling back to a direct `packages/@monomind/hooks/dist/workers/*.js` import in the dev repo since the bare specifier doesn't resolve from `.claude/helpers`'s location. **If the `@monoes/hooks` package isn't built, the import fails and the hook silently no-ops** — this is the first thing to check when hooks/workers appear to do nothing. This is separate from the "helper self-heal" mechanism (`session-restore-handler.cjs`), which sha256-hashes bundled vs. local `.claude/helpers/*` files and atomically overwrites drifted ones to keep the npm-bundled helper copy in sync — that mechanism is explicitly skipped inside the monomind dev repo itself and has nothing to do with the `@monoes/hooks` bridge.

---

## Claude Code Events Handled

### `SessionStart` → `session-restore`

Runs 8 sequential phases at the start of every session:

| Phase | Operation | Output |
|---|---|---|
| 1 | `session.restore()` | Restores `current.json` |
| 2 | `intelligence.init()` | Loads patterns from `patterns.json`, deduplicates |
| 3 | Init 15 background workers | Metrics workers refresh if output is missing or older than 6 hours |
| 4 | Knowledge base preload | CLAUDE.md + docs chunked → `[KNOWLEDGE_PRELOADED]` |
| 5 | Shared instructions | `.agents/shared_instructions.md` → `[SHARED_INSTRUCTIONS]` |
| 6 | Memory Palace wakeUp | identity.md + top-5 drawers → `[MEMORY_PALACE_L0/L1]` |
| 7 | Token usage summary | Scan JSONL → `[TOKEN_USAGE]` |
| 8 | MicroAgent trigger cache | `.claude/agents/**/*.md` patterns cached |

### `UserPromptSubmit` → `route`

Runs for every user message. Four-phase routing:

1. **Simple command detection** — trivial prompts skip full routing
2. **Intelligence context** — top-5 memory entries via Jaccard scoring → `[INTELLIGENCE]`
3. **Keyword/pattern routing** — `router.cjs`'s `routeTask()`, a 4-tier waterfall over regex `TASK_PATTERNS` + domain keyword arrays → primary recommendation panel. This is **not** semantic routing — `router.cjs` sets `semanticRouting: false` on every return path (including the default fallthrough) and never imports `@monoes/routing`/`RouteLayer` or any embedding library; it's a separate CJS reimplementation of the same keyword-only approach as the CLI's `createKeywordRouter` stub. Real embedding-based semantic routing is opt-in only — see Environment Variables/MCP Tools below.
4. **MicroAgent trigger scan** — regex match against cached agent triggers

Output: routing panels injected as system context.

### `PreToolUse(Bash)` → `pre-bash`

Safety validation — blocks dangerous patterns:
- `rm -rf /`, `format c:`, `dd if=/dev/zero`, fork bombs
- Returns `{action: "block", reason}` to Claude Code

### `PostToolUse(Write|Edit|MultiEdit)` → `post-edit`

Calls `intelligence.recordEdit(file)` — appends to `pending-insights.jsonl` for later consolidation.

### `TeammateIdle / TaskCompleted` → `post-task`

1. `memory-palace.storeVerbatim()` — chunks task content → `drawers.jsonl`
2. Routing pattern save

### `SessionEnd` → `session-end`

1. `intelligence.consolidate()` — clears `pending-insights.jsonl`
2. `session.end()` — archives `current.json` → `session-{id}.json`
3. Memory Palace archive — session-end marker + KG triple

---

## Internal Hook Events (20)

> **These are a different mechanism from the CLI Subcommands below.** Hook *events* are typed `HookEvent` enum members processed by the `HookRegistry`/`HookExecutor` in `@monoes/hooks` (pre-edit, post-edit, session-start, etc.). The `hooks` CLI *subcommands* documented further down (`route`, `explain`, `pretrain`, `intelligence`, `transfer`, `worker`, ...) are separate CLI entry points implemented in `packages/@monomind/cli/src/commands/hooks-*.ts` and `neural-core.ts` — none of them are `HookEvent` enum members. Docs and prompts should not conflate the two.

Defined in `packages/@monomind/hooks/src/types.ts`:

| Event | Internal name | Description |
|---|---|---|
| `PreToolUse` | `pre-tool-use` | Before any tool executes |
| `PostToolUse` | `post-tool-use` | After any tool executes |
| `PreEdit` | `pre-edit` | Before file write/modify/delete |
| `PostEdit` | `post-edit` | After file write/modify/delete |
| `PreRead` | `pre-read` | Before file read |
| `PostRead` | `post-read` | After file read |
| `PreCommand` | `pre-command` | Before bash command |
| `PostCommand` | `post-command` | After bash command |
| `PreTask` | `pre-task` | Before task registration |
| `PostTask` | `post-task` | After task completion |
| `TaskProgress` | `task-progress` | During task execution |
| `SessionStart` | `session-start` | Session begins |
| `SessionEnd` | `session-end` | Session ends |
| `SessionRestore` | `session-restore` | Previous session restored |
| `AgentSpawn` | `agent-spawn` | Agent created |
| `AgentTerminate` | `agent-terminate` | Agent destroyed |
| `PreRoute` | `pre-route` | Before routing decision |
| `PostRoute` | `post-route` | After routing decision |
| `PatternLearned` | `pattern-learned` | New pattern stored |
| `PatternConsolidated` | `pattern-consolidated` | Patterns deduplicated |

### Hook Priority Levels

| Priority | Value | Use |
|---|---|---|
| Critical | 1000 | Security, validation — runs first |
| High | 100 | Pre-processing, preparation |
| Normal | 50 | Standard hooks |
| Low | 10 | Logging, metrics |
| Background | 1 | Async operations — runs last |

---

## Background Workers (15)

There is no separate background daemon. All 15 workers live in `@monoes/hooks` (`WorkerManager`), run in-process, and are initialized at session start — 14 come from the static `WORKER_CONFIGS` map, plus `progress`, which is always-on and registered separately (see table). The metrics-producing workers (`map`, `audit`, `optimize`, `consolidate`, `ddd`) refresh automatically when their output file under `.monomind/metrics/` is missing or older than 6 hours; `ddd` runs unconditionally every session start (`always: true`), the other four only when stale; `doctor` reports worker-metrics freshness.

| Worker | Interval | Priority | Purpose |
|---|---|---|---|
| `performance` | 5 min | Normal | Benchmark search, memory, startup; measures heap, CPU, codebase lines |
| `health` | 5 min | High | Monitor disk, memory, CPU, uptime, load average |
| `patterns` | 15 min | Normal | Consolidate, deduplicate, optimize learned patterns |
| `ddd` | 10 min | Low | Track DDD domain implementation progress → `.monomind/metrics/ddd-progress.json` |
| `adr` | 15 min | Low | Check ADR compliance (ADR-001 through ADR-012) |
| `security` | 30 min | High | Scan for secrets, vulnerabilities, insecure patterns |
| `learning` | 30 min | Normal | Outcome/trajectory logging and pattern consolidation |
| `cache` | 1 hour | Background | Clean `.monomind/cache` and `.monomind/temp`, files older than 7 days |
| `git` | 5 min | Normal | Track uncommitted changes, branch, staged/modified counts |
| `swarm` | 1 min | High | Monitor swarm activity and queue pending agent messages |
| `progress` | 1 min (default) | Normal | Always-on; writes `.monomind/metrics/v1-progress.json`. Registered dynamically via a fallback path — it is the one worker **not** present in the static `WORKER_CONFIGS` map, which is why some docs undercount at 14. |
| `map` | 6 hours | Normal | Codebase mapping → `.monomind/metrics/codebase-map.json` |
| `audit` | 6 hours | High | Security audit → `.monomind/metrics/security-audit.json` |
| `optimize` | 6 hours | Normal | Performance snapshot → `.monomind/metrics/performance.json` |
| `consolidate` | 6 hours | Low | Memory consolidation → `.monomind/metrics/consolidation.json` |

```bash
monomind hooks worker list        # list all workers and status
monomind hooks worker run <name>  # run a worker on demand
```

---

## CLI Subcommands (29)

> These are `monomind hooks <subcommand>` CLI entry points (`packages/@monomind/cli/src/commands/hooks.ts`, confirmed 29-entry `subcommands` array) — a different mechanism from the "Internal Hook Events" above. None of the names below are `HookEvent` enum members.

### Lifecycle hooks (8)
```bash
monomind hooks pre-edit      # Context and suggestions before editing
monomind hooks post-edit     # Record edit outcome for learning
monomind hooks pre-command   # Before bash command
monomind hooks post-command  # After bash command
monomind hooks pre-task      # Register task start, get model routing
monomind hooks post-task     # Record task completion
monomind hooks session-end   # End session, persist state
monomind hooks session-restore  # Restore previous session
```

### Intelligence & routing (7)
```bash
monomind hooks route           # Route a task to optimal agent
monomind hooks explain         # Explain routing decision
monomind hooks pretrain        # Run the 4-step learning pipeline
monomind hooks build-agents    # Build agent roster from patterns
monomind hooks metrics         # Show hook execution metrics
monomind hooks transfer        # Transfer patterns via IPFS
monomind hooks list            # List all registered hooks
```

### Workers & output (4)
```bash
monomind hooks intelligence    # Pattern/trajectory logging (stats, pattern-*, trajectory-*) — nests the former `neural` subcommands (train, status, patterns, predict, optimize, export, list, import)
monomind hooks notify          # Send notification
monomind hooks worker          # Worker management: `worker list`, `worker run <name>`
monomind hooks statusline      # Generate statusline output
```

### Coverage-aware routing (3)
```bash
monomind hooks coverage-route   # Coverage-guided routing
monomind hooks coverage-suggest # Suggest coverage improvements
monomind hooks coverage-gaps    # Show coverage gaps
```

### Model routing — tiny-dancer integration (3)
```bash
monomind hooks model-route     # Model tier routing for a task
monomind hooks model-outcome   # Record model outcome for learning
monomind hooks model-stats     # Show model performance stats
```

### Backward-compatible aliases (4) — deprecated, kept for v2 compatibility
```bash
monomind hooks route-task      # Deprecated alias for `route`
monomind hooks session-start   # Deprecated alias for `session-restore`
monomind hooks pre-bash        # Alias for `pre-command` (Bash-specific matcher)
monomind hooks post-bash       # Alias for `post-command` (Bash-specific matcher)
```

There is no `monomind hooks progress` or `monomind hooks token-optimize` subcommand — both were removed from this doc as unverified against source (`hooks.ts`'s subcommand array has no such entries). Implementation progress is tracked by the `progress` background worker (see below), not a CLI subcommand.

---

## MCP Tools (hooks)

Use these inside Claude Code sessions:

> **Default vs. opt-in routing:** `hooks_route` (and the CLI's bare `monomind route "task"`) uses a lightweight keyword-only stub — fixed 0.75 confidence, 8 hardcoded categories, no embeddings. The real embedding-based semantic router (`@monoes/routing`'s `RouteLayer`: keyword pre-filter → real embedding in an isolated worker process → cosine similarity → Haiku LLM fallback) is opt-in only, reached via `hooks_route_semantic` (or CLI `route semantic` / `agent --task`) — never the default.

```
mcp__monomind__hooks_route                 — route a task description (keyword-only default)
mcp__monomind__hooks_route_semantic        — semantic routing (opt-in, real embeddings via @monoes/routing)
mcp__monomind__hooks_explain               — explain a routing decision
mcp__monomind__hooks_intelligence          — get intelligence context
mcp__monomind__hooks_intelligence_stats    — intelligence statistics
mcp__monomind__hooks_metrics               — hook execution metrics
mcp__monomind__hooks_list                  — list registered hooks
mcp__monomind__hooks_pretrain              — bootstrap intelligence from repo
mcp__monomind__hooks_transfer              — transfer patterns
```

---

## Environment Variables

Confirmed read by hooks/helpers source:

| Variable | Effect |
|---|---|
| `MONOMIND_CONTROL_NO_SPAWN` | Disables spawning the control-plane process |
| `MONOMIND_CONTROL_PORT` | Overrides the control-plane port |
| `MONOMIND_DEBUG` | Verbose hook/helper debug logging |
| `MONOMIND_GRAPH_GATE` | Set to `off` to disable the monograph gate (`.claude/helpers/utils/monograph.cjs`) |
| `MONOMIND_MONOFENCE_GATE` | Set to `off` to disable the monofence threat-scan gate (`.claude/helpers/handlers/gates-handler.cjs`) |

`MONOMIND_LOG_LEVEL` (referenced elsewhere, e.g. `CLAUDE.local.md`) is **not** consumed by this hooks/helpers subsystem's source — it's read by the CLI logger, not the hook dispatch path.

---

## Settings Configuration

Hooks are wired in `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {"command": "node .claude/helpers/hook-handler.cjs session-restore", "timeout": 15000},
      {"command": "node .claude/helpers/auto-memory-hook.mjs import", "timeout": 8000}
    ],
    "UserPromptSubmit": [
      {"command": "node .claude/helpers/hook-handler.cjs route", "timeout": 10000}
    ],
    "PreToolUse": [
      {"matcher": "Bash", "command": "node .claude/helpers/hook-handler.cjs pre-bash", "timeout": 5000}
    ],
    "PostToolUse": [
      {"matcher": "Write|Edit|MultiEdit", "command": "node .claude/helpers/hook-handler.cjs post-edit", "timeout": 10000}
    ],
    "TeammateIdle": [
      {"command": "node .claude/helpers/hook-handler.cjs post-task", "timeout": 5000}
    ],
    "TaskCompleted": [
      {"command": "node .claude/helpers/hook-handler.cjs post-task", "timeout": 5000}
    ],
    "SessionEnd": [
      {"command": "node .claude/helpers/hook-handler.cjs session-end", "timeout": 10000}
    ],
    "Stop": [
      {"command": "node .claude/helpers/auto-memory-hook.mjs sync", "timeout": 10000}
    ]
  }
}
```
