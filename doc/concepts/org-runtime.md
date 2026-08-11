# Org Runtime Subsystem

> **Monomind v2.9.0** Autonomous Agent Organizations — every role is a live,
> provider-backed AI session coordinated by the **OrgDaemon**.
> This page covers architecture, runner backends, daemon lifecycle, config schema,
> inter-role communication, fault tolerance, and the human-in-the-loop flow.

---

## 1. Architecture Overview

```
monomind org <subcommand>
         │
         ▼  commands/org.ts (31 subcommands)
     OrgDaemon  (orgrt/daemon.ts — 1 076 lines)
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
- **SDK:** Dynamic import of `@opencode-ai/sdk`, shipped as an
  **optionalDependency** of `@monoes/monomindcli` since 2.9.x — present after a
  normal install, but an install failure never breaks the whole CLI. If it is
  missing (e.g. `--no-optional`), the runner fails with an explicit
  "Install it (npm i @opencode-ai/sdk)" message.
- **Activation:** `MONOMIND_RUNTIME=opencode`
- **Turn timeout:** 2 hours (`TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000`).
- **Server start timeout:** 30s when spawning an ephemeral server (the SDK
  default of 5s crashed roles on cold starts).
- **Tool delivery:** Uses the **Fence Protocol** (`tool-fence.ts`) — org tools are rendered
  in the system prompt as markdown and parsed back from assistant text. Tool rounds capped
  at `MAX_TOOL_ROUNDS = 10`. Trailing junk after the JSON object (e.g. an extra
  `}` — observed from kimi k3) is tolerated by parsing the first balanced JSON
  object; a truly unparseable fence is surfaced as a `[monomind] ignored
  malformed tool_call fence …` assistant note on the org bus instead of being
  silently dropped.
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
> the runners above.

### 2.4 VercelAgentRunner (API-key providers)

- **Source:** [`orgrt/vercel-runner.ts`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/vercel-runner.ts)
- **Backend:** In-process Vercel AI SDK (`ai` + per-vendor `@ai-sdk/*` package). Not a subprocess.
- **Activation:** `runtime: 'vercel'` (per-role or org-level) **or** auto-resolved from `provider.kind: 'vercel-api-key'`.
- **Vendor registry:** 15 providers + `openai-compatible` escape hatch — see [`orgrt/vercel-providers.ts`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/vercel-providers.ts). GLM uses the z.ai international endpoint (`https://api.z.ai/api/paas/v4`) via `@ai-sdk/openai` with custom `baseURL`.
- **Primitive:** `streamText({ model, system, messages, tools, stopWhen: isStepCount(N) })` — Vercel v7.
- **Tool delivery:** Native Vercel `tool()` calling — no fence protocol. Every `execute()` wraps `canUseTool` for policy gating (bypassing it would defeat the per-role policy engine).
- **Session resume:** `VercelSessionStore` persists message history to `<org>/sessions/<role>-<uuid>.json` (Vercel SDK is stateless server-side; we maintain history on disk).
- **Cost tracking:** Token-only (`cost_usd: 0`). Vercel returns token usage but no USD; pricing is vendor-specific and drifts, so we ship with zero and let token budgets enforce.
- **Optional deps:** All Vercel packages ship as `optionalDependencies`. Missing packages fail with a clear actionable error (`npm install <pkg>`).

### 2.5 CodexAgentRunner (ChatGPT subscription)

- **Source:** [`orgrt/codex-runner.ts`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/codex-runner.ts)
- **Backend:** Spawns the `codex` binary as a subprocess (same pattern as KimiCodeAgentRunner — no SDK dependency).
- **Activation:** `runtime: 'codex'` **or** auto-resolved from `provider.kind: 'codex'`.
- **Auth:** Inherits `~/.codex/auth.json` from `codex login` (ChatGPT Plus/Pro/Team/Enterprise). No env vars needed.
- **Subprocess protocol:** `codex exec --experimental-json --sandbox danger-full-access --skip-git-repo-check [--model X] [--cd Y] [resume <thread_id>] "<prompt>"`. JSONL events on stdout: `thread.started` (carries `thread_id`), `item.completed` with `item.type === 'agent_message'` (assistant text), `turn.completed` (usage), `turn.failed`/`error` (failures). No per-token streaming — whole items only.
- **Resume:** `codex exec resume <thread_id> "<followup>"` (positional subcommand, not a flag).
- **Tool delivery:** Fence Protocol (same as kimi/opencode) — `executeToolCall` now accepts `canUseTool` for policy gating.
- **Turn timeout:** 2 hours.
- **Fatal error detection:** `turn.failed` events surface the provider error message; crash-restart budget is not consumed on auth/quota failures.

### 2.6 AntigravityAgentRunner (Google AI Pro/Ultra subscription)

- **Source:** [`orgrt/antigravity-runner.ts`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/antigravity-runner.ts)
- **Backend:** Spawns the `agy` (Antigravity CLI) binary as a subprocess — same pattern as KimiCodeAgentRunner / CodexAgentRunner. Antigravity is Google's replacement for the consumer-OAuth path of Gemini CLI (sunset June 18, 2026 for Google AI Pro/Ultra tiers).
- **Activation:** `runtime: 'antigravity'` **or** auto-resolved from `provider.kind: 'antigravity'`.
- **Auth:** OS keyring credentials from running `agy` interactively once (Google OAuth login). Google AI Pro/Ultra consumer subscription flows through this. No env vars needed.
- **Install:** Go binary via `curl -fsSL https://antigravity.google/cli/install.sh | bash` (NOT npm — agy is a Go binary, not a Node package). No Node SDK exists (Python SDK only).
- **Subprocess protocol:** `agy -p "<prompt>" --output-format stream-json [--model X] [--dangerously-skip-permissions] [--conversation <id>]`. NDJSON events on stdout: `init` (carries `conversation_id`), `step_update` with `step_type === 'agent_response'` and `text_delta` (per-token streaming), `result` (carries `conversation_id`, `status`, `usage`).
- **Text accumulation:** agy streams text per-token via `step_update.text_delta`, but the runner accumulates all deltas for a turn and emits one assistant message with fences stripped (fence parsing needs the full text; per-token deltas would split ```tool_call fences across events). This matches kimi/codex behavior at the bus level.
- **Resume:** `--conversation <conversation_id>` (distinct from Gemini CLI's `--resume`/`--session-id` flags — agy uses different flags).
- **Tool delivery:** Fence Protocol (same as kimi/codex/opencode).
- **Turn timeout:** 2 hours.
- **Error detection:** Non-SUCCESS `result.status` (ERROR/CANCELED/INTERRUPTED/etc.) surfaces the error message.

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
| `vercel-api-key` | Surfaces the named `apiKeyEnv` for the Vercel runner to read; **auto-resolves runtime to `'vercel'`**. Pair with `vendor` to pick the provider. |
| `codex` | No env setup — Codex CLI reads `~/.codex/auth.json` from `codex login`; **auto-resolves runtime to `'codex'`** |
| `antigravity` | No env setup — Antigravity CLI (`agy`) reads Google OAuth credentials from the OS keyring after interactive login; **auto-resolves runtime to `'antigravity'`** |

---

## 4. OrgDaemon Lifecycle

**Class:** `OrgDaemon` — [`orgrt/daemon.ts:L178`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/daemon.ts#L178)
**Constructor:** `constructor(private root: string, private opts: DaemonOpts = {})`

### 4.1 `startOrg(name, taskOverride?)`

Source: [daemon.ts:L307](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/daemon.ts#L307)

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
   An org def may set a top-level `"runtime": "claude" | "kimicode" | "opencode" | "vercel" | "codex" | "antigravity"`
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

Source: [daemon.ts:L793](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/daemon.ts#L793)

- Reentrant-safe: joins any in-flight stop via the `stopping` map.
- Captures `OrgCheckpoint` **before** mailboxes close.
- Clears watchdog, BrokerLease, all agent mailboxes.
- Waits for sessions with bounded drain (default `stopWaitMs=15s`; planned completion uses `COMPLETE_DRAIN_MS=5min`).
- Flushes `OrgBus` to disk, appends to `<org>/history.jsonl`, stores cross-run memory.
- Calls `persistState(name, 'stopped', ...)` → writes `<org>/<name>/runtime.json`.
- Removes git worktree if applicable.

### 4.3 `deliver()`

Source: [daemon.ts:L1027](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/daemon.ts#L1027)

Routes `org_send` tool calls:
- **Intra-org:** pushes directly to target role's Mailbox.
- **Cross-org in-process:** finds the target org's running instance and pushes.
- **Cross-process:** HTTP POST to the target daemon's inbox URL via broker registry.
- **Org offline:** queues to `inbox.jsonl` + calls `autoWake()` to restart the org.

### 4.4 Boss Crash Recovery

`scheduleBossRestart()` ([daemon.ts:L1040](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/daemon.ts#L1040) — now a 1-line delegate to `scheduler.ts`):
- Bounded restarts: `MAX_BOSS_RESTARTS = 2` with backoffs `[10_000ms, 30_000ms]`.
- Beyond limit, org transitions to `crashed` state.

### 4.5 Resume

`resumeOrg()` ([daemon.ts:L1070](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/daemon.ts#L1070)):
- Restores full `OrgCheckpoint` (role mailbox queues, session IDs, token budgets).
- Validates TTL (24h) and checksum before applying.

---

## 5. Org Config Schema

**Source:** [`orgrt/types.ts`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/types.ts)  
**Location:** `.monomind/orgs/<name>.json`

`workspace: 'worktree-per-role'` is a real, distinct fourth mode beyond the three above: each
non-boss role gets its own `git worktree add <path> HEAD --detach` under
`.monomind/orgs/<name>/worktree-<role-id>/` ([`daemon.ts:L462-474`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/daemon.ts#L462-L474)), cleaned up on stop
alongside the shared `'worktree'` mode ([`daemon.ts:L899-904`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/daemon.ts#L899-L904)). Falls back to the shared cwd if the
`git worktree add` call fails for a given role.

### Top-level `run_config` defaults

| Field | Default | Purpose |
|---|---|---|
| `max_concurrent_agents` | `4` | How many role sessions run concurrently |
| `budget_tokens` | `1 000 000` | Token spend ceiling for the entire org run, split evenly across roles unless a role sets its own `budget_tokens` |
| `max_turns_per_message` | `30` | Agent turns cap per inbound mailbox message |
| `workspace` | `'repo'` | `'repo'` \| `'isolated'` \| `'worktree'` \| `'worktree-per-role'` |
| `idle_minutes` | _(unset)_ | Idle timeout before watchdog `stopOrg()` |
| `circuit_breaker` | _(unset)_ | `{ failure_threshold?, cooldown_ms? }` — trip after N consecutive non-success session results from a role and close its mailbox instead of looping ([`types.ts:L78-81`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/types.ts#L78-L81), applied [`daemon.ts:L488-489`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/daemon.ts#L488-L489)) |
| `stale_base_threshold` | `0` (disabled) | Warn when the working tree is more than N commits behind its tracking branch ([`types.ts:L84`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/types.ts#L84), checked at start in [`daemon.ts:L672-688`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/daemon.ts#L672-L688) — best-effort, skips silently if git or an upstream tracking branch is unavailable) |

### Role fields (`RoleSchema`)

| Field | Default | Notes |
|---|---|---|
| `id` | required | Unique slug, must match `/^[a-z0-9][a-z0-9_-]*$/i` |
| `type` | `'specialist'` | `'boss'` or `'specialist'` |
| `reports_to` | _(required)_ | `null` → boss |
| `adapter_config.model` | `'claude-sonnet-4-5'` | Model string passed to runner |
| `runtime` | _(unset)_ | Per-role runtime override: `'claude'` \| `'kimicode'` \| `'opencode'` \| `'vercel'` \| `'codex'` \| `'antigravity'`; beats the org-level `runtime` and `MONOMIND_RUNTIME` for this role's sessions |
| `budget_tokens` | _(unset)_ | Per-role token budget override — replaces this role's even split of `run_config.budget_tokens`, so a token-hungry model (e.g. GLM via opencode) doesn't force an inflated org-wide budget. `policy.maxTokens`, when set, still wins |
| `provider.kind` | `'subscription'` | See §3 above |
| `provider.vendor` | _(unset)_ | Which Vercel AI SDK provider to use (only when `kind='vercel-api-key'`): `'openai'` \| `'anthropic'` \| `'google'` \| `'xai'` \| `'deepseek'` \| `'glm'` \| `'mistral'` \| `'groq'` \| `'together'` \| `'fireworks'` \| `'cohere'` \| `'perplexity'` \| `'alibaba'` \| `'openrouter'` \| `'ollama'` \| `'openai-compatible'` |
| `policy` | see below | Per-role tool/file/web policy |

### Role Policy (`RolePolicySchema`)

| Field | Default | Notes |
|---|---|---|
| `allowTools` | _(unset)_ | Allowlist of tool names |
| `denyTools` | `[]` | Explicit tool block list |
| `fileWrite` | `[]` | Glob patterns allowed for writes |
| `fileRead` | `[]` | Glob patterns allowed for reads |
| `webAllow` | _(unset)_ | Domain allowlist for WebFetch/WebSearch: exact host, suffix match, `*.example.com`, or `*` for any host; `[]` = no web |
| `maxTokens` | _(unset)_ | Per-role token budget override |
| `git` | `'read'` | `'none'` \| `'read'` \| `'commit'` \| `'push'` |

### Provider kinds (`ProviderSchema`)

`subscription` (default) | `api-key` | `base-url` | `bedrock` | `vertex` | `gemini` | `openai` | `vercel-api-key` | `codex` | `antigravity`

### Org directory constant

`ORG_DIR = '.monomind/orgs'` ([types.ts:L142](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/types.ts#L142))

---

## 6. Supporting Modules

### OrgBus (`bus.ts`)

- Append-only JSONL event log at `<org>/bus.jsonl` + in-process fan-out.
- `emit()` queues disk writes serially (never blocks callers), fans out synchronously.
- `flush()` awaits all pending disk writes.
- 10 event types: `message | xorg | tool | asset | chat | status | audit | usage | question | gate`
- `OrgBus.readHistory()` (static) — reads bus.jsonl from disk for replay.

### State Detector (`state-detector.ts`)

Infers a role's current activity from the raw SDK message stream — wired into the session
loop at [`session.ts:L236`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/session.ts#L236) (`const detector = new StateDetector()`):

- `AgentState = 'idle' | 'working' | 'tool-call' | 'blocked' | 'error' | 'completed'`
- `onMessage(type, subtype, text)` — `result`/`tool_use` message types map directly to
  `idle`/`error`/`tool-call`; assistant text is matched against a small default regex table
  (error/traceback → `error`; waiting on approval/gate/human input → `blocked`;
  calling/running a tool → `tool-call`; completed/finished/done → `completed`; otherwise
  `working`).
- `checkIdle()` — separately flags `working`/`tool-call` as stale back to `idle` after 30s
  (`idleThresholdMs`) of no activity.
- Every state transition emits a `status` BusEvent with `reason: 'state-change'` and
  `data: { from, to }`.

### Prechecks (`prechecks.ts`)

`runPrechecks(checks, cwd)` runs a `run_config.prechecks` array (`{ name, command }` shell
commands) sequentially, stopping at the first failure — wired into a scheduled run's start
path at [`commands/org.ts:L672-673`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/commands/org.ts#L672-L673). If any check fails, the run is skipped rather
than started, and the failure is logged.

### Remote Hosts — SSH Cross-Org Dispatch (`remote.ts`)

A **separate SSH-based transport** from the broker's HTTP cross-process delivery described in
§4.3 above — the two are not the same mechanism and shouldn't be conflated. Hosts are
registered in `.monomind/orgs/remote-hosts.json` (`RemoteRegistry`); `lookupRemoteOrg(name,
projectRoot)` resolves a target org name to a `RemoteHost` ([`remote.ts:L34`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/remote.ts#L34)), and
`deliverRemote()` ([`remote.ts:L52`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/remote.ts#L52)) shells out over SSH to deliver a message. It's the last
fallback in `deliver()`'s cross-org path, tried after local-org and broker lookups both come up
empty ([`cross-org.ts:L162-163`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/cross-org.ts#L162-L163)).

> **Known issue — SSH dispatch currently fails.** `deliverRemote()` shells out to
> `npx monomind org inbox <name> --json ...` on the remote host ([`remote.ts:L61`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/remote.ts#L61)), but
> `inbox` is not a registered `org` subcommand (the full 31-entry list is in the
> [`monomind org` command reference](../commands/org.md) — `inbox` isn't in it). The remote
> host rejects the command as unknown, so SSH-federated cross-org dispatch does not currently
> work end to end. `pingRemote()` (connectivity check) is unaffected. This is a real,
> discoverable code path — not vaporware — it just doesn't complete its delivery yet.

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
  `lastMessageId`, `sessionId`, `status`, `error`, `scrollback?: string[]` (last N lines of
  terminal output, [`checkpoint.ts:L26`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/checkpoint.ts#L26) — backed by the bounded ring-buffer `ScrollbackBuffer`
  class, [`daemon.ts:L98-107`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/daemon.ts#L98-L107), 500-line default cap; restored on resume at
  [`checkpoint-ops.ts:L169-172`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/checkpoint-ops.ts#L169-L172)).
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
| `org_gate` | All roles | Create a decision gate — a hard-blocking human-approval checkpoint for irreversible actions ([`session.ts:L399`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/session.ts#L399)) |
| `org_task` / `org_task_done` / `org_tasks` | All roles | Create, complete, and list tasks in a dependency DAG — deps must already exist, ready tasks auto-dispatch to their assignee ([`session.ts:L407,413,419`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/session.ts#L407), backed by the `TaskDag` class, [`task-dag.ts:L15-109`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/task-dag.ts#L15-L109)) |
| `org_complete` | Boss only | Signal that the org's goal is achieved |

`org_gate` and the `org_task*` trio are literally the tools this org's own agents use for
gated approvals and dependency-tracked work.

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
