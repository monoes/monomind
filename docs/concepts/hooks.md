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
@monomind/hooks (TypeScript, ESM)  ← Full hook registry + workers
```

All async operations use a 1500ms timeout guard (`runWithTimeout`) to prevent blocking Claude.

---

## Claude Code Events Handled

### `SessionStart` → `session-restore`

Runs 8 sequential phases at the start of every session:

| Phase | Operation | Output |
|---|---|---|
| 1 | `session.restore()` | Restores `current.json` |
| 2 | `intelligence.init()` | Loads patterns, deduplicates |
| 3 | Init 10+ background workers | Workers start their intervals |
| 4 | Knowledge base preload | CLAUDE.md + docs chunked → `[KNOWLEDGE_PRELOADED]` |
| 5 | Shared instructions | `.agents/shared_instructions.md` → `[SHARED_INSTRUCTIONS]` |
| 6 | Memory Palace wakeUp | identity.md + top-5 drawers → `[MEMORY_PALACE_L0/L1]` |
| 7 | Token usage summary | Scan JSONL → `[TOKEN_USAGE]` |
| 8 | MicroAgent trigger cache | `.claude/agents/**/*.md` patterns cached |

### `UserPromptSubmit` → `route`

Runs for every user message. Four-phase routing:

1. **Simple command detection** — trivial prompts skip full routing
2. **Intelligence context** — top-5 memory entries via Jaccard scoring → `[INTELLIGENCE]`
3. **Semantic routing** — 4-tier waterfall → primary recommendation panel
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

## Internal Hook Events (22)

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

## Background Workers (10 core + specialized)

Workers run on fixed intervals during sessions:

### Core Workers (`WORKER_CONFIGS`)

| Worker | Interval | Priority | Purpose |
|---|---|---|---|
| `performance` | 5 min | Normal | Benchmark search, memory, startup; measures heap, CPU, codebase lines |
| `health` | 5 min | High | Monitor disk, memory, CPU, uptime, load average |
| `patterns` | 15 min | Normal | Consolidate, deduplicate, optimize learned patterns |
| `ddd` | 10 min | Low | Track DDD domain implementation progress across @monomind packages |
| `adr` | 15 min | Low | Check ADR compliance (ADR-001 through ADR-012) |
| `security` | 30 min | High | Scan for secrets, vulnerabilities, insecure patterns (7 CVEs tracked) |
| `learning` | 30 min | Normal | Outcome/trajectory logging and pattern consolidation; runs ERL, TextGrad, RAPTOR, forgetting-curve sub-tasks |
| `cache` | 1 hour | Background | Clean `.monomind/cache` and `.monomind/temp`, files older than 7 days |
| `git` | 5 min | Normal | Track uncommitted changes, branch, staged/modified counts |
| `swarm` | 1 min | High | Monitor swarm activity and queue pending agent messages |

### Specialized Workers

| Worker | Purpose |
|---|---|
| `EntityExtractorWorker` | Extracts named-entity KV facts from memory |
| `EntityCleanupWorker` | Prunes stale entity facts |
| `EpisodeBinnerWorker` | Bins episodic memories into time buckets |
| `ERLWorker` | Experiential Reflective Learning (arXiv:2603.24639) |
| `TextGradWorker` | Backward pass via textual gradients (arXiv:2406.07496) |
| `MARWorker` | Multi-Agent Reflexion (arXiv:2512.20845) |
| `RaptorWorker` | Recursive Abstractive Tree Indexing (arXiv:2401.18059) |
| `ForgettingCurveWorker` | Ebbinghaus decay scheduling for pattern replay |
| `SynthesisWorker` | Dynamic agent synthesis |
| `PromptOptimizationWorker` | Few-shot prompt optimization |
| `MapReduceWorker` | Parallel task aggregation |
| `KnowledgeWorker` | Knowledge graph integration |
| `CheckpointWorker` | Interrupt/human-in-the-loop checkpointing |

### Daemons (3)

Initialized by `initializeHooks()`:
- `MetricsDaemon` — collects hook execution metrics to SQLite
- `SwarmMonitorDaemon` — monitors swarm activity
- `HooksLearningDaemon` — triggers pattern learning cycles

---

## CLI Subcommands (27)

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

### Intelligence & routing (8)
```bash
monomind hooks route           # Route a task to optimal agent
monomind hooks explain         # Explain routing decision
monomind hooks pretrain        # Run the 4-step learning pipeline
monomind hooks build-agents    # Build agent roster from patterns
monomind hooks metrics         # Show hook execution metrics
monomind hooks model-route     # Model tier routing for a task
monomind hooks model-outcome   # Record model outcome for learning
monomind hooks model-stats     # Show model performance stats
```

### Coverage & token tools (4)
```bash
monomind hooks coverage-route   # Coverage-guided routing
monomind hooks coverage-suggest # Suggest coverage improvements
monomind hooks coverage-gaps    # Show coverage gaps
monomind hooks token-optimize   # Optimize token usage
```

### Workers & utilities (7)
```bash
monomind hooks worker list      # List all workers and status
monomind hooks intelligence     # Pattern/trajectory logging (stats, pattern-*, trajectory-*)
monomind hooks notify           # Send notification
monomind hooks statusline       # Generate statusline output
monomind hooks list             # List all registered hooks
monomind hooks progress         # Show implementation progress
monomind hooks transfer         # Transfer patterns via IPFS
```

---

## MCP Tools (hooks)

Use these inside Claude Code sessions:

```
mcp__monomind__hooks_pre_task      — register task start, get routing
mcp__monomind__hooks_post_task     — record completion
mcp__monomind__hooks_route         — route a task description
mcp__monomind__hooks_intelligence  — get intelligence context
mcp__monomind__hooks_metrics       — hook execution metrics
mcp__monomind__statusline          — generate statusline
mcp__monomind__model_outcome       — record model outcome
```

---

## Advanced Features

### InterruptCheckpointer (Human-in-the-Loop)

Allows background agents to pause and request human decisions:

```
mcp__monomind__list_pending_checkpoints  — see what needs review
mcp__monomind__approve_checkpoint        — approve and continue
mcp__monomind__reject_checkpoint         — reject and abort
mcp__monomind__get_checkpoint            — get checkpoint details
```

### Distributed Tracing

`TraceStore` + `TraceCollector` track agent spans with `spanId`/`traceId` correlation:

```bash
monomind hooks metrics --traces    # list execution traces
```

### Observability Bus

`ObservabilityBus` with three sinks:
- `CLISink` — terminal output
- `AgentDBSink` — persists to memory
- `OTelSink` — OpenTelemetry export

### Cost Tracking

`CostTracker` + `CostReporter` with `MODEL_PRICING` table:

| Model | in | out | cacheWrite | cacheRead | fastMult |
|---|---|---|---|---|---|
| Opus 4.6 | $5e-6/tok | $25e-6/tok | $6.25e-6/tok | $0.5e-6/tok | 6× |
| Sonnet 4.6 | $3e-6/tok | $15e-6/tok | $3.75e-6/tok | $0.3e-6/tok | 1× |
| Haiku 4.5 | $1e-6/tok | $5e-6/tok | $1.25e-6/tok | $0.1e-6/tok | 1× |

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
