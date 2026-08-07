# Org Runtime Subsystem

> **Monomind v2.8.x** Autonomous Agent Organizations — every role is a live,
> provider-backed AI session coordinated by the **OrgDaemon**.
> This page covers architecture, runner backends, daemon lifecycle, config schema,
> inter-role communication, fault tolerance, and the human-in-the-loop flow.

---

## 1. Architecture Overview

```
monomind org <subcommand>
         │
         ▼  commands/org.ts (27 subcommands)
     OrgDaemon  (orgrt/daemon.ts — 1 691 lines)
         │
         ├── startOrg()
         │    ├── OrgBus (bus.ts)           ← append-only JSONL event log + in-process fanout
         │    ├── Mailbox per role          ← async message queue
         │    ├── PolicyEngine per role     ← tool allow/deny/file-scope enforcement
         │    └── runAgentSession()  (orgrt/session.ts)
         │         └── runOneSession()
         │              └── runner.run()   ← AgentRunner interface
         │                   ├── ClaudeAgentRunner   (default, @anthropic-ai/claude-agent-sdk)
         │                   ├── OpencodeAgentRunner (MONOMIND_RUNTIME=opencode)
         │                   └── KimiCodeAgentRunner (MONOMIND_RUNTIME=kimicode)
         │
         ├── deliver()      ← intra-org mailbox push | cross-process HTTP (broker.ts)
         ├── stopOrg()      ← drain sessions + flush OrgBus + persist history + checkpoint
         ├── OrgScheduler   ← scheduled org runs (org serve)
         └── BrokerLease    ← cross-process org discovery heartbeat
```

All source files are under `packages/@monomind/cli/src/orgrt/`.

---

## 2. Agent Runner Backends

The `AgentRunner` interface ([`orgrt/agent-runner.ts:L66`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/agent-runner.ts#L66)) decouples the agent loop from any specific provider SDK:

```typescript
interface AgentRunner {
  run(args: AgentRunArgs): AsyncIterable<AgentMessage>;
}
```

Three concrete implementations are available:

### 2.1 ClaudeAgentRunner (Default)

- **Source:** [`orgrt/agent-runner.ts:L77`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/agent-runner.ts#L77)
- **SDK:** `@anthropic-ai/claude-agent-sdk` — wraps `query`, `tool`, `createSdkMcpServer`.
- **Activation:** Default when `MONOMIND_RUNTIME` is unset. Also the fallback inside `runOneSession()`.
- **Singleton:** `defaultClaudeRunner` (line 132) — stateless, reused across sessions.
- **Provider auth:** `subscription` kind deletes all `ANTHROPIC_*` env vars so the session
  uses the `claude login` credential already in the keychain — **no API key needed**.

### 2.2 OpencodeAgentRunner

- **Source:** [`orgrt/opencode-runner.ts:L47`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/opencode-runner.ts#L47)
- **SDK:** Dynamic import of `@opencode-ai/sdk` (no hard dependency on install).
- **Activation:** `MONOMIND_RUNTIME=opencode`
- **Turn timeout:** 2 hours (`TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000`).
- **Tool delivery:** Uses the **Fence Protocol** (`tool-fence.ts`) — org tools are rendered
  in the system prompt as markdown and parsed back from assistant text. Tool rounds capped
  at `MAX_TOOL_ROUNDS = 10`.
- **Connects to** an already-running opencode server or spawns an ephemeral one.

### 2.3 KimiCodeAgentRunner

- **Source:** [`orgrt/kimicode-runner.ts:L70`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/kimicode-runner.ts#L70)
- **Backend:** Spawns the `kimi` binary as a subprocess.
- **Activation:** `MONOMIND_RUNTIME=kimicode`
- **Turn timeout:** 2 hours.
- **Tool delivery:** Fence Protocol (same as opencode runner).
- **Usage tracking:** Reads `wire.jsonl` from `$KIMI_CODE_HOME/sessions/<wd>/<sessionId>/agents/main/`.
- **Arg order is critical:** `-p <prompt>` must be first; `--agent-file` only on first turn;
  `--session <id>` on subsequent turns.
- **Fatal error detection:** `classifyStderr()` tags auth/quota errors as non-retryable
  (`err.fatal=true`) so the crash-restart budget is not consumed.

> **There is no GeminiAgentRunner.** `gemini` is a _provider env kind_ only — `provider.ts`
> sets `GEMINI_API_KEY` in the subprocess env, but the agent loop still runs through one of
> the three runners above.

---

## 3. Provider Environment Resolution

Configured per role via the `provider` key in the org JSON. Resolved by
[`orgrt/provider.ts:L11`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/provider.ts#L11):

| `kind` | Behavior |
|---|---|
| `subscription` (**default**) | Deletes `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` — uses `claude login` credentials. No API key required. |
| `api-key` | Sets `ANTHROPIC_API_KEY` from `cfg.apiKeyEnv ?? 'ANTHROPIC_API_KEY'` |
| `base-url` | Sets `ANTHROPIC_BASE_URL`, optionally `ANTHROPIC_AUTH_TOKEN` |
| `bedrock` | Sets `CLAUDE_CODE_USE_BEDROCK=1` |
| `vertex` | Sets `CLAUDE_CODE_USE_VERTEX=1` |
| `gemini` | Sets `GEMINI_API_KEY` from `cfg.apiKeyEnv ?? 'GEMINI_API_KEY'` |
| `openai` | Sets `OPENAI_API_KEY` from `cfg.apiKeyEnv ?? 'OPENAI_API_KEY'` |

---

## 4. OrgDaemon Lifecycle

**Class:** `OrgDaemon` — [`orgrt/daemon.ts:L123`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/daemon.ts#L123)
**Constructor:** `constructor(private root: string, private opts: DaemonOpts = {})`

### 4.1 `startOrg(name, taskOverride?)`

Source: [daemon.ts:L176–L576](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/daemon.ts#L176-L576)

1. Parses `<root>/.monomind/orgs/<name>.json` via `OrgDefSchema.parse()`.
2. Generates Run ID: `run-YYYYMMDDHHMMSS-<4-char-random>`.
3. Resolves workspace (`workspaceSetting()`):
   - `'repo'` → project root
   - `'isolated'` → `.monomind/orgs/<name>/workspace`
   - `'worktree'` → `git worktree add` (cleaned up on `stopOrg`)
4. Raises `maxSdkProcesses` to at least `def.roles.length` (prevents SDK throttle).
5. Creates `OrgBus` (in-memory event tail capped at 1000 events + JSONL disk flush).
6. Selects boss: `roles.find(r => r.type === 'boss' || r.reports_to === null) ?? roles[0]`.
7. Resolves runner per role (`resolveRoleRunner()` in daemon.ts):
   ```
   opts.runner
     ?? resolveRoleRunner(role.runtime, def.runtime)
   // precedence: role `runtime` field
   //   > org def `runtime` field
   //   > MONOMIND_RUNTIME env ('opencode' → OpencodeAgentRunner,
   //     'kimicode' → KimiCodeAgentRunner)
   //   > undefined          // session.ts falls back to ClaudeAgentRunner
   ```
   An org def may set a top-level `"runtime": "claude" | "kimicode" | "opencode"`
   to pin its own runtime regardless of the env var (`"claude"` forces the default
   Claude path even when `MONOMIND_RUNTIME` selects another runner). Each role may
   additionally set its own `runtime` field, which overrides the org-level value
   for that role's sessions only — enabling mixed-runtime orgs (e.g. a Claude
   coordinator with opencode workers). A role with `"runtime": "claude"` stays on
   the Claude default even when the org or env selects another runtime.
8. Boss spawns immediately; all other roles are **lazy-spawned** on first `deliver()` message
   (atomic `spawning` guard prevents duplicate spawns).
9. Starts **idle watchdog** (default 10 min; up to 3 nudges, then `stopOrg()`; disabled with `idle_minutes: 0`).
10. Registers `BrokerLease` (cross-process heartbeat every 20s) if `crossProcess && inboxUrl`.
11. Drains offline inbox messages queued while the org was stopped.

### 4.2 `stopOrg(name, opts?)`

Source: [daemon.ts:L1114](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/daemon.ts#L1114)

- Reentrant-safe: joins any in-flight stop via the `stopping` map.
- Captures `OrgCheckpoint` **before** mailboxes close.
- Clears watchdog, BrokerLease, all agent mailboxes.
- Waits for sessions with bounded drain (default `stopWaitMs=15s`; planned completion uses `COMPLETE_DRAIN_MS=5min`).
- Flushes `OrgBus` to disk, appends to `<org>/history.jsonl`, stores cross-run memory.
- Calls `persistState(name, 'stopped', ...)` → writes `<org>/<name>/runtime.json`.
- Removes git worktree if applicable.

### 4.3 `deliver()`

Source: [daemon.ts:L652](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/daemon.ts#L652)

Routes `org_send` tool calls:
- **Intra-org:** pushes directly to target role's Mailbox.
- **Cross-org in-process:** finds the target org's running instance and pushes.
- **Cross-process:** HTTP POST to the target daemon's inbox URL via broker registry.
- **Org offline:** queues to `inbox.jsonl` + calls `autoWake()` to restart the org.

### 4.4 Boss Crash Recovery

`scheduleBossRestart()` ([daemon.ts:L1086](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/daemon.ts#L1086)):
- Bounded restarts: `MAX_BOSS_RESTARTS = 2` with backoffs `[10_000ms, 30_000ms]`.
- Beyond limit, org transitions to `crashed` state.

### 4.5 Resume

`resumeOrg()` ([daemon.ts:L1443](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/daemon.ts#L1443)):
- Restores full `OrgCheckpoint` (role mailbox queues, session IDs, token budgets).
- Validates TTL (24h) and checksum before applying.

---

## 5. Org Config Schema

**Source:** [`orgrt/types.ts`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/types.ts)  
**Location:** `.monomind/orgs/<name>.json`

### Top-level `run_config` defaults

| Field | Default | Purpose |
|---|---|---|
| `max_concurrent_agents` | `4` | How many role sessions run concurrently |
| `budget_tokens` | `1 000 000` | Token spend ceiling for the entire org run |
| `max_turns_per_message` | `30` | Agent turns cap per inbound mailbox message |
| `workspace` | `'repo'` | `'repo'` \| `'isolated'` \| `'worktree'` |
| `idle_minutes` | _(unset)_ | Idle timeout before watchdog `stopOrg()` |

### Role fields (`RoleSchema`)

| Field | Default | Notes |
|---|---|---|
| `id` | required | Unique slug, must match `/^[a-z0-9][a-z0-9_-]*$/i` |
| `type` | `'specialist'` | `'boss'` or `'specialist'` |
| `reports_to` | _(required)_ | `null` → boss |
| `adapter_config.model` | `'claude-sonnet-4-5'` | Model string passed to runner |
| `runtime` | _(unset)_ | Per-role runtime override: `'claude'` \| `'kimicode'` \| `'opencode'`; beats the org-level `runtime` and `MONOMIND_RUNTIME` for this role's sessions |
| `provider.kind` | `'subscription'` | See §3 above |
| `policy` | see below | Per-role tool/file/web policy |

### Role Policy (`RolePolicySchema`)

| Field | Default | Notes |
|---|---|---|
| `allowTools` | _(unset)_ | Allowlist of tool names |
| `denyTools` | `[]` | Explicit tool block list |
| `fileWrite` | `[]` | Glob patterns allowed for writes |
| `fileRead` | `[]` | Glob patterns allowed for reads |
| `webAllow` | _(unset)_ | URL prefix allowlist |
| `maxTokens` | _(unset)_ | Per-role token budget override |
| `git` | `'read'` | `'none'` \| `'read'` \| `'commit'` \| `'push'` |

### Provider kinds (`ProviderSchema`)

`subscription` (default) | `api-key` | `base-url` | `bedrock` | `vertex` | `gemini` | `openai`

### Org directory constant

`ORG_DIR = '.monomind/orgs'` ([types.ts:L99](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/types.ts#L99))

---

## 6. Supporting Modules

### OrgBus (`bus.ts`)

- Append-only JSONL event log at `<org>/bus.jsonl` + in-process fan-out.
- `emit()` queues disk writes serially (never blocks callers), fans out synchronously.
- `flush()` awaits all pending disk writes.
- 9 event types: `message | xorg | tool | asset | chat | status | audit | usage | question`
- `OrgBus.readHistory()` (static) — reads bus.jsonl from disk for replay.

### Broker (`broker.ts`)

Cross-process org registry using the filesystem:

- **Registry dir:** `~/.monomind/orgrt-broker/` (env: `MONOMIND_ORGRT_BROKER_DIR`)
- **Heartbeat interval:** 20 seconds (`registerOrg()`)
- **Stale threshold:** 90 seconds (`lookupOrg()`)
- `BrokerLease` wraps register + 20s `setInterval` heartbeat.
- Writes are atomic (tmp file + rename).

### OrgScheduler (`scheduler.ts`)

- `parseSchedule()` — accepts `"15m"`, `"2h"`, `"45s"`, or number-as-minutes.
- `add(name, intervalMs, runNow, sinceLastRunMs?)` — phases first tick to resume the org's
  own clock (not daemon restart time); coalesces missed ticks into one catch-up run.

### Fence Protocol (`tool-fence.ts`)

Used by OpenCode and KimiCode runners to deliver org tools through the LLM text stream:

- `TOOL_CALL_RE = /\`\`\`tool_call\s*\n([\s\S]*?)\`\`\`/g`
- `MAX_TOOL_ROUNDS = 10`
- `buildToolProtocol(tools)` — renders org tools as system-prompt markdown.
- `parseToolCalls()` / `executeToolCall()` / `formatToolResults()` — parse → execute → format.

### Checkpoint (`checkpoint.ts`)

Resume state persistence:

- `OrgCheckpoint` includes: `status`, `run`, `pid`, `updated`, `roleState`, `pendingRoles`,
  `abandonedRoles`, `checksum`.
- `RoleCheckpoint` includes: `mailboxQueue`, `mailboxClosed`, `tokensUsed`, `costUsd`,
  `lastMessageId`, `sessionId`, `status`, `error`.
- TTL: 24 hours (`CHECKPOINT_TTL_MS`).
- `captureCheckpoint()` — called **before** mailboxes close in `finishStop()`.
- `validateCheckpoint()` — recomputes checksum before applying.

---

## 7. Session and Tools

**Source:** [`orgrt/session.ts`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/session.ts)

### Role System Prompt (`buildRolePrompt()`)

Constructs system prompt containing:
- Agent id, title, org goal
- Coordinator vs worker role differentiation
- Responsibilities list from org config
- Communication protocol (org_send usage)
- org_complete instructions (boss only)
- Entity glossary

### Tools Available to Every Role

| Tool | Available to | Purpose |
|---|---|---|
| `org_send` | All roles | Send message to another role or org (`org:role` syntax) |
| `ask_human` | All roles | Pause and queue a question for human answer |
| `org_recall` / `org_remember` / `org_learn` | All roles | Cross-run knowledge-graph memory |
| `knowledge_search` | All roles (if enabled) | Semantic search over Second Brain |
| `org_complete` | Boss only | Signal that the org's goal is achieved |

### Silent Session Alarm

`SILENT_SESSION_MS = 4 minutes` — if the stream opens but emits zero messages within this window, an alarm is raised.

---

## 8. Human-in-the-Loop Flow

1. A role agent calls the `ask_human` tool with a question string.
2. The question is appended to `<org>/questions.json` and a `question` BusEvent fires (dashboard SSE updates immediately).
3. `monomind org questions <name>` reads pending questions.
4. `monomind org answer <name> <question-id> "<text>"` delivers the answer:
   - **Live delivery** if the org is running (daemon receives it immediately).
   - **Queued offline** if the org is stopped (answer stored, consumed on next start).

---

## 9. Known Historical Trap (v1 Only)

Early debugging uncovered that the legacy v1 `runorg.md` skill path lost `runId`/`sessionId` because Claude Code truncated long bash stdout — the fix was writing a `<org>-runcontext.json` context file. **This trap applies only to the v1 skill path.** The Org Runtime v2 source (`packages/@monomind/cli/src/orgrt/`) has zero references to `runcontext.json` or `ORG_VARS` stdout parsing — v2 does not use a bash-to-Task handoff.
