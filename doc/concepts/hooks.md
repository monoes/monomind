# Hooks System

> Monomind's hook system intercepts Claude Code lifecycle events, routes tasks, records patterns, runs background workers, and injects context into every conversation. All hooks run as CJS files — no compilation required for the core runtime.

---

## Architecture

```
Claude Code event (JSON via stdin)
          ↓
.claude/helpers/hook-handler.cjs  ← Central dispatcher
  ├── handlers/pick-core.cjs      ← [PICK] decision, route records, adherence
  ├── jev-catalog.cjs, pick-rank.cjs ← Agent/skill index + keyword ranker
  ├── pick-stats.cjs              ← Pick outcomes → bounded ranking prior
  ├── router.cjs                  ← Legacy skill keyword matcher (not used by the prompt hook)
  ├── session.cjs                 ← Session state
  ├── memory.cjs                  ← KV store
  ├── intelligence.cjs            ← Pattern store: edits, outcomes, consolidation
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

Runs 7 sequential phases at the start of every session:

| Phase | Operation | Output |
|---|---|---|
| 1 | `session.restore()` | Restores `current.json` |
| 2 | `intelligence.init()` | Loads patterns from `patterns.json`, deduplicates |
| 3 | Init <!-- doc-count:workers -->9<!-- /doc-count:workers --> background workers | Metrics workers refresh if output is missing or older than 6 hours |
| 4 | Knowledge base preload | CLAUDE.md + docs chunked → `[KNOWLEDGE_PRELOADED]` |
| 5 | Shared instructions | `.agents/shared_instructions.md` → `[SHARED_INSTRUCTIONS]` |
| 6 | Token usage summary | Scan JSONL → `[TOKEN_USAGE]` |
| 7 | MicroAgent trigger cache | `.claude/agents/**/*.md` patterns cached |

### `UserPromptSubmit` → `route`

Runs for every user message:

1. **Simple command detection** — trivial prompts and slash commands skip routing (the statusline's `last-route.json` still names the command).
2. **System prompts skipped** — task notifications, reminder-only turns, slash-command expansions and local-command output get no pick and no record.
3. **The pick** — the central picker over the agent registry and the skill index (see [Routing](./routing.md#4-delivery-the-pick-line)): a Jev decision-model answer at or above `MONOMIND_JEV_MIN_CONFIDENCE` (0.6), else a keyword agent with a relevance score of at least 2 and a 1.5× lead over the runner-up, and a keyword skill with a score of at least 3 and a 1.25× lead. When confident it prints one line, `[PICK] agent: <name> · skill: <invoke>`, where `<name>` is a spawnable Task `subagent_type`. The line is printed even under `MONOMIND_HOOK_QUIET=1`. Keyword agents and skills both come from the shared catalogs ranked by `pick-rank.cjs`; `router.cjs` no longer takes part.
4. **Route record** — `.monomind/route-outcomes.jsonl` (prompt hash, redacted preview, pick, candidates, method, provider, session id, `shown`), `.monomind/routes/<sessionId>.json` and `.monomind/last-route.json`.
5. **Advisory enrichment** (skipped under `MONOMIND_HOOK_QUIET`) — embedding suggestion, monograph hints, MicroAgent trigger scan and the other banners.

When a Jev decision model is configured (`MONOMIND_JEV_URL`, or `TYPESAFE_API_KEY` + `MONOMIND_JEV_HOSTED=1`), the prompt waits up to `MONOMIND_JEV_HOOK_TIMEOUT_MS` for it (default 1500; larger values are capped at 3000); a slow model therefore delays every prompt by up to that limit, and after a failed or timed-out pick the hook skips Jev for 5 minutes (`.monomind/jev-breaker.json`). Every hook process force-exits after 5 s, which leaves the `route` hook time to record its route after the capped Jev window. The `pre-bash`/`pre-write` security gates always keep 5 s.

### `PreToolUse(Task|Agent)` → `pre-agent`

Records whether a subagent spawn followed the session's latest `[PICK]`: one line in `.monomind/pick-adherence.jsonl` (recommended agent, the `subagent_type` actually spawned, `followed`), and `agentActuallyUsed` joined onto the route record. Observation only — it never blocks. SubagentStop logs the agent that ran (`actualAgent`, from the event's `agent_type`) and the pick (`suggestedAgent`) to `routing-feedback.jsonl`; SubagentStop and SessionEnd fold all three logs into `.monomind/pick-stats.json`, the bounded ranking prior described in [Routing](./routing.md#7-outcome-tracking-and-the-learning-loop).

### `SessionStart` skill index

SessionStart rebuilds `.claude/helpers/skill-registry.json` when it is missing or older than any of its sources: `.claude/skills`, `.claude/commands`, `~/.claude/skills`, the Org skill roots or the catalog state. The file is generated per machine (also by `monomind init`, `init upgrade` and `monomind pick`) and is no longer shipped. The agent registry, `.monomind/registry.json`, is read as it is; `monomind` commands rebuild it when an agent file is newer (see [Agents & Skills](./agents-and-skills.md#agents)).

### Hook timeouts

Claude Code reads a hook's `timeout` in seconds. Generated settings used to write milliseconds (`5000` meant about 83 minutes); they now write seconds — for example 12 for the `route` hook, which covers the longest Jev window plus 1.5 s.

### `PreToolUse(Bash)` → `pre-bash`

Safety validation — blocks dangerous patterns:
- `rm -rf /`, `format c:`, `dd if=/dev/zero`, fork bombs
- Returns `{action: "block", reason}` to Claude Code

It also runs the graph gate (`pre-search` does the same for `Grep`/`Glob`). The gate never blocks. The first source-code grep, rg or find of a session, when the monograph graph is fresh and non-empty and no monograph tool has been called yet, gets a one-time reminder to try `monograph_query`/`monograph_suggest`, delivered as PreToolUse `additionalContext`. Piped greps (`… | grep x`) and searches over dependencies, build output, logs, docs/data files or paths outside the project get no reminder.

### `PostToolUse(Write|Edit|MultiEdit)` → `post-edit`

Calls `intelligence.recordEdit(file)` — appends to `pending-insights.jsonl` for later consolidation.

### `SubagentStart` / `SubagentStop`

`SubagentStart` runs `capture-handler.cjs subagent-start` (agent telemetry for the org dashboard) and `monolean-propagate.cjs`. `SubagentStop` runs `hook-handler.cjs post-task` (routing pattern save and the `routing-feedback.jsonl` line described above) and `capture-handler.cjs subagent-stop`.

`TeammateIdle` and `TaskCompleted` are not valid Claude Code settings keys, so `init` writes neither and `init upgrade` removes them from an existing `settings.json`. `init` registers no `Stop` or `Notification` hook either, because the two it used to write only printed a line (#417).

### Claude Code Agent Teams are opt-in

`monomind init` and `init upgrade` do not write `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` or the `monomind.agentTeams` settings block. Nothing in Monomind reads either, and teammate messages wake the parent context, which adds token cost. Pass `monomind init --agent-teams` to write them. An existing flag or block is left as it is, and `monomind doctor` reports it. To remove one an earlier `init` wrote, run `monomind init upgrade --settings`: it removes the flag and the block only when the block carries Monomind's own marker (`coordination.sharedMemoryNamespace: agent-teams`), keeps a `settings.json.bak-agent-teams` backup, and leaves a flag you set yourself.

### Duplicate hooks

Hooks are identified by event, matcher and helper script plus argument, not by the exact command string. `monomind init --force` retires an older command form of a hook it regenerates, and `doctor` flags the same helper and argument registered twice (in one settings file or in two), since each registration runs.

### `SessionEnd` → `session-end`

1. `intelligence.consolidate()` — clears `pending-insights.jsonl`
2. `session.end()` — archives `current.json` → `session-{id}.json`

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

## Background Workers (<!-- doc-count:workers -->9<!-- /doc-count:workers -->)

There is no separate background daemon. All <!-- doc-count:workers -->9<!-- /doc-count:workers --> workers (`health`, `ddd`, `security`, `cache`, `map`, `audit`, `consolidate`, `progress`, `reflexion`) live in `@monoes/hooks` (`WorkerManager`) as entries in the static `WORKER_CONFIGS` map, run in-process, and are initialized at session start (see table). The metrics-producing workers (`map`, `audit`, `consolidate`, `ddd`) refresh automatically when their output file under `.monomind/metrics/` is missing or older than 6 hours; `ddd` runs unconditionally every session start (`always: true`), the other three only when stale; `doctor` reports worker-metrics freshness.

| Worker | Interval | Priority | Purpose |
|---|---|---|---|
| `health` | 5 min | High | Monitor disk, memory, CPU, processes |
| `security` | 30 min | High | Scan for secrets, vulnerabilities, CVEs |
| `audit` | 6 hours | High | Security audit → `.monomind/metrics/security-audit.json` |
| `map` | 6 hours | Normal | Codebase mapping → `.monomind/metrics/codebase-map.json` |
| `progress` | 6 hours | Normal | Implementation metrics → `.monomind/metrics/progress.json` |
| `ddd` | 10 min | Low | Track DDD domain implementation progress |
| `consolidate` | 6 hours | Low | RAPTOR memory consolidation → `.monomind/metrics/consolidation.json` |
| `cache` | 1 hour | Background | Clean temp files, old logs, stale cache |
| `reflexion` | 1 hour | Normal | Turns failed routed tasks in `route-outcomes.jsonl` into templated notes with keywords in `.monomind/reflexion-store.json`, for keyword lookup later (disabled by default) |

```bash
monomind hooks worker list        # list all workers and status
monomind hooks worker run <name>  # run a worker on demand
```

---

## CLI Subcommands (<!-- doc-count:hooks-subcommands -->28<!-- /doc-count:hooks-subcommands -->)

> These are `monomind hooks <subcommand>` CLI entry points (`packages/@monomind/cli/src/commands/hooks.ts`, the `subcommands` array) — a different mechanism from the "Internal Hook Events" above. None of the names below are `HookEvent` enum members.

### Lifecycle hooks (8)
```bash
monomind hooks pre-edit      # Context and suggestions before editing
monomind hooks post-edit     # Record edit outcome in the local pattern log
monomind hooks pre-command   # Before bash command
monomind hooks post-command  # After bash command
monomind hooks pre-task      # Register task start, get model routing
monomind hooks post-task     # Record task completion
monomind hooks session-end   # End session, persist state
monomind hooks session-restore  # Restore previous session
```

### Intelligence & routing (6)
```bash
monomind hooks route           # Route a task to optimal agent
monomind hooks explain         # Explain routing decision
monomind hooks pretrain        # Scan the repository (file types, import lines) into the memory store and local pattern log (no model is trained)
monomind hooks metrics         # Show hook execution metrics
monomind hooks transfer        # Transfer patterns (local file copy between project checkouts)
monomind hooks list            # List all registered hooks
```

### Workers & output (4)
```bash
monomind hooks intelligence    # JS pattern store, not a trained model: logs edit/outcome/trajectory records to local files and lists, searches, exports and imports them — nests the former `neural` subcommands (train, status, patterns, predict, optimize, export, list, import)
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

### Model routing (3)
Keyword complexity heuristic: `model-route` returns a complexity score and the chosen tier, with no confidence value.
```bash
monomind hooks model-route     # Model tier routing for a task
monomind hooks model-outcome   # Record model routing outcome
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

### Example MCP Tool Call Payloads

```json
// Risk Gate Check: hooks_pre-command
{
  "name": "hooks_pre-command",
  "arguments": {
    "command": "sudo rm -rf /tmp/cache"
  }
}

// Task Lifecycle Initiation: hooks_pre-task
{
  "name": "hooks_pre-task",
  "arguments": {
    "taskId": "task-102",
    "description": "Refactor memory subsystem schema migration",
    "filePath": "packages/@monomind/cli/src/memory/memory-schema.ts"
  }
}
```

## MCP Tools (hooks)

Monomind exposes 8 primary lifecycle & routing MCP tools registered in `packages/@monomind/cli/src/mcp-tools/hooks-tools.ts` and implemented across `hooks-edit-command.ts`, `hooks-route.ts`, `hooks-task.ts` (re-exported by `hooks-routing.ts`), `hooks-embedding.ts`, and `hooks-intelligence.ts`:

| MCP Tool | Implementation | Purpose & Key Payloads |
|---|---|---|
| `hooks_route` | [`hooks-route.ts → hooksRoute`](packages/@monomind/cli/src/mcp-tools/hooks-route.ts#hooksRoute) | **Task Agent Routing**: Routes a task to the best registry agent through the central picker ([`agent-pick.ts → pickAgents`](packages/@monomind/cli/src/routing/agent-pick.ts#pickAgents), the same ranking as the `pick` tool and `monomind pick`); `primaryAgent.type` is a spawnable Task `subagent_type`. <br>• *Input*: `{ task, context?, topK? }` <br>• *Output*: `{ routeId, task, routing, primaryAgent, alternativeAgents, estimatedMetrics, swarmRecommendation }` |
| `hooks_pre-edit` | [`hooks-edit-command.ts → hooksPreEdit`](packages/@monomind/cli/src/mcp-tools/hooks-edit-command.ts#hooksPreEdit) | **Pre-Edit Safety & Context**: Retrieves file context, type, related files, and agent suggestions prior to editing. <br>• *Input*: `{ filePath, operation?, context? }` <br>• *Output*: `{ filePath, operation, context: { fileExists, fileType, suggestedAgents, risks }, recommendations }` (`fileExists` is checked against the project directory) |
| `hooks_post-edit` | [`hooks-edit-command.ts → hooksPostEdit`](packages/@monomind/cli/src/mcp-tools/hooks-edit-command.ts#hooksPostEdit) | **Edit Outcome Feedback**: Records editing outcome to memory store/feedback loop. <br>• *Input*: `{ filePath, success?, agent? }` <br>• *Output*: `{ recorded, filePath, success, timestamp, feedback }` (`recorded` is true only when the feedback write succeeded) |
| `hooks_pre-command` | [`hooks-edit-command.ts → hooksPreCommand`](packages/@monomind/cli/src/mcp-tools/hooks-edit-command.ts#hooksPreCommand) | **Command Risk Assessment**: Assesses shell command execution risk and safety enforcement gates. <br>• *Input*: `{ command }` <br>• *Output*: `{ command, riskLevel, risks, recommendations, safeAlternatives, shouldProceed }` |
| `hooks_post-command` | [`hooks-edit-command.ts → hooksPostCommand`](packages/@monomind/cli/src/mcp-tools/hooks-edit-command.ts#hooksPostCommand) | **Command Execution Persistence**: Records command exit code to time-windowed outcome store (`recordCommand`) and persistent memory store. `success: false` records a failure even with exit code 0; a non-zero exit code is always a failure. <br>• *Input*: `{ command, exitCode?, success? }` <br>• *Output*: `{ recorded, command, exitCode, success, timestamp, _storedIn }` |
| `hooks_pre-task` | [`hooks-task.ts → hooksPreTask`](packages/@monomind/cli/src/mcp-tools/hooks-task.ts#hooksPreTask) | **Task Initiation & Heuristics**: Records task start, suggests agents through the central picker (as `hooks_route` does), computes complexity, retrieves ERL (Experience Replay Learning) heuristics and TextGrad warning gradients from vector store. <br>• *Input*: `{ taskId, description, filePath? }` <br>• *Output*: `{ taskId, description, suggestedAgents, complexity, estimatedDuration, risks, recommendations, modelRouting, plan, timestamp }` |
| `hooks_post-task` | [`hooks-task.ts → hooksPostTask`](packages/@monomind/cli/src/mcp-tools/hooks-task.ts#hooksPostTask) | **Task Completion & Learning**: Records task completion, derives success from recent command exit codes if non-explicit (`deriveRecentSuccess`), updates feedback (`bridgeRecordFeedback`), writes causal graph edges (`bridgeRecordCausalEdge`), joins outcome back to prior `routeId`, stores ERL heuristics & TextGrad critiques, and computes Multi-Agent Reflection (MAR) status. <br>• *Input*: `{ taskId, success?, agent?, quality?, task?, storeDecisions?, routeId? }` <br>• *Output*: `{ taskId, success, outcomeKnown, successSource, duration, learningUpdates: { controller, outcomePersisted }, quality, feedback, marReflection, timestamp }` |
| `hooks_explain` | [`hooks-route.ts → hooksExplain`](packages/@monomind/cli/src/mcp-tools/hooks-route.ts#hooksExplain) | **Routing Transparency**: Explains the central picker's decision (the one `hooks_route` makes) — ranking method, top agent, alternatives, historical success rates (`loadRoutingOutcomes`), and decision factors. <br>• *Input*: `{ task, agent?, verbose? }` <br>• *Output*: `{ task, explanation, factors, patterns, decision }` |

---

## Command Risk Assessment & Enforcement Gates

Command safety gating is evaluated dynamically via `assessCommandRisk` in `packages/@monomind/cli/src/mcp-tools/hooks-embedding.ts`:

### Risk Severity Levels & Rules
- **`rm -rf` / `rm -r`**: Risk Level `0.9` (*Critical*) — Warning: *"Recursive deletion detected - verify target path"*
- **`curl ... | sh` / `wget ... | bash`**: Risk Level `0.8` (*High*) — Warning: *"Piping remote content to shell"*
- **`sudo`**: Risk Level `0.7` (*High*) — Warning: *"Elevated privileges requested"*
- **`> /` or `>> /`**: Risk Level `0.6` (*Medium*) — Warning: *"Writing to system path"*
- **`chmod` / `chown`**: Risk Level `0.5` (*Medium*) — Warning: *"Permission modification"*
- **Safe Commands (`npm`, `npx`, `git`, `ls`, `cat`, `echo`)**: Low risk overrides (`0.1`–`0.3`)

### Execution Gate Condition
In `hooks_pre-command` ([`hooks-edit-command.ts → hooksPreCommand`](packages/@monomind/cli/src/mcp-tools/hooks-edit-command.ts#hooksPreCommand)), the evaluation flag `shouldProceed` is calculated deterministically as:
$$\text{shouldProceed} = (\text{assessment.level} < 0.7)$$
Commands with a risk level of `0.7` or higher (`sudo`, `curl | sh`, `rm -rf`) are flagged for confirmation or blocked.

---

## Configuration & Persistent Outcome Stores

- **Status Line Integration**: Claude Code runs `.claude/helpers/statusline.cjs` (the `statusLine` entry in `.claude/settings.json`); see [Statusline](./statusline.md).
- **Persistent Routing Outcome Store**: Task and routing outcomes are persisted under `.monomind/routing-outcomes.json` ([`hooks-embedding-routing.ts → getRoutingOutcomesPath`](packages/@monomind/cli/src/mcp-tools/hooks-embedding-routing.ts#getRoutingOutcomesPath)) and appended to `.monomind/route-outcomes.jsonl`.
- **Memory Store**: Standard JSON memory fallback state is stored at `.monomind/memory/store.json`.

---

## Environment Variables

Confirmed read by hooks/helpers source:

| Variable | Effect |
|---|---|
| `MONOMIND_CONTROL_NO_SPAWN` | Disables spawning the control-plane process |
| `MONOMIND_CONTROL_PORT` | Overrides the control-plane port |
| `MONOMIND_DASHBOARD_AUTOSTART` | The `SessionStart` hook `control-start.cjs` starts the dashboard only when this is `1` or `.monomind/dashboard.json` has `{"autostart": true}` (written by `monomind init --dashboard`). `0` turns it off for a project that opted in. A running server is left alone |
| `MONOMIND_DEBUG` | Verbose hook/helper debug logging |
| `MONOMIND_CODER_MAX_AGENTS` | Cap on `Agent` launches in a coder-mode turn (default 40, `0` lifts it); see [Coder Mode Security](./coder-mode-security.md#210-model-and-effort-pinning-delegation-caps-and-what-the-result-reports-rev-30-issue-655) |
| `MONOMIND_CODER_MAX_REVIEW_AGENTS` | Cap on review-described `Agent` launches in a coder-mode turn (default 12, `0` lifts it) |
| `MONOMIND_JEV_HOOK_TIMEOUT_MS` | How long the `route` hook waits for the Jev decision model, in ms (default 1500; values above 3000 are capped at 3000, values below 100 fall back to the default) |
| `MONOMIND_GRAPH_GATE` | Set to `off` to disable the monograph gate's one-time reminder (`.claude/helpers/utils/monograph.cjs`) |
| `MONOMIND_MONOFENCE_GATE` | Set to `off` to disable the monofence threat-scan gate (`.claude/helpers/handlers/gates-handler.cjs`) |

`MONOMIND_LOG_LEVEL` (referenced elsewhere, e.g. `CLAUDE.local.md`) is **not** consumed by this hooks/helpers subsystem's source — it's read by the CLI logger, not the hook dispatch path.

---

## Token Cost Settings check

`monomind doctor` (or `monomind doctor -c cost-settings`) has a read-only **Token Cost Settings** check. It reads `~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json` and the process environment, and warns about settings that multiply token use:

- `CLAUDE_CODE_EFFORT_LEVEL`, which outranks every `/effort` and `effortLevel` choice
- `CLAUDE_CODE_AUTO_COMPACT_WINDOW` above 400,000, which lets context grow that far before compaction
- `CLAUDE_CODE_MAX_OUTPUT_TOKENS` above 64,000
- `ENABLE_TOOL_SEARCH=false`, which loads every MCP tool schema into each request
- the same hook helper and argument registered twice

It also notes a leftover `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` or `monomind.agentTeams` block. It names the file and key and never edits your settings. The Claude settings keys are Claude Code's, not Monomind's.

---

## Settings Configuration

`monomind init` writes the hooks into `.claude/settings.json`. Each command resolves the project directory itself (it checks `$CLAUDE_PROJECT_DIR`, falls back to `$PWD` and walks up to the nearest `.claude/helpers`), and `timeout` is in seconds. An abridged example:

```json
{
  "hooks": {
    "SessionStart": [
      {"hooks": [
        {"type": "command", "command": "sh -c '… exec node \"$p/.claude/helpers/hook-handler.cjs\" session-restore'", "timeout": 15}
      ]}
    ],
    "UserPromptSubmit": [
      {"hooks": [
        {"type": "command", "command": "sh -c '… exec node \"$p/.claude/helpers/hook-handler.cjs\" route'", "timeout": 12}
      ]}
    ],
    "PreToolUse": [
      {"matcher": "Bash", "hooks": [{"type": "command", "command": "… hook-handler.cjs pre-bash", "timeout": 5}]},
      {"matcher": "Write|Edit|MultiEdit|NotebookEdit", "hooks": [{"type": "command", "command": "… hook-handler.cjs pre-write", "timeout": 5}]},
      {"matcher": "Task|Agent", "hooks": [{"type": "command", "command": "… hook-handler.cjs pre-agent", "timeout": 3}]},
      {"matcher": "Grep|Glob", "hooks": [{"type": "command", "command": "… hook-handler.cjs pre-search", "timeout": 4}]}
    ],
    "PostToolUse": [
      {"matcher": "Write|Edit|MultiEdit", "hooks": [{"type": "command", "command": "… hook-handler.cjs post-edit", "timeout": 10}]}
    ],
    "SubagentStop": [
      {"hooks": [{"type": "command", "command": "… hook-handler.cjs post-task", "timeout": 5}]}
    ],
    "SessionEnd": [
      {"hooks": [{"type": "command", "command": "… hook-handler.cjs session-end", "timeout": 10}]}
    ]
  }
}
```

The real file also registers `PostToolUse` hooks for `Bash` (`post-bash`) and the Monograph tools (`post-graph-tool`), the `SessionStart` helpers `monograph-freshen.cjs`, `control-start.cjs` and `monolean-activate.cjs`, `UserPromptSubmit`'s `monolean-tracker.cjs`, `PreCompact` (`compact-manual` and `compact-auto`) and `SubagentStart`. Run `monomind doctor` to check the result.
