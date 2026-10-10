# Org Runtime Subsystem

> Autonomous Agent Organizations — every role is a live,
> provider-backed AI session coordinated by the **OrgDaemon**.
> This page covers architecture, runner backends, daemon lifecycle, config schema,
> inter-role communication, fault tolerance, and the human-in-the-loop flow.

---

## 1. Architecture Overview

```
monomind org <subcommand>
         │
         ▼  commands/org.ts (<!-- doc-count:org-subcommands -->39<!-- /doc-count:org-subcommands --> subcommands)
     OrgDaemon  (orgrt/daemon.ts)
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

The `AgentRunner` interface ([`orgrt/agent-runner-types.ts → AgentRunner`](packages/@monomind/cli/src/orgrt/agent-runner-types.ts#AgentRunner)) decouples the agent loop from any specific provider SDK:

```typescript
interface AgentRunner {
  run(args: AgentRunArgs): AsyncIterable<AgentMessage>;
}
```

Nineteen runtime ids are registered (`RUNNER_SPECS` in [`orgrt/runner-specs.ts`](packages/@monomind/cli/src/orgrt/runner-specs.ts)): `claude`, `codex`, `kimicode`, `opencode`, `vercel`, `antigravity`, `grok`, `qwen`, `qwen-rpc`, `crush`, `copilot`, `pi`, `pi-rpc`, `hermes`, `cline`, `aider`, `dsh`, `kilo` and `freebuff`. `freebuff` is discovered but never runs: its CLI has no headless transport, so selecting it fails with `unsupported` before any process starts (`agent scan` reports `execution_supported: false`). `kilo` runs only with explicit full access (see [Coder Mode Security](./coder-mode-security.md)). The sections below describe the runners in detail one by one; the rest follow the same `AgentRunner` interface and are specified in [Agent Exec Protocol](../agent-exec-protocol.md) §6.

The first three are described first:

### 2.1 ClaudeAgentRunner (Default)

- **Source:** [`orgrt/agent-runner.ts → ClaudeAgentRunner`](packages/@monomind/cli/src/orgrt/agent-runner.ts#ClaudeAgentRunner)
- **SDK:** `@anthropic-ai/claude-agent-sdk` — wraps `query`, `tool`, `createSdkMcpServer`. Not a dependency of the published package: it is installed on first use into `~/.monomind/deps` ([#428](https://github.com/monoes/monomind/issues/428), `utils/optional-deps.ts`).
- **Activation:** Default when `MONOMIND_RUNTIME` is unset. Also the fallback inside `runOneSession()`.
- **Singleton:** `defaultClaudeRunner` (line 132) — stateless, reused across sessions.
- **Which `claude` binary:** the SDK runs an installed Claude Code instead of its own 300 MB copy when it can find a usable one. The order is `--claude-path <absolute-file|bundled>`, then `MONOMIND_CLAUDE_PATH`, then `monomind config set claude.path`; `bundled` turns detection off. With no operator choice it looks for `claude` on `PATH`, `~/.local/bin/claude` and `~/.claude/local/claude`, and accepts a binary found that way only if it is a system install (owned by root, not group- or world-writable, not under `$HOME`, a temp dir or the cwd), because the org daemons run it outside every role sandbox. An explicit path may point anywhere the operator owns; org roles get it read-only. `agent scan --json` and `doctor -c claude-runtime` report the choice. Source: [`orgrt/claude-sdk.ts`](packages/@monomind/cli/src/orgrt/claude-sdk.ts).
- **Provider auth:** `subscription` kind deletes all `ANTHROPIC_*` env vars so the session
  uses the `claude login` credential already in the keychain — **no API key needed**.

### 2.2 OpencodeAgentRunner

- **Source:** [`orgrt/opencode-runner.ts → OpencodeAgentRunner`](packages/@monomind/cli/src/orgrt/opencode-runner.ts#OpencodeAgentRunner)
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
  in the system prompt as markdown and parsed back from assistant text. Tool rounds are capped
  per message by `max_tool_rounds` (default 10, see the Fence Protocol section). Trailing junk after the JSON object (e.g. an extra
  `}` — observed from kimi k3) is tolerated by parsing the first balanced JSON
  object; a truly unparseable fence is surfaced as a `[monomind] ignored
  malformed tool_call fence …` assistant note on the org bus instead of being
  silently dropped.
- **Connects to** an already-running opencode server or spawns an ephemeral one.

### 2.3 KimiCodeAgentRunner

- **Source:** [`orgrt/kimicode-runner.ts → KimiCodeAgentRunner`](packages/@monomind/cli/src/orgrt/kimicode-runner.ts#KimiCodeAgentRunner)
- **Backend:** Spawns the `kimi` binary as a subprocess.
- **Activation:** `MONOMIND_RUNTIME=kimicode`
- **Turn timeout:** 2 hours.
- **Streaming:** stdout is parsed line-by-line AS IT ARRIVES — a spawn-time
  `tool_use` liveness message, then assistant text and `{"role":"tool",...}`
  progress events (forwarded as `tool_use` liveness) are yielded mid-turn.
  This is what keeps long (10-20+ min) kimi turns alive under the 4-minute
  silent-session watchdog; the earlier buffer-until-exit design starved it.
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

- **Source:** [`orgrt/vercel-runner.ts`](packages/@monomind/cli/src/orgrt/vercel-runner.ts)
- **Backend:** In-process Vercel AI SDK (`ai` + per-vendor `@ai-sdk/*` package). Not a subprocess.
- **Activation:** `runtime: 'vercel'` (per-role or org-level) **or** auto-resolved from `provider.kind: 'vercel-api-key'`.
- **Vendor registry:** 15 providers + `openai-compatible` escape hatch — see [`orgrt/vercel-providers.ts`](packages/@monomind/cli/src/orgrt/vercel-providers.ts). GLM uses the z.ai international endpoint (`https://api.z.ai/api/paas/v4`) via `@ai-sdk/openai` with custom `baseURL`.
- **Primitive:** `streamText({ model, system, messages, tools, stopWhen: isStepCount(N) })` — Vercel v7.
- **Tool delivery:** Native Vercel `tool()` calling — no fence protocol. Every `execute()` wraps `canUseTool` for policy gating (bypassing it would defeat the per-role policy engine).
- **Session resume:** `VercelSessionStore` persists message history to `<org>/sessions/<role>-<uuid>.json` (Vercel SDK is stateless server-side; we maintain history on disk).
- **Cost tracking:** Token-only (`cost_usd` unknown, reported as `null`). Vercel returns token usage but no USD; pricing is vendor-specific and drifts, so no cost is claimed and token budgets enforce.
- **Optional deps:** All Vercel packages ship as `optionalDependencies`. Missing packages fail with a clear actionable error (`npm install <pkg>`).

### 2.5 CodexAgentRunner (ChatGPT subscription)

- **Source:** [`orgrt/codex-runner.ts`](packages/@monomind/cli/src/orgrt/codex-runner.ts)
- **Backend:** Spawns the `codex` binary as a subprocess (same pattern as KimiCodeAgentRunner — no SDK dependency).
- **Activation:** `runtime: 'codex'` **or** auto-resolved from `provider.kind: 'codex'`.
- **Auth:** Inherits `~/.codex/auth.json` from `codex login` (ChatGPT Plus/Pro/Team/Enterprise). No env vars needed.
- **Subprocess protocol:** `codex exec --experimental-json --sandbox danger-full-access --skip-git-repo-check [--model X] [--cd Y] [resume <thread_id>] "<prompt>"`. JSONL events on stdout: `thread.started` (carries `thread_id`), `item.completed` with `item.type === 'agent_message'` (assistant text), `turn.completed` (usage), `turn.failed`/`error` (failures). No per-token streaming — whole items only.
- **Resume:** `codex exec resume <thread_id> "<followup>"` (positional subcommand, not a flag).
- **Tool delivery:** Fence Protocol (same as kimi/opencode) — `executeToolCall` now accepts `canUseTool` for policy gating.
- **Turn timeout:** 2 hours.
- **Fatal error detection:** `turn.failed` events surface the provider error message; crash-restart budget is not consumed on auth/quota failures.

### 2.6 AntigravityAgentRunner (Google AI Pro/Ultra subscription)

- **Source:** [`orgrt/antigravity-runner.ts`](packages/@monomind/cli/src/orgrt/antigravity-runner.ts)
- **Backend:** Spawns the `agy` (Antigravity CLI) binary as a subprocess — same pattern as KimiCodeAgentRunner / CodexAgentRunner. Antigravity is Google's replacement for the consumer-OAuth path of Gemini CLI (sunset June 18, 2026 for Google AI Pro/Ultra tiers).
- **Activation:** `runtime: 'antigravity'` **or** auto-resolved from `provider.kind: 'antigravity'`.
- **Auth:** OS keyring credentials from running `agy` interactively once (Google OAuth login). Google AI Pro/Ultra consumer subscription flows through this. No env vars needed.
- **Install:** Go binary via `curl -fsSL https://antigravity.google/cli/install.sh | bash` (NOT npm — agy is a Go binary, not a Node package). No Node SDK exists (Python SDK only).
- **Subprocess protocol:** `agy -p "<prompt>" --output-format stream-json [--model X] [--dangerously-skip-permissions] [--conversation <id>]`. NDJSON events on stdout: `init` (carries `conversation_id`), `step_update` with `step_type === 'agent_response'` and `text_delta` (per-token streaming), `result` (carries `conversation_id`, `status`, `usage`).
- **Streaming / liveness:** stdout is parsed line-by-line AS IT ARRIVES — a spawn-time `tool_use` liveness message (winning the 4-minute silent-session watchdog's first-pull race deterministically), tool steps (`step_type: 'tool'` with `tool_info`) forwarded as `tool_use` liveness, and assistant text yielded mid-turn. The earlier buffer-until-exit design starved the watchdog and aborted every turn longer than 4 minutes ("SDK stream silent for 240s with zero messages").
- **Text accumulation:** agy streams text per-token via `step_update.text_delta`; the runner accumulates deltas per `agent_response` step and emits one fence-stripped assistant message at the step's `DONE` boundary (fence parsing needs the full text; per-token deltas would split ```tool_call fences across events). A `DONE` step that carries the step's full text replaces the accumulated deltas instead of double-appending.
- **Resume:** `--conversation <conversation_id>` (distinct from Gemini CLI's `--resume`/`--session-id` flags — agy uses different flags).
- **Tool delivery:** Fence Protocol (same as kimi/codex/opencode).
- **Turn timeout:** 2 hours.
- **Error detection:** Non-SUCCESS `result.status` (ERROR/CANCELED/INTERRUPTED/etc.) surfaces the error message.

---

## 3. Provider Environment Resolution

Configured per role via the `provider` key in the org JSON. Resolved by
[`orgrt/provider.ts → resolveProviderEnv`](packages/@monomind/cli/src/orgrt/provider.ts#resolveProviderEnv):

| `kind` | Behavior |
|---|---|
| `subscription` (**default**) | Deletes `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` — uses `claude login` credentials. No API key required. |
| `api-key` | Sets `ANTHROPIC_API_KEY` from `cfg.apiKeyEnv ?? 'ANTHROPIC_API_KEY'` |
| `base-url` | Sets `ANTHROPIC_BASE_URL`, optionally `ANTHROPIC_AUTH_TOKEN` |
| `bedrock` | Sets `CLAUDE_CODE_USE_BEDROCK=1` |
| `vertex` | Sets `CLAUDE_CODE_USE_VERTEX=1` |
| `gemini` | **Deprecated.** Sets `GEMINI_API_KEY` from `cfg.apiKeyEnv ?? 'GEMINI_API_KEY'` and nothing else — no runtime reads it, so the role silently runs on the default `ClaudeAgentRunner`. `startOrg` warns at start ([`org-start-steps.ts → prepareOrgStart`](packages/@monomind/cli/src/orgrt/org-start-steps.ts#prepareOrgStart)). Use `vercel-api-key` + `vendor: 'google'` instead. |
| `openai` | **Deprecated.** Same shape as `gemini` — sets `OPENAI_API_KEY` from `cfg.apiKeyEnv ?? 'OPENAI_API_KEY'`, routes nothing, and falls through to Claude. Use `vercel-api-key` + `vendor: 'openai'` instead. |
| `vercel-api-key` | Surfaces the named `apiKeyEnv` for the Vercel runner to read; **auto-resolves runtime to `'vercel'`**. Pair with `vendor` to pick the provider. |
| `codex` | No env setup — Codex CLI reads `~/.codex/auth.json` from `codex login`; **auto-resolves runtime to `'codex'`** |
| `antigravity` | No env setup — Antigravity CLI (`agy`) reads Google OAuth credentials from the OS keyring after interactive login; **auto-resolves runtime to `'antigravity'`** |

---

## 4. OrgDaemon Lifecycle

**Class:** `OrgDaemon` — [`orgrt/daemon.ts → OrgDaemon`](packages/@monomind/cli/src/orgrt/daemon.ts#OrgDaemon)
**Constructor:** `constructor(private root: string, private opts: DaemonOpts = {})`

### 4.1 `startOrg(name, taskOverride?)`

Source: [org-start.ts → startOrg](packages/@monomind/cli/src/orgrt/org-start.ts#startOrg)

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
   An org def may set a top-level `"runtime"` — one of `"claude"`, `"kimicode"`, `"opencode"`,
   `"vercel"`, `"codex"`, `"antigravity"`, `"grok"`, `"qwen"`, `"crush"`, `"copilot"`, `"pi"`,
   `"pi-rpc"`, `"qwen-rpc"`, `"hermes"`, `"cline"`, `"aider"`, `"dsh"`, `"freebuff"`, `"kilo"` (the `RuntimeKind` union in [`daemon.ts`](packages/@monomind/cli/src/orgrt/daemon.ts), dispatched by `resolveRunner()`) —
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

Source: [org-stop.ts → stopOrg](packages/@monomind/cli/src/orgrt/org-stop.ts#stopOrg)

- Reentrant-safe: joins any in-flight stop via the `stopping` map.
- Captures `OrgCheckpoint` **before** mailboxes close.
- Clears watchdog, BrokerLease, all agent mailboxes.
- Waits for sessions with bounded drain (default `stopWaitMs=15s`; planned completion uses `COMPLETE_DRAIN_MS=5min`).
- Flushes `OrgBus` to disk, appends to `<org>/history.jsonl`, stores cross-run memory.
- Calls `persistState(name, 'stopped', ...)` → writes `<org>/<name>/runtime.json`.
- Removes git worktree if applicable.

### 4.3 `deliver()`

Source: [daemon.ts → deliver](packages/@monomind/cli/src/orgrt/daemon.ts#deliver)

Routes `org_send` tool calls:
- **Intra-org:** pushes directly to target role's Mailbox.
- **Cross-org in-process:** finds the target org's running instance and pushes.
- **Cross-process:** HTTP POST to the target daemon's inbox URL via broker registry.
- **Org offline:** queues to `inbox.jsonl` + calls `autoWake()` to restart the org.

### 4.4 Boss Crash Recovery

`scheduleBossRestart()` ([daemon.ts → scheduleBossRestart](packages/@monomind/cli/src/orgrt/daemon.ts#scheduleBossRestart) — now a 1-line delegate to `scheduler.ts`):
- Bounded restarts: `MAX_BOSS_RESTARTS = 2` with backoffs `[10_000ms, 30_000ms]`.
- Beyond limit, org transitions to `crashed` state.

### 4.5 Resume

`resumeOrg()` ([daemon.ts → resumeOrg](packages/@monomind/cli/src/orgrt/daemon.ts#resumeOrg)):
- Restores full `OrgCheckpoint` (role mailbox queues, session IDs, token budgets).
- Validates TTL (24h) and checksum before applying.

---

### 4.6 Concurrency, liveness and workspace hygiene

- **Deferred roles.** When more roles want to run than `max_concurrent_agents` allows, the extra role is deferred, not dropped. It stays a known assignee, its tasks wait `ready` with one `concurrency-limit` audit each (`resource-pressure` when the host is short of resources), and a freed slot goes to the role deferred first. If no slot frees in time, the tasks waiting on the role are failed with the reason and the coordinator is told. When the org-wide token ceiling runs out, pending deferrals are cancelled (`deferred-spawn-cancelled`) and their tasks held with the budget reason.
- **Dead runs are detected.** `runtime.json` records the process's start identity (`pidStart`), so a pid reused by another process is not mistaken for the run. `org status`, `org run` and `org serve` rewrite a `running` record whose run is dead as `crashed` (`closedBy: "liveness-check"`, appended to `liveness.jsonl`) and keep the checkpoint, so `org run --resume` still works. `org run` refuses to start an org whose recorded run is still alive in another process ("already running (pid N)").
- **Sandbox stubs stay out of the repository's change list.** A role in a repo checkout holds empty stub files in the repo root for the whole run (`.bashrc`, `.gitconfig`, `.claude/hooks`, …). While they exist the runtime lists them in a marked block of the repo's `info/exclude` (linked worktrees included), and removes the block when they are gone. A real file of the same name with content is never listed.
- **The Claude SDK is installed on the host, not by the role.** `~/.monomind/deps` is read-only to roles, so before it starts a role whose effective runtime is `claude` the runtime installs the pinned SDK through the hash-pinned installer (`role-deps-installed` audit; `role-deps-missing` when it fails, retried after 10 minutes). Roles on other runtimes trigger no download. `MONOMIND_NO_AUTO_INSTALL=1` turns the host install off, and `monomind deps install` installs into the cache regardless. That command refuses to run inside an org role.

## 5. Org Config Schema

**Source:** [`orgrt/types.ts`](packages/@monomind/cli/src/orgrt/types.ts)  
**Location:** `.monomind/orgs/<name>.json`

`workspace: 'worktree-per-role'` is a real, distinct fourth mode beyond the three above: each
non-boss role gets its own `git worktree add <path> HEAD --detach` under
`.monomind/orgs/<name>/worktree-<role-id>/` ([`role-incarnation.ts → spawnRoleIncarnation`](packages/@monomind/cli/src/orgrt/role-incarnation.ts#spawnRoleIncarnation)), cleaned up on stop
alongside the shared `'worktree'` mode ([`org-stop.ts → finishStop`](packages/@monomind/cli/src/orgrt/org-stop.ts#finishStop)). Falls back to the shared cwd if the
`git worktree add` call fails for a given role.

### Top-level `run_config` defaults

| Field | Default | Purpose |
|---|---|---|
| `max_concurrent_agents` | `4` | How many role sessions run concurrently |
| `budget_tokens` | `1 000 000` | Token spend ceiling for the entire org run, split evenly across roles unless a role sets its own `budget_tokens`. The coordinator is told once when the run passes 80% of it. Hot-reloadable — see [Budget-closed assignees](#budget-closed-assignees) |
| `max_turns_per_message` | `100 000` | Agent turns cap per inbound mailbox message. Deliberately huge (`DEFAULT_MAX_TURNS_PER_MESSAGE`, [`types-role.ts → DEFAULT_MAX_TURNS_PER_MESSAGE`](packages/@monomind/cli/src/orgrt/types-role.ts#DEFAULT_MAX_TURNS_PER_MESSAGE)) so the ceiling never bricks a long task — set it explicitly, or a role's own `max_turns_per_message`, to impose a real cap |
| `max_tool_rounds` | `10` | Tool-call rounds per inbound message on the fence-protocol runtimes (every runtime but `claude` and `vercel`, which are bounded by `max_turns_per_message`). A positive integer up to 200 (`MAX_TOOL_ROUNDS_LIMIT`). A role's own `max_tool_rounds` overrides it. What happens at the cap: see the Fence Protocol section |
| `workspace` | `'repo'` | `'repo'` \| `'isolated'` \| `'worktree'` \| `'worktree-per-role'` |
| `idle_minutes` | `10` | Idle timeout in minutes before the watchdog nudges the boss and ultimately calls `stopOrg()`. Unset falls back to 10 ([`idle-watchdog.ts → startIdleWatchdog`](packages/@monomind/cli/src/orgrt/idle-watchdog.ts#startIdleWatchdog)); `0` disables the watchdog. Fractions allowed |
| `block_recheck_minutes` | `5` | How often the assignee of a task blocked with `org_task_block` is woken to re-check it, until the block's deadline or the task's close ([#329](https://github.com/monoes/monomind/issues/329)). Positive, at most 60 (`MAX_BLOCK_RECHECK_MINUTES`), fractions allowed. A block cannot opt out, because nothing external (a background command finishing, a Monitor event, npm propagation) wakes a blocked task; the role may pass `recheckAfterMinutes` (1–60) for one block. Runs on the idle watchdog's tick, so `idle_minutes: 0` disables it along with block expiry. See [Blocked tasks](#blocked-tasks) |
| `bash_timeout_ms` | `600000` | Claude-runtime roles only: the Bash tool's default and maximum command timeout, set as `BASH_DEFAULT_TIMEOUT_MS` and `BASH_MAX_TIMEOUT_MS` in the role's session env ([`bash-timeout.ts`](packages/@monomind/cli/src/orgrt/bash-timeout.ts)). Claude Code's own default is 2 minutes, too short for an install or a full build. A positive integer up to 3600000. Other runtimes ignore it |
| `circuit_breaker` | _(unset)_ | `{ failure_threshold?, cooldown_ms? }` — trip after N consecutive non-success session results from a role and close its mailbox instead of looping ([`types.ts → circuit_breaker`](packages/@monomind/cli/src/orgrt/types.ts#circuit_breaker), applied [`role-session-opts.ts → circuitBreaker`](packages/@monomind/cli/src/orgrt/role-session-opts.ts#circuitBreaker)) |
| `completion_evidence` | `false` | Gate `org_task_done` on machine-checkable evidence: `{ headSha, worktree?, checks: [{ command, exitCode, expectExit?, expectReason?, output }] }`. A check passes iff `exitCode === (expectExit ?? 0)` — declare `expectExit` for a criterion met by a non-zero exit (a lookup that must 404 → 1, a timeout that must fire → 124) rather than appending `\|\| true`. A non-zero `expectExit` is only for a SINGLE-PURPOSE command and always needs a one-line `expectReason` ("404 = branch not protected"), which renders with the code everywhere (`exit 1 (expected 1: 404 = branch not protected)`) and raises an `evidence-expect-exit` audit event when accepted; on a test suite or other aggregate runner (`vitest`, `jest`, an `npm`/`pnpm`/`yarn` test script, `node --test`, `pnpm -r`, `pnpm --filter … test`, `run verify`, `test:all`) it is refused, because a suite's exit code means "at least one of many things failed" and accepting it accepts every other failure too — run the failing test file alone and declare `expectExit` on that, or exclude it and record the exclusion. A report task (QA, audit) closes on commands proving the report exists and is complete (e.g. `test -s <report>`); the failures it found go in `result`, not `checks`. Evidence from outside a git worktree (a scratch dir, an installed tarball) is pinned to the worktree the artifact was built from. `headSha` must be `headSha` must be the current head of some local work — the `HEAD` of any worktree of the repository or the tip of any local branch; with `worktree` named, that worktree's `HEAD` exactly. A relative `worktree` is resolved against the workspace, and if that is not a worktree, it names the one worktree of the repository whose path ends with it: `src` or `work/src` for `.monomind/orgs/release/work/src`. If it fits more than one worktree, the close is refused and the refusal lists each. A sha that is the head of nothing is stale and refused — unless git has no commit by that name at all, which is refused as an unknown commit (typo?) instead; a `worktree` that is an unfilled placeholder (a literal `<…>`/`{{…}}`, or a nonexistent all-caps path such as `…/SRC`) is refused with a hint to pin the real worktree path ([`completion-gate.ts → checkTaskEvidence`](packages/@monomind/cli/src/orgrt/completion-gate.ts#checkTaskEvidence), heads from [`decisions.ts → localHeads`](packages/@monomind/cli/src/orgrt/decisions.ts#localHeads)). `max_evidence_attempts` (default 3) bounds refused proofs before the task is escalated; a call with no `evidence` object at all is refused without counting |
| `verify_writes` | `true` | Refuse a completion over a demonstrably failed write. A write ledger watches the bus for `Write`/`Edit`/`MultiEdit`/`NotebookEdit` calls, policy denials and `tool_result ok:false`. `org_task_done` is refused, naming the path, when that role has a failed write with no later success and the file is still missing or empty on disk; an `achieved` `org_complete` is refused for any role's unwritten deliverable. A report that names the path and says it is blocked is accepted. Each `(scope, path)` is refused at most twice. `false` opts out ([`write-ledger.ts`](packages/@monomind/cli/src/orgrt/write-ledger.ts)) |
| `lead_watch` | on | Nudges a lead when a role stalls. A role with open work (an open `org_task`, or an actionable message from its `reports_to` or the boss) that has no session after `not_started_s` (default 90) or no bus event for `silent_s` (default 180) gets one `[watch]` message in its lead's mailbox, with doubling backoff and at most 3 per episode. It never fires for a role with no open work, one that is progressing, or during a pending human wait. `false` disables; `unread_s` applies to sections orgs ([`lead-watch.ts`](packages/@monomind/cli/src/orgrt/lead-watch.ts)) |
| `context` | _(unset)_ | Opt-in context surface: `{ require_brief?, notes?, session_cap?: { tasks?, tokens? } }`. See [Context surface](#context-surface-run_configcontext) |
| `notify_task_creator` | `false` | When a task completes, send the role that created it a `[task:<id>] DONE` message with the result and evidence summary. Without it a completion is only a bus event |
| `stale_base_threshold` | `0` (disabled) | Warn when the working tree is more than N commits behind its tracking branch ([`types.ts → stale_base_threshold`](packages/@monomind/cli/src/orgrt/types.ts#stale_base_threshold), checked at start in [`org-start.ts → startOrgInner`](packages/@monomind/cli/src/orgrt/org-start.ts#startOrgInner) — best-effort, skips silently if git or an upstream tracking branch is unavailable) |

### Context surface (`run_config.context`)

Setting any key under `run_config.context` adopts a surface that controls what each role is handed and carries between sessions. An org with no `context` key keeps its tool list and prompt byte for byte, because tool definitions are part of the cached prompt prefix; adopting a key starts new prefixes. Source: [`context-surface.ts`](packages/@monomind/cli/src/orgrt/context-surface.ts).

| Key | Effect |
|---|---|
| `require_brief` | `org_task` and each `org_plan_graph` task take typed fields `objective`, `output`, `tools`, `boundaries` and `acceptance`, rendered with the free-text `brief` into the one brief the assignee receives (same 4,000-character limit; a longer brief is rejected, not truncated). With `require_brief: true` a task missing `objective` or `acceptance` is rejected (for `org_plan_graph`, the whole graph, so no half-built plan is left); other missing fields come back as `warnings`. Without it, a missing `objective` or `acceptance` is only a warning |
| `notes` | `true` gives each role `org_note_append`, which appends to its own `<org dir>/notes/<role>.md`. The file is append-only: to curate, append an entry with `current_state: true` restating what still matters. Each fresh SDK session of that role starts with its last current state and the entries after it, ahead of the task, within 4,000 characters (an entry is included whole or not at all; one over 4,000 characters is rejected). A resumed session is left alone. Notes are not protected from other roles' direct file access |
| `session_cap` | `{ tasks, tokens }`. A role's SDK session ends between turns once it has been given that many distinct tasks or used that many tokens. The turn that crosses the cap finishes; the next message starts a fresh generation whose first message opens with a rotation digest (what the last generation did, the role's open tasks, the budget used, and a warning after two rotations in a row without a finished task), within 4,000 characters, with what is dropped named. Counters persist in the run's `session-counters.json`; a `session-rotated` audit event records each rotation, and `session-cap-usage-missing` flags a runner that reports no usage |

Any `context` key also changes three things for the whole org:

- **Context packets.** `org_task` and `org_plan_graph` tasks take `references` (`files`, `memory_keys`, `task_ids`), listed after the brief in the task's dispatch. A packet over 256 distinct references, or whose title, brief and references together pass 12,000 characters, is rejected with a remedy. References are listed, not snapshotted. The run's `packets.jsonl` records each dispatched packet with the hash of every part, and the first message of each fresh SDK session with its hash.
- **Summary-only returns.** `org_task_done`'s `result` is a summary of at most 1,000 characters plus the ids and file paths of what the role produced. A longer result is rejected with a remedy and the task stays open.
- **Per-call context logging.** Every model call a role makes appends one record to the run's `context.jsonl`: context size (uncached input plus cache reads plus cache writes), session age, cache read and write tokens, and whether it was a session's first call, a resumed session or a subagent call. `monomind org report <org> --context` prints, per role, the calls, sessions, mean and max context, cache hit ratio and the session-start cache split (`--json` gives the same figures).

### Validation checklist

`org validate`, the start of `org run` and `org serve`, `org reload`, `org create` and the dashboard's config patch, import and create all run the same caveat checklist ([`validate-checklist.ts`](packages/@monomind/cli/src/orgrt/validate-checklist.ts)). Errors stop the save or the start. Warnings never block, and a start records them on the run's bus as `checklist-warning`.

- **Errors:** a feature that is designed but not built (`loops`, always; `sections`, `documents`, `requires` and the run_config keys `budget_usd`, `budget_mode` and `experimental` unless the org uses sections) fails with "not yet supported" instead of being ignored silently.
- **Warnings:** an unknown top-level or `run_config` key (the runtime would ignore it); file scopes that do not cover the paths a role's duties name; shell duties with Bash denied; `max_concurrent_agents` below the role count (a finished worker keeps its slot, so roles past the cap wait); no `budget_usd` on any priced role; `budget_usd` on a codex or antigravity role, which reports no USD and is never closed by it; tools (Bash, WebFetch, WebSearch) that wait for a human approval nobody answers, including in a scheduled org; role text that tells a role to use `SendMessage`; a dated detail in a role prompt, which breaks the cached prefix; a boss prompt that does not require self-contained briefs; a role with no explicit model.

### Role fields (`RoleSchema`)

| Field | Default | Notes |
|---|---|---|
| `id` | required | Any non-empty string ([`RoleSchema`](packages/@monomind/cli/src/orgrt/types.ts) does not constrain its shape — `/^[a-z0-9][a-z0-9_-]*$/i` is the **org name** rule, not this). Must be unique within the org, and every non-root `reports_to` must name one (`checkOrgStructure` in [`migrate.ts`](packages/@monomind/cli/src/orgrt/migrate.ts), run by `org validate`) |
| `type` | `'specialist'` | `'boss'` or `'specialist'` |
| `reports_to` | _(required)_ | `null` → boss |
| `adapter_config.model` | runtime/vendor default | Model string passed to runner. When unset, `resolveModel()` in [`session.ts`](packages/@monomind/cli/src/orgrt/session.ts) picks the vendor default, then the runtime default — `claude-sonnet-5` (`DEFAULT_CLAUDE_MODEL` in [`vercel-providers.ts`](packages/@monomind/cli/src/orgrt/vercel-providers.ts)) for the `claude` runtime and when no runtime is set. `/mastermind:createorg` and `monomind org create` always write it explicitly (the latest model for the role's runtime) so a created org doesn't drift when the default changes |
| `runtime` | _(unset)_ | Per-role runtime override: `'claude'` \| `'kimicode'` \| `'opencode'` \| `'vercel'` \| `'codex'` \| `'antigravity'` \| `'grok'` \| `'qwen'` \| `'crush'` \| `'copilot'` \| `'pi'` \| `'pi-rpc'` \| `'qwen-rpc'` \| `'hermes'` \| `'cline'` \| `'aider'` \| `'dsh'` \| `'kilo'` \| `'freebuff'` (never runs); beats the org-level `runtime` and `MONOMIND_RUNTIME` for this role's sessions |
| `budget_tokens` | _(unset)_ | Per-role token budget override — replaces this role's even split of `run_config.budget_tokens`, so a token-hungry model (e.g. GLM via opencode) doesn't force an inflated org-wide budget. `policy.maxTokens`, when set, still wins. The coordinator is told once when the role passes 80% of its token cap |
| `max_turns_per_message` | _(unset)_ | Per-role override of `run_config.max_turns_per_message` — a role doing long build/fix/verify cycles can get more turns without raising the cap for every other role |
| `max_tool_rounds` | _(unset)_ | Per-role override of `run_config.max_tool_rounds`, for a role that makes many tool calls in reply to one message |
| `budget_usd` | _(unset)_ | Per-role USD spend cap. Unlike `budget_tokens` there is **no** org-wide even split: unset means no USD enforcement for this role, only token budgets. The coordinator is told once when the role passes 80% of it. Hot-reloadable, like `budget_tokens` — see [Budget-closed assignees](#budget-closed-assignees) |
| `skills` | _(unset)_ | Org skill library entries pinned into the role's system prompt for the whole run — see §6.6 |
| `skill_pool` | _(unset)_ | Skills the role may load mid-run with `org_skill_load` — names or `tag:<tag>`; only their one-line descriptions sit in the prompt. See §6.6 |
| `ui` | _(unset)_ | Canvas metadata (position, icon, color), round-tripped untouched. The runtime never reads it — `ui.icon` does not select prompt text |
| `provider.kind` | `'subscription'` | See §3 above |
| `provider.vendor` | _(unset)_ | Which Vercel AI SDK provider to use (only when `kind='vercel-api-key'`): `'openai'` \| `'anthropic'` \| `'google'` \| `'xai'` \| `'deepseek'` \| `'glm'` \| `'mistral'` \| `'groq'` \| `'together'` \| `'fireworks'` \| `'cohere'` \| `'perplexity'` \| `'alibaba'` \| `'openrouter'` \| `'ollama'` \| `'openai-compatible'` |
| `policy` | see below | Per-role tool/file/web policy |

### Role Policy (`RolePolicySchema`)

| Field | Default | Notes |
|---|---|---|
| `allowTools` | _(unset)_ | Allowlist of tool names |
| `denyTools` | `[]` | Explicit tool block list |
| `fileWrite` | `[]` | Paths or globs allowed for writes — relative (resolved against the org workdir) or absolute (an explicit, author-written grant; see the file-tool roots note below). An entry with no glob characters (`*`, `?`, `[`, `{`), such as `/srv/growth/site` or `reports`, grants that path **and everything beneath it** (`…/site-old` is not inside `…/site`); an entry with glob characters matches only what the glob says (`src/*.ts` does not reach `src/deep/a.ts`). A directory entry's real path is fixed when the role starts ([`policy-scopes.ts`](packages/@monomind/cli/src/orgrt/policy-scopes.ts)): an entry that is a symlink, or is `/`, a drive root, `$HOME` or an ancestor of `$HOME`, grants nothing (`org validate` reports it as an error; write an explicit glob such as `/home/me/**` if you really mean it), and one that later stops resolving to that path (swapped for or created as a symlink) refuses every file-tool call under that scope. |
| `fileRead` | `[]` | Paths or globs allowed for reads — same directory/glob and absolute/relative rules as `fileWrite` |
| `webAllow` | _(unset)_ | Domain allowlist for WebFetch/WebSearch: exact host, suffix match, `*.example.com`, or `*` for any host; `[]` = no web |
| `maxTokens` | _(unset)_ | Per-role token budget override |
| `maxUsd` | _(unset)_ | Per-role USD spend cap — `PolicyEngine.decide()` denies once accumulated cost meets or exceeds it, the same way `maxTokens` works |
| `autoApproveTools` | _(unset)_ | Tool/action names this role may use **without** pausing for human approval, even when on the built-in sensitive list (`Bash`, `WebFetch`, `WebSearch`, `org_complete`). Still subject to `allowTools`/`denyTools` |
| `approvalTools` | _(unset)_ | Extra tool/action names that pause for approval exactly like the built-in sensitive list. Bare names (`org_send`), never the `mcp__org__` form. `autoApproveTools` wins on conflict |

`org run -y` only skips the cost prompt; it approves nothing. A run with no one to approve `org_complete` (for example an unattended one-shot `org run --task … -y`) needs either `autoApproveTools: ["org_complete"]` on the boss or `org run --auto-approve org_complete`, which pre-approves the listed tools for every role for that run only. A name that nothing in the org gates is refused at start. The list survives a boss auto-restart and is dropped at the next start. `org run` prints each queued approval with the `org approve`/`org deny` command that resolves it.
| `fence` | _(unset)_ | Per-role MonoFence tool-fence config (`FenceConfigSchema`) — see [Fence Protocol](#fence-protocol-tool-fencets) |
| `git` | `'read'` | `'none'` \| `'read'` \| `'commit'` \| `'push'` — see [Git policy enforcement](#git-policy-enforcement) |
| `sandbox` | `{ mode: 'auto' }` | OS sandbox for claude-runtime roles below `git: 'push'`: `mode` `'auto'` \| `'required'` \| `'off'`; `allowedDomains` (default `['*']`); `deniedDomains` (opt-in host deny list); `allowWrite` (extra writable paths); `denyWrite` (paths made read-only for the role's shell and file tools, relative paths resolved against the org root — `["."]` keeps a QA role from writing anywhere in the checkout it tests from); `allowUnixSockets` (default `true` — Chrome needs one). Three opt-in keys use a bubblewrap layer around the role's whole process tree (including a nested SDK sandbox) and fail closed without bubblewrap: `denyExec` (programs the role must not run, by name, `*` glob or absolute path: every matching binary is replaced and fails, and the role's Bash commands naming one are refused), `denyRead` (absolute paths of existing files and directories that appear empty to the role's shell) and `homeWriteAllow` (when set, even to `[]`, the real `$HOME` is mounted through a throwaway overlay so a write lands nowhere real except under the listed subpaths; the runners' own login and state directories belong in it). A role without them is unchanged |
| `access` | `'scoped'` | `'full'` removes every field above — see [Full access](#full-access-policyaccess-full) below. Human-only; never effective without a matching `access_ack` |
| `settings` | _(unset)_ | `'user'`\|`'project'`\|`'local'` sources loaded when `access: 'full'` is active (reuses the `agent exec --settings` mechanism). On the Claude runtime a role with `settings` set is a coder-mode session: its selected model and effort are pinned over the loaded settings' own `env`, and `Agent` launches are capped by `MONOMIND_CODER_MAX_AGENTS` and `MONOMIND_CODER_MAX_REVIEW_AGENTS` (see [Coder Mode Security §2.10](./coder-mode-security.md#210-model-and-effort-pinning-delegation-caps-and-what-the-result-reports-rev-30-issue-655)). Ignored for a scoped role |
| `access_ack` | _(unset)_ | `{by:'human', at, hash, sig}` — written only by `monomind org role set-access`. `sig` is an HMAC over `hash` under a machine-local key (see below) — `hash` alone is a public, recomputable drift check, not proof of a human grant. Never author this by hand |

**Path placeholders.** `{{org_root}}` (the org's project root, not the role's cwd) and `{{home}}` (the home directory of the user running the org) expand in a role's `responsibilities` and in its path-holding policy lists: `fileRead`, `fileWrite`, `sandbox.allowWrite` and `sandbox.denyWrite` ([`prompt-vars.ts`](packages/@monomind/cli/src/orgrt/prompt-vars.ts)). The policy lists expand when the daemon loads the org (at start, on `org reload`, and for a replay), so the file-tool roots and the OS sandbox only ever see absolute paths, and a tracked config can grant `"allowWrite": ["{{home}}/mrg-tmp"]` without hard-coding anyone's home. An unknown placeholder is left verbatim and `org validate` reports it as an error, naming the field.

### Where the policy is enforced (claude runtime)

The Claude Code CLI calls the SDK's `canUseTool` only for a call its own permission rules would ask about. It allows read-only Bash (`cat`, `ls`, `grep`, `git status`, `git log`), `Read` inside the cwd, `Agent`, `ToolSearch` and `ListAgents` without asking, so `canUseTool` alone never saw those calls. `ClaudeAgentRunner` therefore runs the same gate (`gatedCanUseTool`: pending gate, fence, `PolicyEngine.decide()`, approvals) from a programmatic `PreToolUse` hook ([`policy-hook.ts`](packages/@monomind/cli/src/orgrt/policy-hook.ts)). The hook fires for every tool call, including the calls of a subagent the role starts with `Agent`. A denial there stops the call. An allowed call continues through the CLI's own flow (deny rules, the OS sandbox), and when the CLI then asks `canUseTool` about it, the hook's decision is reused, so each call is decided and audited once. Approvals apply to these calls too, so a role whose `Bash` needs approval also waits for approval of `ls`. Every `tool_result` event on the bus has a matching `tool` decision event with the same `call_id`.

`ToolSearch` is exempt from `allowTools`, because it only loads deferred tool schemas, the org tools' among them. `denyTools: ["ToolSearch"]` still blocks it.

### Git policy enforcement

`policy.git` is enforced in layers, strongest first. A role at `'push'` gets none of them. Every other level gets all the layers its runtime supports. The implementation lives in [`git-guard.ts`](packages/@monomind/cli/src/orgrt/git-guard.ts) and [`role-sandbox.ts`](packages/@monomind/cli/src/orgrt/role-sandbox.ts), and both are applied per session in `session.ts`.

| Layer | Runtimes | What it stops | Bypassable by a same-user role? |
|---|---|---|---|
| **1. OS sandbox** (Claude Agent SDK `sandbox`: bubblewrap + socat on Linux, seatbelt on macOS) | `claude` | See the note below this table. | No, for commands the Bash tool runs. |
| **1b. The CLI's own OS sandbox** ([`cli-sandbox.ts`](packages/@monomind/cli/src/orgrt/cli-sandbox.ts)) | `codex`, `grok` | Below `'push'`, codex runs `--sandbox workspace-write` (plus `-c sandbox_workspace_write.network_access=true`) and grok runs `--sandbox workspace` instead of the wide-open modes they used before: writes are confined to the role's cwd and temp dir, `$HOME` and the rest of the filesystem stay read-only. See the note below the table for what these do **not** do. | No, for what the CLI's sandbox covers — but it has no per-tool gate and no `.git` deny rules. |
| **2. File-tool deny rules** (SDK `disallowedTools`: `Edit(//<git dir>/**)` at `read`/`none`; `Edit` on `config` and `hooks/**` at `commit`; `Read(//<git dir>/**)` at `none`; the guard dir always) | `claude` | Write/Edit/Read are in-process tools, so the sandbox doesn't cover them; these rules do. They don't need the sandbox. | No. |
| **3. Bash text classifier** ([`policy-git.ts`](packages/@monomind/cli/src/orgrt/policy-git.ts) `checkGitPolicy`) | `claude` (via `canUseTool`) | Literal `git push`/`commit`, substitutions and interpreter arguments it can't verify, and commands that disable the layer below it: `-c`/`--config-env` overrides of `core.hooksPath`, `core.sshCommand`, `core.askPass`, `credential.*`, `protocol.*` or `include*`, and any command that sets, clears or wipes a guard variable (`GIT_CONFIG_*`, `GIT_ASKPASS`, `GIT_SSH*`, `GIT_TERMINAL_PROMPT`, `SSH_AUTH_SOCK`, `GH_TOKEN`, `GITHUB_TOKEN`) — including `env -i`. All of those fail closed — unless the session's Bash really runs inside the OS sandbox (see below the table). `GIT_AUTHOR_NAME=… git commit` and `git -c user.name=… commit` stay allowed. | Yes. It can't see `echo "git push" \| sh`, a script written in one call and run in the next, `node -e`, or npm scripts. |
| **4. Git guard env** (`GIT_CONFIG_COUNT` config plus credential variables) | all runtimes that pass the session env | `pre-push` denies every push. At `read`/`none`, `reference-transaction` denies ref updates in the org's repositories, including `commit --no-verify`, `update-ref` and `commit-tree`. `protocol.file.allow=never` stops local-path pushes and `send-pack`. `credential.helper` is reset, askpass and ssh commands fail, `GIT_TERMINAL_PROMPT=0`, and `SSH_AUTH_SOCK`, `GH_TOKEN` and `GITHUB_TOKEN` are blank. `maintenance.auto`/`gc.auto` are off, so a commit doesn't leave a detached `git maintenance` holding the caller's pipes inside the sandbox. | Yes; see the residual risks below. |

**Layer 3 under the OS sandbox.** Failing closed on a command the classifier can't read (`node $SCRIPT`, `python3 $F`, `$BIN …`, `env -i …`, `eval "$CMD"`, a guard variable reassigned in front of a non-git command) is there because, without an OS sandbox, such a command could run git at any level. When the role's session **actually** got the SDK sandbox — the runtime decision in `resolveRoleGitEnforcement`, handed to the `PolicyEngine` by `session.ts` (`setOsSandboxed`), never read from config — layer 1 already enforces the level where git runs: `.git` is read-only at `read`/`none`, its `config` and `hooks` are read-only at `commit`, and push credentials are withheld below `push`. So those commands are allowed. Everything the classifier *can* read is still checked: every git call written out literally, including one after an unreadable part of the same command (`node $X && git commit` is denied at `read`), and the `stash`/`config`/`reflog` rules. A git call that is visibly there but has a hidden subcommand (`sh -c "git …"`, `git $SUB`, a `-c alias.*` definition, a `-c core.hooksPath=…` style guard override) still fails closed, so wrapping a literal call doesn't get around its check. Roles with `mode: 'off'`, with `'auto'` on a host without the sandbox, and roles on non-Claude runtimes keep the full fail-closed behaviour.

Layer 3's `read`-level subcommand surface (`GIT_READ_CMDS` plus the args-aware refinements, #299): `status`, `log`, `diff`, `show`, `branch`, `tag`, `remote`, `rev-parse`, `ls-files`, `ls-tree`, `blame`, `shortlog`, `describe`, `cat-file`, `for-each-ref`, `rev-list`, `grep`, `worktree`, `merge-base`, `show-ref`, `name-rev`, `cherry` (not `cherry-pick`), `range-diff`, `check-ignore`, `check-attr`, `count-objects`, `var`, `ls-remote`, `config` (reads only), `stash list`/`stash show` (an allowlist tested against argv[0] only — not `stash push`/`pop`/`apply`/`drop`/`clear`/`branch`/`save`/`create`/`store`/`export`/`import`, nor any option-prefixed form like `stash -- list`), and `reflog`/`reflog show`/`reflog list`/`reflog exists` (an allowlist with an explicit ref-form escape: bare `git reflog` and options-only forms like `-5`/`--all` are read too, since they target the default `show` — everything else, including a bare ref like `git reflog HEAD` and the `write`/`delete`/`drop`/`expire` verbs, is denied at `read`; the denial names the working form, `git reflog show <ref>`).

`stash` mutations (`push`/bare `stash`/`pop`/`apply`/`drop`/`clear`/`branch`/`save`/`create`/`store`/`export`/`import`, and the disguised option-prefixed forms like `stash -- list`/`-k list`/`-u list`, which are `stash push` in argv[0] terms — see above) are denied below `policy.git: 'push'` unconditionally, not merely at `read` like the rest of `GIT_COMMIT_CMDS` (#300): `refs/stash` lives in the **common** git dir, so one stack is shared by the main checkout and every linked worktree, and a `commit`-level role's `stash pop` can resolve against an entry pushed by someone else — the owner included — and destroy uncommitted work. It is therefore not worktree-local the way `add`/`commit`/`rm`/`restore` and the rest of that list are, despite looking like it; a role author choosing `'commit'` for "mutating but local" commands should not expect `stash` to come with it.

The OS sandbox (layer 1) confines what the Bash tool's commands can do:
- **Writes:** the protected `.git` is read-only at `read`/`none`. At `commit`, only its `config` and `hooks` are read-only. The guard's hooks, local-path remotes, and git, shell and Claude config under `$HOME` are always read-only.
  - **A denied directory that is, or holds, the role's cwd or `~/.claude` goes to the SDK as its existing children (#323, [`sandbox-deny-write.ts`](packages/@monomind/cli/src/orgrt/sandbox-deny-write.ts), Linux only).** The SDK binds `/dev/null` over missing "dangerous files" in the cwd (`.gitconfig`, `.bashrc`, `.mcp.json`, …) and in `~/.claude` (`ide`, `local`, `settings.local.json`, …), and bubblewrap has to create a 0-byte mount-point file for each. Under a read-only `denyWrite: ["."]` (the org root) or `~/.claude`, that failed with `bwrap: Can't create file …: Read-only file system` and took the role's Bash call with it — it only worked while another sandboxed process held the stub. Now every entry that existed at session start is still read-only (a mount point, so it can't be rewritten, removed, renamed or replaced), and the directory itself is a writable bind mount, so it can't be renamed either. What the OS layer newly allows is creating **new** entries directly in that directory (and changing its mode bits). **The role's cwd itself is kept read-only again once the runtime holds its stubs** (see the next item, which now runs before the restrictions are built): every stub path in the cwd then exists, the SDK binds each one onto itself, and bubblewrap creates nothing there. The only path the runtime leaves to the SDK inside the cwd, `.git/config.lock`, is skipped by the SDK when the cwd is a denied directory with no writable root below it. So a `denyWrite: ["."]` role whose cwd is the org root can no longer create a new file there with Bash (in the 2.16.10 release run a QA role wrote `qaSample.js` into the org root). The cwd falls back to the expansion when any of its stubs is missing (a failed create, an empty stub another process made that can vanish, stubs not held at all), and when another writable root lies inside it. A directory above the cwd, such as the org root of a role working in a checkout below it, is still expanded: with the cwd writable below it the SDK does create `.git/config.lock` in it. `~/.claude` is still expanded too: the SDK binds CLI state there that the runtime deliberately does not stub. The names that matter to Claude Code or git there (settings, hooks, skills, commands, agents, `.mcp.json`, `.gitconfig`, …) are the SDK's own denies, which it can now enforce because their stubs can be created. The file tools are unaffected: their `Edit(//<dir>/**)` rules and `fileToolDenied()` keep the whole directory, so `Write`/`Edit` still refuse a new file in the org root of a `denyWrite: ["."]` role. An empty regular file among those entries is left out: it is one of the SDK's stubs, which the SDK deletes when the sandbox that created it ends, and a read-only bind of a stub that is gone by the next Bash call fails with `bwrap: Can't find source path …` (2.16.2 release run, `~/.claude/local`). The SDK denies those names itself. The restrictions are rebuilt from what exists each time the role's process starts, so a path the SDK itself adds and then loses is recovered by the sandbox-fault restart below.
  - **The runtime creates those mount-point stubs itself and keeps them for the whole run ([`sandbox-stubs.ts`](packages/@monomind/cli/src/orgrt/sandbox-stubs.ts), Linux only), before the role's restrictions are built.** The SDK deletes a stub when the command that made it ends, and it coordinates that only inside one process. Every role is its own CLI process sharing one cwd and one `~/.claude`. So role B, wrapping a command while role A's stub existed, bound the stub onto itself as a real file, A's cleanup deleted it, and B's Bash call failed with `bwrap: Can't find source path ~/.claude/local` (or `<org root>/.claude/settings.local.json`), 0–5 times per release run. Before a sandboxed role starts, the runtime now creates every missing stub path the SDK binds: the cwd's dotfiles and `.claude/` files, the `.mcp.json` and `.claude/` files of every sandbox-writable directory above the cwd, the `~/.claude` list and `~/.mcp.json`. Each is an empty `0444` file, and a missing `.claude/` that holds them is created as a directory. The SDK then only finds existing paths, which it binds read-only and never deletes. When the run stops, the runtime removes only what it created, and only while it is unchanged (same inode, still empty). A path that already existed is never touched. Each stub is also recorded in a per-machine ledger, `~/.monomind/orgrt-sandbox-stubs/ledger.json` (`MONOMIND_ORGRT_STUBS_DIR` moves it). A daemon that was SIGKILLed, or a reboot, would otherwise leave an empty read-only file at, say, `~/.claude/commands` for good. The next runtime reclaims the entries of dead processes before it creates its own stubs, under the same unchanged-only rule. It adopts them instead, and removes them when its run ends, while another live runtime is listed. Two kinds of path are left to the SDK on purpose. `.git/config.lock`, held for a whole run, would block every `git config` write. The CLI's own state (`.claude.json`, `.config.json`, `.credentials.json`, and the dirs it writes into) must stay writable: a CLI that starts on an empty `.config.json` exits with "configuration file … is corrupted".
- **Network:** every host is reachable by default (`policy.sandbox.allowedDomains`, default `['*']`), minus the opt-in `deniedDomains`. Git remote hosts are deliberately NOT denied: `read` roles legitimately `ls-remote`; `fetch`/`clone` need `policy.git: 'push'`, and the barrier against publishing is the withheld credentials, verified against the real sandbox (`git ls-remote https://github.com/…` succeeds; a push to an https remote fails with "could not read Username" even with the guard env stripped, because the gh credential helper cannot read `~/.config/gh`).
- **Reads:** credential files (`~/.ssh`, `~/.git-credentials`, `~/.config/gh`, `~/.netrc`) can't be read, and neither can the XDG runtime dir. That dir matters more than the files: it carries the session D-Bus, and through it the login keyring, which is where `gh` actually keeps its token — while it was reachable, `gh auth token` returned the operator's GitHub token to a sandboxed role and a `--dry-run` push to the real repository succeeded. The SDK's own default deny of `/run/user` does not survive passing our own `filesystem` block, so this deny is set explicitly. At `none`, the `.git` dir can't be read either.
- **Unix sockets:** allowed, because Chrome's process singleton needs one — without it `monomind browse` dies with `socket() failed: Operation not permitted`. The sockets that would hand out push credentials or the operator's desktop are masked instead (`$SSH_AUTH_SOCK`, `ssh-agent`'s default `/tmp/ssh-*` dirs, `~/.1password`, `/tmp/.X11-unix`, the docker/podman/containerd sockets, and the runtime dir above). `policy.sandbox.allowUnixSockets: false` blocks every AF_UNIX socket and gives up Chrome.
- **Proxy:** sandboxed egress goes through the runtime's HTTP proxy, which node's global `fetch()` ignores unless `NODE_USE_ENV_PROXY=1`, so the session env sets it for sandboxed roles (an operator value wins). curl, npm and git read the proxy variables on their own.
- **Gating:** the sandbox does not auto-allow Bash commands (`autoAllowBashIfSandboxed: false`); every command is decided by the policy gate (see [Where the policy is enforced](#where-the-policy-is-enforced-claude-runtime)), and the `dangerouslyDisableSandbox` parameter is ignored (`allowUnsandboxedCommands: false`).

The guard's config block is self-contained: it re-emits the operator's own `GIT_CONFIG_*` entries ahead of its own rather than continuing their numbering, so it stays valid even when the child process doesn't inherit them. Its hooks never chain to another guard's dispatcher (a role session nested inside another leaves both `core.hooksPath` values in the config, and each picking the other made them exec each other forever); they do still chain to the repository's own hooks.

The guard protects the git common directories of the role's cwd and of the org root, so worktree-per-role worktrees share their main repo's protection. Scratch repositories elsewhere, such as test fixtures under `$TMPDIR`, can still commit at `read`, but nothing can push below `push`.

`core.hooksPath` and `core.excludesFile` apply only in those protected repositories (#481). The guard writes both to `gitconfig` in its state dir and, for each protected common dir, exports two `GIT_CONFIG_*` entries pointing at that file: `includeIf.gitdir:<common dir>.path` for the main checkout and `includeIf.gitdir:<common dir>/worktrees/.path` for every linked worktree (`gitdir/i:` on macOS and Windows). Git honours `includeIf` in `GIT_CONFIG_*` entries (checked with git 2.55). A repository the role's own tests create under `$TMPDIR` therefore gets neither: its `git config core.hooksPath` is empty and `git add .claude/settings.json` is not ignored. The transport and credential settings in the table (`protocol.file.allow`, `credential.helper`, `core.askPass`, `core.sshCommand`, the blanked variables) and `maintenance.auto`/`gc.auto` stay process-wide, so a push from a scratch repository still has no credentials and no local-path transport; it no longer meets the `pre-push` hook there. A role whose cwd and org root are in no repository has nothing to scope to, and gets both settings exported directly as before.

Every other hook passes through to the repository's own hooks (husky, lint-staged), so they keep running for `commit` roles.

**File-tool roots (`file-roots.ts`, #303).** Until this item, `Read`/`Write`/`Edit`/`Glob`/`Grep` (`policy.ts`'s `PolicyEngine`) were confined to the role's cwd alone — even though the OS sandbox above already made `$TMPDIR`, the org root and `policy.sandbox.allowWrite` writable for Bash, so a role could create a scratch file with Bash but not read or edit it back, and degraded to heredocs. `fileToolRoots()` widens the file tools to match: cwd, `$TMPDIR`, the org root and `policy.sandbox.allowWrite` entries are now all roots, plus an absolute `fileRead`/`fileWrite` entry (a glob, or a plain directory that grants everything beneath it, #492) is honoured as its own explicit grant (independent of any root). Every root is checked on `realpath()`-resolved output, so a symlink inside one root cannot resolve outside all of them.

`$HOME` is deliberately **not** one of these roots, even though it is already writable for Bash above. Bash needs a writable `$HOME` for package-manager caches and installs; the file tools do not, and every denial in the reproduction that motivated this item was under `$TMPDIR`. Granting it to the file tools would make the operator's entire home directory — every other checkout, every note, everything outside the deny list below — readable and editable by an autonomous role, which is a far larger widening than the issue needed and buys nothing the reproduction required. If a future item wants `$HOME` as a file-tool root, it needs its own issue and its own justification; this decision should not silently erode.

**Authority files (#498).** The org root is a file-tool root, and with the default `workspace` it is also the role's cwd, so a scope such as `fileWrite: ["../**"]`, or the unrestricted default, reaches `.monomind/orgs/`. Some files there control a role's own authority or record a human's decisions. `Write`, `Edit`, `MultiEdit` and `NotebookEdit` are refused on them regardless of scope, root or `allowWrite` ([`org-authority-files.ts → isAuthorityFile`](packages/@monomind/cli/src/orgrt/org-authority-files.ts#isAuthorityFile)). Every path argument of a call is checked (`file_path`, `path`, `notebook_path`, each MultiEdit edit's `file_path`). Reads are still allowed.

| Path under `<orgRoot>/.monomind/orgs/` | Why it is protected |
|---|---|
| any file directly in it: `<org>.json`/`.yaml`, `<org>-state.json`, `-secrets`, `-runstate`, `-threads.jsonl`, `remote-hosts.json`, … | The org definition holds every role's `policy` (scopes, git level, `sandbox.allowWrite`, `access_ack`), and it applies on `org reload` or the next run. The files beside it are org state. A new file there would be a new org. |
| any file directly in `<org>/`: `gates.json`, `approvals.json`, `questions.json`, `inbox.jsonl`, `decisions.jsonl` | A human's decisions, read back by the daemon or the next run. |
| `<org>/runtime.json`, `history.jsonl`, `idle-watchdog.json` | The resume checkpoint (roles, queue, abandoned roles), run history and the idle deadline. |
| `<org>/run`, `stop`, `pause`, `reload` | Control files that `org serve` acts on: `run` starts the org. |
| `<org>/run-*/bus.jsonl`, `sessions.json` (also in `replay-*/` and `scenario/`) | The run's event log, which records every approval and gate decision and is replayed from checkpoints, and its session ledger. The same names elsewhere (`reports/`, `work/`) are ordinary files. |
| `<org>/git-guard/**` | Each role's git guard: the hooks and config that enforce `policy.git`. |

Roles still write in subdirectories: `reports/`, `work/` (the release org's reports and checkouts), `workspace/`, `worktree/`, `worktree-<role>/`, `.mail/`, and the org memory under `<x>-memory/`. A `<x>-memory/` dir counts as memory only while there is no `<x>-memory.json` (an org of that name). Even in a memory dir, the decision, state and control files listed above are refused.

How a path is matched:
- **Anchored at the org root.** Only the org root's own `.monomind/orgs/` counts. A checkout's `.monomind/orgs/<org>.json` (for example under `work/src/`) or a `$TMPDIR` fixture is an ordinary file.
- **Symlinks and links.** The path is classified as written and after `realpath()`. A dangling symlink is followed to where the write would land. The path is also checked against the real target of every entry in the orgs dir, or in an org dir, that is itself a symlink. So a symlinked `.monomind`, an org definition that links to `config/orgs/<org>.json`, a link into the tree from `reports/`, and a hard link to an authority file are all refused.
- **Spelling.** Path segments are compared the way the filesystem compares them ([`policy-paths.ts → normalizeSegment`](packages/@monomind/cli/src/orgrt/policy-paths.ts#normalizeSegment)): case-insensitively on macOS and Windows, and on Windows without trailing dots and spaces or a `:stream` suffix. `realpath()` is the native one, so existing parts come back in their on-disk case and long (not 8.3) form. The `.git` write check (#258) uses the same comparison.
- **Case-insensitive filesystems (#496).** Deny checks (the credential and guard deny list, the dashboard token, the authority files above and the `.git` write check) fold every segment on every platform, whatever the filesystem: NFKC normalization, removal of default-ignorable code points (zero-width characters, soft hyphen, BOM, CGJ, which Linux casefold ignores), full case folding (`ſ`, `ß`, `ı`, ligatures and the Kelvin sign meet their ASCII forms), and trailing dots, spaces and `:stream` suffixes dropped. So `~/.SSH/id_rsa`, `~/.ßh/id_rsa` and `.GIT/config` are refused everywhere; on a case-sensitive filesystem that also refuses look-alike names (a `Dashboard-Token` anywhere, `.monomind/Orgs/…` on Linux), an intended fail-closed trade-off. Grants (roots and directory entries in `fileWrite`/`fileRead`) compare the on-disk spelling that `realpath()` returns, and fold only the not-yet-existing tail of a path, only on macOS and Windows, and only where [`fs-case.ts → probeCase`](packages/@monomind/cli/src/orgrt/fs-case.ts#probeCase) shows the filesystem folds case: a case-swapped lookup of the target directory's own name and of one of its entries, by inode and never through a symlink, which must agree. Globs never fold. A directory entry spelled in another case than the directory on disk is not refused as a symlink. The Bash git classifier matches `git`, its path and `.exe` forms, `env` and the interpreters (including `cmd`, `powershell` and `pwsh`) in any case.

**Bash, and CLI runtimes' own file tools.** The refusal above is enforced in `canUseTool`, which only the Claude runtime calls for every tool. A subprocess runtime's native file tools (codex `apply_patch`, kimi, opencode, …) never reach it, so they are in the same position as Bash:
- **Authority mask (bubblewrap).** Applies to a `push` role, a role whose SDK sandbox is off or unavailable, and every non-Claude CLI runtime.
  - The orgs dir is bound read-only, and only the subdirectories above are bound read-write again. Bash cannot write, create, delete, rename or hard-link any file directly in the orgs dir or an org dir, nor any run log.
  - The org root and `.monomind` are mount points, so they cannot be renamed away.
  - A symlinked org definition's target is read-only too.
  - A subdirectory can only be written in if it exists when the role starts. Before building the mask, the daemon creates each org's `work`, `reports`, `runs`, `scratch`, `workspace` and `.mail`, plus the `<dir>` of any role `fileWrite` glob of the form `.monomind/orgs/<org>/<dir>/…`. So `git worktree add … .monomind/orgs/release/work/src` works in a masked role. Any other new subdirectory of an org dir cannot be created from inside the mask.
  - The credential tmpfs and `/dev/null` binds come last, so no bind of the orgs tree can uncover them.
  - A symlink someone plants in the orgs dir, such as `ln -s .. orgs/foo`, `ln -s .. orgs/z-memory` or `ln -s $HOME orgs/foo`, is ignored when its target is `/`, `$HOME`, the org root, `.monomind`, the orgs dir or an authority dir, when it holds one of them, or when it points back inside the orgs tree. No read-write dir may hold the orgs dir or an authority dir. If a work dir is swapped for a symlink after the layout is computed, bwrap refuses to mount on it and the role does not start.
- **SDK sandbox (Claude roles below `push`).** The SDK binds its `denyWrite` paths after its `allowWrite` paths, so a writable subdirectory of a denied directory would stay read-only. The orgs dir as a whole therefore cannot be denied.
  - Instead, the existing authority files are denied (for run logs, the current run's only), along with every org's whole `git-guard/`, not only the role's own. `Edit(...)` deny rules cover the known names.
  - `.monomind`, the orgs dir, every org dir and every dir inside an org dir (`reports/`, `work/`, …) are mount points. So the tree cannot be renamed aside, and a work dir cannot be swapped for a symlink: `mv .monomind/orgs …` fails with "Device or resource busy".
  - **What remains:**
    - Bash can still create a *new* file there, such as a new `<name>.json` org definition together with a `<name>/run` file. Nothing starts it: org definitions are operator-signed (below), and the runfile poller refuses one without a valid signature.
    - An authority file that does not exist yet when the role starts can be pre-created, for example a `gates.json` or `questions.json` the daemon has not written yet.
    - A role can plant a symlink in the orgs dir. File tools and later masked sessions ignore or refuse it, as described above.
- **Neither.** A role with no SDK sandbox and no mask can write every one of these files with Bash. This covers a role on a host without bubblewrap (an `authority-mask-unavailable` audit event says so), an in-process runtime, and an active full-access role, which has no policy gate at all.

**Operator-signed definitions (#502).** Writing an org definition is not enough to make the runtime act on it. The operator signs each definition with `monomind org sign <org>` ([`doc/commands/org.md`](../commands/org.md#sign)), and every point where a definition takes effect verifies that signature on the bytes it is about to use ([`org-signature.ts → assertOrgDefSigned`](packages/@monomind/cli/src/orgrt/org-signature.ts#assertOrgDefSigned)):
- `startOrg` (`prepareOrgStart`): `org run`, `org serve`'s runfile poll and schedule, and resume from a checkpoint. The runfile poller also checks first and logs `run request refused`, and a scheduled tick checks before it runs the definition's `prechecks` commands.
- `reloadOrgDef` (`org reload`, and the reload poll of `org run` and `org serve`): an unverified definition changes nothing. The running org keeps its last verified definition, and the refusal is logged and emitted as a `hot-reload-refused` audit event.

What is signed is every field of the definition as written, except the prompt text and layout (`goal`, `status`, and each role's `title`, `responsibilities` and `ui`). Each role's whole `policy`, the role list and each role's runtime, adapter, tool providers, budgets, `instructions_file` (a path the daemon reads into the prompt) and `skills`/`skill_pool` (they decide the MCP tools the daemon grants), and the org's `run_config`, `schedule`, `runtime`, `fence`, `federation` and `loadouts` are covered, as is any field added later. A definition with a `__proto__`, `constructor` or `prototype` key anywhere is refused. The signature is an HMAC under the same machine-local key as the `access_ack` of full-access grants, and it is kept beside that key in the operator-credential directory (`org-signatures/<project id>/<org>.json`, with a copy of the signed projection that `org sign` diffs against), not in the org file. The key and each signature file must be regular files owned by the operator, mode 0600, in a 0700 directory (one of ours with looser bits is tightened), and not symlinks. A key replaced after a daemon loaded it is refused until that daemon restarts. Every role's file tools are denied Read and Edit on the directory, and Bash can neither read nor write it in the SDK sandbox (`denyRead` and `denyWrite`) or under the bubblewrap mask (a tmpfs, so a write there never reaches the real directory). The HMAC also binds the project path and org name, so a signature does not carry over to another checkout, another org or another machine.

Migration: orgs made before signing existed are unsigned. `org run` on a TTY offers a one-time review and sign. Every run without a TTY, and every changed or unverifiable signature, is refused with `run \`monomind org sign <org>\` as the operator after reviewing the change`. `monomind org sign --all` signs every org in a checkout, including the shipped `.monomind/orgs/*.json` and `config/orgs/release.json` (signatures are per machine and never committed). `org create` and `/mastermind:createorg` sign the org they write, and `org role set-access` re-signs an org that verified before its edit.

Residual: the key is as safe as the operator-credential directory, the same as for full-access grants. A role that runs with neither the SDK sandbox nor the bubblewrap mask can read it and sign anything: an active full-access role, a `push` role or one with `policy.sandbox.mode: 'off'` on a host without bubblewrap, a CLI runtime other than claude there (codex on macOS, for example), and any role when bubblewrap is missing. `org sign`'s review and every org start name those roles.

**What the operator's own sessions run (#502 review).** A role must not be able to write something the operator's processes later execute or obey outside every role sandbox. These are refused to the file tools, listed in the SDK sandbox's `denyWrite`, and bound read-only in the bubblewrap mask ([`operator-protected-paths.ts`](packages/@monomind/cli/src/orgrt/operator-protected-paths.ts)):
- the org root's (and the role cwd's) `.claude/` and `.mcp.json`: the operator's Claude Code session loads their settings, hooks, helpers and MCP servers;
- `<project>/.monomind/org-skills/` and `~/.monomind/org-skills/` (or `$MONOMIND_HOME/org-skills`), the org skill libraries; both are created empty before a role starts, so a role cannot plant one;
- `<project>/.monomind/catalog/` (#576), the [skill catalog](./catalog.md): its active `org` skills' content and `grantedTools` and its blueprints decide what roles get at start, and the org signature covers only their names (and blueprint digests). It is created empty before a role starts, and `monomind catalog`'s mutating verbs refuse inside a role;
- the org root's (and the role cwd's) config for the operator's other agent sessions (#580, `PROJECT_RUNTIME_CONFIG`): `.agents/skills` (the catalog's other projection surface, which Codex, Gemini, Kimi, OpenCode and others load skills from), `.agents/monomind/` (the hook bridge rendered hooks run), agy's `.agents/hooks.json`, `.agents/plugins/` and `.agents/skills.json`, `.gemini/`, `.codex/`, `.kimi-code/`, what OpenCode loads from `.opencode/` (agents, commands, modes, plugins, skills, tools, themes, its config, and the packages installed there), `opencode.json`, `opencode.jsonc`, `.qwen/` settings, `.env`, commands, agents, skills and extensions, `crush.json`, `.crush.json`, `crushrc`, `.crushrc`, `.crush/skills`, `.pi/` settings, extensions, skills, prompts, themes, system prompt and installed packages (`npm/`, `git/`), `.clinerules/hooks` and `.clinerules/workflows`, `.aider.conf.yml`, `.cursor/`, `.vscode/mcp.json`, `.kiro/` and `.factory/`: their MCP servers, hooks and hook scripts, plugins, extensions and skills. Where a runtime writes its own project dir while it runs as a role, only these loaded parts are protected: OpenCode writes `.opencode/.gitignore` at every start (and exits when it can't), pi creates `.pi/settings.json.lock`, Qwen Code writes `.qwen/worktrees/` and `batch/`, agy writes `.agents/teamwork/`. At a root that is `$HOME`, the runtimes' own state dirs (`.codex`, `.gemini`, `.kimi-code`, `.qwen`, `.pi`, `.opencode`, `.cursor`, `.factory`, `.kiro`) are left to the home rules. Like `.claude/` none is created at org start (no stray directories in a repo); while one is missing it is on the planted-path watch, which also quarantines one the operator creates while an org runs (`monomind init`, `catalog project --apply`) until `org approve-paths` approves it. Instruction files (`AGENTS.md`, `GEMINI.md`, `QWEN.md`, rules) stay writable, like `CLAUDE.md`, and so does Crush's `.crush/` data dir. A full-access pi role in coder mode whose trusted project settings declare packages needs a signed `allowWrite` for `.pi/npm` / `.pi/git`;
- `~/.monomind/enable-terminal.json`, the terminal-execution opt-in, written as `{ "enabled": false }` when it does not exist yet (what its absence already meant);
- the rest of `~/.monomind` except what the CLI writes while a role uses it (`projects/` memory, browser state, `models/`, `cache/`, `sessions`, update checks, `release-locks/`). cline and aider keep an org role's state in the role's own `$TMPDIR`, not in the shared `~/.monomind/cline-scoped` and `aider-sessions`, which a later unconfined session would load. Under the bubblewrap mask `~/.monomind` itself is read-only and only those entries are bound writable again (the allowlisted directories are created first), so no new top-level entry can be planted there; an allowlisted file that does not exist yet cannot be created inside the mask either (for example `browse.db`'s journal, so `monomind browse workflow` storage needs the file to exist already). The SDK sandbox cannot express that layout and still lets a role create a new top-level entry;
- `~/.npm/_npx` (what `npx -y monomind …` runs), `~/.npmrc`, `~/.local/bin`, `~/.config/fish`, `~/.bashrc.d`, `~/.zshrc.d`, on top of the shell and git files above. The mask also binds `~/.claude.json` (the operator's `mcpServers`) read-only, and `~/.claude`'s settings, hooks, commands, skills, agents, plugins and `CLAUDE.md`. Claude Code itself runs inside the mask for such roles and works with `~/.claude.json` read-only (checked end to end in `operator-paths-sdk.test.ts`); the rest of `~/.claude` (sessions, todos, credentials) stays writable because it needs them.
- **the operator's toolchains (#527)**: what the daemon and the operator's shells run when they start `node`, `npm`, `npx`, `claude`, `monomind` or anything else on `PATH` ([`operator-toolchain-paths.ts`](packages/@monomind/cli/src/orgrt/operator-toolchain-paths.ts)). Computed from the daemon's own environment at every org and role-session start: the real path of `process.execPath` and its install root (`…/installs/node/<version>`); the running CLI's package root and the npm prefix or `node_modules` it was installed into; every absolute directory on `PATH` (one new file there would shadow `git` or `sudo` for the operator), and the directory holding a symlink on the way to one, such as fnm's `~/.local/state/fnm_multishells` (a symlink in a directory too general to protect is reported on stderr instead); `node`/`npm`/`npx`/`claude` as found on `PATH`, resolved to real paths with their install roots; and the version-manager roots: `$XDG_DATA_HOME/mise` (or `$MISE_DATA_DIR`), `~/.nvm` (`$NVM_DIR`), `~/.volta` (`$VOLTA_HOME`), `~/.fnm` and `$XDG_DATA_HOME/fnm` (`$FNM_DIR`), `~/.asdf` (`$ASDF_DATA_DIR`), `~/.rustup` (`$RUSTUP_HOME`), `~/.pyenv`, `~/.rbenv`, `~/.cargo/bin` (`$CARGO_HOME`), `~/go/bin` (`$GOBIN`, `$GOPATH`), `~/.bun/bin` and `~/.bun/install/global` (`$BUN_INSTALL`), and pnpm's home `$XDG_DATA_HOME/pnpm` (`$PNPM_HOME`) as a whole. The XDG directories default to `~/.local/share`, `~/.local/state` and `~/.config`. A version-manager root is covered when it exists, when an environment variable names it, or when a `PATH` entry lies in it. Only what a role could write counts (`/usr/bin/node` is left alone); a path that does not exist is covered only under `$HOME`; and a directory that holds `$HOME`, an XDG base directory, the temp dir or the role's work tree is never protected, nor is a `PATH` entry inside the role's work tree (its `node_modules/.bin`). An org root or cwd that is `$HOME` (or holds it) excludes no `PATH` entry, and monomind warns about it: every role there can write the whole home directory except what is protected.
  - **What an operator shell trusts:** where mise is in use, its global config dir (`$MISE_CONFIG_DIR` or `$XDG_CONFIG_HOME/mise`, which mise trusts without asking), its trust store (`$MISE_STATE_DIR` or `$XDG_STATE_HOME/mise`: `trusted-configs` and `ignored-configs`), `~/.mise.toml` and, if present, `~/.tool-versions`; where direnv is installed, its allow list (`$XDG_DATA_HOME/direnv/allow`) and its config dir (`$XDG_CONFIG_HOME/direnv`: `direnvrc`, `direnv.toml`). Otherwise a role could write `[env] _.source` into mise's global config, or `mise trust` a planted `~/.mise.toml`, and every mise-activated operator shell would run it.
  - **Toolchain config files:** `~/.bunfig.toml`, `~/.cargo/env`, `~/.cargo/config.toml`, `~/.yarnrc.yml`, `~/.default-npm-packages`, and `$XDG_CONFIG_HOME/pnpm/rc` and `$XDG_CONFIG_HOME/go/env`.
  - **Created up front:** pnpm's home, bun's `bin` and `install/global`, a cargo or Go bin dir in use, mise's config dir and trust store, and direnv's allow list and config dir are created empty (under `$HOME` only) when their tool is in use and they are missing, so they are read-only from the first role on and the operator's own `pnpm add -g` or `bun add -g` never looks like a plant.
  - **Roles still read and run all of it.** A role that installs a global tool (`npm i -g`, `pnpm add -g`, `cargo install`, a pip install into a pyenv Python) gets `EROFS` or a file-tool refusal: `npm_config_prefix=$TMPDIR/npm-global npm i -g <pkg>` installs it in the role's own temp dir (run it from `$TMPDIR/npm-global/bin`), and a virtualenv or `GEM_HOME` in `$TMPDIR` does the same for Python and Ruby. pnpm keeps its package store inside its home by default, so a role's environment sets `npm_config_store_dir` to `$XDG_DATA_HOME/pnpm-store` (unless the operator set a store) and `npm_config_manage_package_manager_versions=false`, so pnpm does not try to install another pnpm version into `<pnpm home>/.tools`. A role therefore keeps a pnpm store of its own beside the operator's, and a checkout last installed with the operator's store is re-linked on the role's first `pnpm install`. With the CLI run from a source checkout, its package directory is protected too, so a role cannot rebuild it in place unless a signed `policy.sandbox.allowWrite` names it.

**Parents that cannot be renamed aside (#527).** A read-only path does not help if a role can rename the directory above it and create a new tree in its place (`mv ~/.local/share ~/.local/share.x; mkdir -p ~/.local/share/mise/…`). Every directory on the way from `$HOME` (or the temp dir) to a protected path is therefore a mount point in both OS layers: the SDK sandbox lists it in `allowWrite` (it stays writable), and the mask binds it onto itself before its other binds, and again after the org root's binds if one of those covered it. A mount point cannot be renamed or removed (`EBUSY`). For a protected path inside the org root or the role's cwd (a source checkout the daemon runs from, say), the directories up to that root are mount points too; the root itself is held by its own binds (#498). The mask repeats a mount point that a later read-write bind hid (the org root's, or an org work dir's in the orgs layout), unless that bind is read-only. An org root that holds `~/.monomind` (`$HOME` itself) is bound read-write after the `~/.monomind` layout, so the layout and the deps dir are bound read-only again after it. That org's own `~/.monomind/orgs` is left out of the protected `~/.monomind` entries in every layer, so its roles keep writing their work dirs; its definitions and decision files stay protected as authority files (#498).

**Planted paths (#502 review rounds 3–4).** An OS sandbox can only deny a path that exists, so a role could still create one that did not, and the operator's own processes would obey it ([`planted-paths.ts`](packages/@monomind/cli/src/orgrt/planted-paths.ts)). Two checks quarantine what they find:
- **Claude Code global configs, independent of any run.** `~/.claude/.config.json` (Claude Code prefers this legacy global config over `~/.claude.json` whenever it exists, `mcpServers` included) and every other `.claude*.json` beside `~/.claude.json` or in `~/.claude`, other than the current config and the SDK's 0-byte stubs. What exists at monomind's first look is recorded once in the operator dir and trusted, and the list of what it trusted is printed on stderr and emitted as a `claude-config-first-look` audit event: some machines' Claude Code still writes a live legacy config, and moving it would break the operator's sessions. Anything appearing after that is a plant. An operator who starts using a legacy config later approves it with `monomind org approve-paths ~/.claude/.config.json` (or allows any by creating `~/.monomind/orgrt-operator/allow-claude-legacy-config`). The same check covers a `.mcp.json` in an org work tree (`.monomind/orgs/<org>/work*`, `worktree*`, one level down) or a role cwd that is a git work tree when it is untracked, or when it differs from the main checkout's `HEAD:.mcp.json` or exists where the main checkout has none (a role can commit one on its branch): this repo's tracked `.claude/settings.json` approves the `monomind` server by name, so a planted `.mcp.json` server of that name would start unprompted.
- **A persisted baseline** for every other protected path: the org root's and cwd's `.mcp.json` and `.claude/`, `~/.claude`'s executable config, the shell, git and npm files, and the rest of the operator-protected paths above. Each role session adds the ones missing when it starts. The baseline lives in the operator dir (`plant-baseline/<project id>.json`), so a crash or kill of `org run` does not make a plant look pre-existing next time. An org start never resets it, and neither does signing: only `monomind org approve-paths <path>…` removes a path from it, one named path at a time, from the operator's terminal ([`doc/commands/org.md`](../commands/org.md#approve-paths)).

Both run at every org start, when every role session starts and ends, on the 2-second tick of both `org run` and `org serve`, and (the first) on every `monomind doctor` run, which only reports under `--read-only`. What they find is moved, never deleted, to `~/.monomind/orgrt-operator/quarantine/<project id>/<timestamp>/` with a `manifest.json`. No role can read or write the operator dir, so a role cannot move a plant back or edit the manifest. The run also gets an audit event (`planted-path-quarantined`) and a non-blocking question in the org's inbox (`org questions`) listing, for each path, the exact `mv … && monomind org approve-paths '<original>'` that restores and trusts it, built from what was just moved. The check does not run at the start of the operator's own Claude Code session: that would need a second, CommonJS copy of this logic in the SessionStart hook, and the window it would close is at most one 2-second tick while an org runs. `monomind doctor -c org-skills` also warns when `.claude/settings*.json` approves `.mcp.json` servers by name (`enabledMcpjsonServers`, `enableAllProjectMcpServers`) while `.mcp.json` is missing, untracked or modified.

**First-use code, and config that does not exist yet (#526).**
- What monomind loads from `~/.monomind/deps` ([#428](https://github.com/monoes/monomind/issues/428)) must match SHA-256 hashes shipped beside its lockfiles: the SDK's `sdk.mjs` and the Claude binary the SDK will spawn on this platform, and every `dist/*.js` file of monofence-ai, hashed once per process before the import ([`optional-deps-verify.ts`](packages/@monomind/cli/src/utils/optional-deps-verify.ts)). Every `query()` passes that binary as `pathToClaudeCodeExecutable`, so the SDK never picks its own (an installed Claude Code chosen under #522 is passed as is and not pin-checked), and a `stat` before the query and before a spawn hook refuses it once it has changed since the hash ([`claude-sdk-pin.ts`](packages/@monomind/cli/src/orgrt/claude-sdk-pin.ts)). Hashing the about 300 MB binary delays the first Claude session in a process (well under a second). `sdk.mjs` is imported by path right after its hash; roles cannot write the deps dir, so only an unsandboxed process could swap it in those milliseconds. `@puppeteer/browsers` is not pinned: it loads a whole dependency tree. A copy found up monomind's own module path (`~/node_modules`, say) is held to the same hashes. A mismatch refuses to load and names what to delete.
- At org and session start, the `HOME_DENY_WRITE` entries for which empty means the same as absent are created in the operator's HOME, only where the path is absent (nothing is overwritten), so the SDK sandbox and the mask protect them too ([`operator-protected-paths.ts`](packages/@monomind/cli/src/orgrt/operator-protected-paths.ts)): `~/.npmrc`, `~/.bashrc` and `~/.profile` as empty mode-0600 files (npm merges nothing from an empty file, interactive bash sources nothing, and `~/.profile` is read by sh/dash login shells and by bash only without `.bash_profile`/`.bash_login`, never by zsh; it is not created when `$SHELL` is zsh or fish, since installers such as nvm's append to `~/.profile` when it exists instead of that shell's rc file), and `~/.ssh`, `~/.config/git`, `~/.config/gh` and `~/.config/npm` as empty mode-0700 directories (plus `~/.config` if missing). Linux only: on macOS only `~/.config` is created, and seatbelt denies the missing entries by path. Left to the planted-path watch above, because an empty one could change behaviour: `~/.bash_profile` and `~/.bash_login` (bash would skip `~/.profile`), `~/.gitconfig` (`git config --global` would stop writing a `~/.config/git/config` created later) and the zsh startup files (zsh's new-user setup would not run).
- Every directory above `$MONOMIND_HOME` and `~/.monomind` whose parent a role can write is a mount point in the SDK sandbox and in the mask, so a custom `MONOMIND_HOME` inside a writable root cannot be renamed aside through an ancestor. A symlink cannot be pinned that way, so monomind refuses to load from a deps root reached through a symlink in a directory this user can write.
- macOS: the seatbelt profile the SDK generates (claude-agent-sdk 0.3.226) denies `file-write*` under each `denyWrite` path and adds `file-write-unlink` and `file-write-create` denies on every ancestor of it, so no ancestor of the deps dir can be renamed or replaced and no mount point is needed. Its rules match paths, not files, so on macOS a `denyWrite` entry that does not exist yet is passed too, when its parent exists, and creating it is denied.

A role therefore cannot populate npx's cache: a role that needs `npx` for a package not cached yet can point `npm_config_cache` at its `$TMPDIR`. An org that really must write one of these paths names it in `policy.sandbox.allowWrite`, which is signed; only that subtree opens. Neither shipped org needs it: the release and monomind-dev orgs edit `.claude/` only in their own worktrees under `.monomind/orgs/<org>/work/`, whose `.claude/` the operator's session does not load.

`instructions_file` (a role's or a loadout's) is read only when it resolves, through every symlink, to a file inside the project, and not inside the operator-credential or dashboard-auth directories, a credential store or a dashboard token ([`instructions-file.ts`](packages/@monomind/cli/src/orgrt/instructions-file.ts)). The file is opened with `O_NOFOLLOW`, the opened descriptor must be the inode that was checked and have no other hard link, on Linux its `/proc/self/fd` path is checked again, and the text is read from that descriptor. Its content is signed too: a digest of each instructions file is part of what `org sign` signs, so editing the file makes the definition stop verifying, and each session compares what it reads with the digest verified when the org started, so an edit mid-run is not read.

Regardless of which root admits a path, a deny pass (`fileToolDenied()`) still blocks credential stores (`~/.ssh`, `~/.git-credentials`, `~/.config/git/credentials`, `~/.config/gh`, `~/.netrc`), guard-undoing config (`~/.gitconfig`, `~/.config/git`, shell rc files, `~/.claude`, `~/.claude.json`), the daemon sockets and the XDG runtime dir listed above — the same lists the OS sandbox already enforces for Bash, now shared from one module so the two boundaries cannot drift apart. This deny pass runs for **reads as well as writes**: `policy.ts`'s `SENSITIVE_FILE` pattern only suppresses bus snapshots of a write, it was never a deny, so before this item a credential file was unreachable by the file tools purely because it sat outside cwd — an accident that would otherwise have vanished the moment a widened root (e.g. `policy.sandbox.allowWrite: [$HOME]`) admitted it.

**Legitimate work stays possible under the sandbox.** The role's cwd, the org root, `$HOME` and the temp dir remain writable, so installs, caches and test fixtures still work; local port binding is allowed for dev servers and tests; and `commit` roles can still commit in worktrees whose git dir sits outside their cwd. Verified inside the real sandbox against this repo (see the workload table in the #258 PR): `pnpm install --frozen-lockfile --offline`, `npm run build` in the CLI package, vitest slices that create git repositories under `$TMPDIR`, `monomind browse` driving headless Chrome, `curl` against a forge API, `node`'s `fetch()`, a nested `claude -p` and `monomind agent exec --runtime claude`, and `monomind init` in a scratch directory all succeed. `~/.claude.json`, the shell rc files and everything already in `~/.claude` stay read-only (only new entries can be created in `~/.claude`, see #323 above), and nothing in that list needs to write them.

**Two things behave differently inside the sandbox**, both from the SDK's own design rather than this code:
- Each Bash call gets its own sandbox, so **a background process does not outlive the call that started it**. A browser session must be driven within one command (`monomind browse open … && monomind browse get title && monomind browse close`); an `open` in one call followed by a `get` in the next silently drives a freshly launched browser.
- The sandbox runtime **shadows its own cwd-relative deny entries with `/dev/null`** (`.bashrc`, `.gitconfig`, `.ripgreprc`, `.idea`, `.vscode`, `.claude/hooks`, …), which is what a role sees as an empty, unwritable file; in the working tree they are untracked noise a `commit` role could `git add -A` into a release. The guard therefore writes an excludes file listing exactly those paths and points `core.excludesFile` at it in the protected repositories (only when the sandbox actually runs). Git honours one excludes file, so the operator's own — an explicit `core.excludesFile`, else `$XDG_CONFIG_HOME/git/ignore` — is copied into it at session start; later edits to their file reach the next session. Nothing tracked is hidden: git never ignores a file that is already tracked.
- **Tracked files are not shadowed or emptied.** Verified in a role whose cwd is a checkout of this repository: `.npmrc` (`engine-strict=true`) and `package.json` keep their real content and stay writable, `npm config get engine-strict` and `pnpm config get engine-strict` both return `true`, and `git status` reports nothing modified or deleted. Files under a project's `.claude/` keep their real content but are **read-only** (the SDK protects the project's Claude configuration), so a role cannot edit agent or command definitions in the workspace it runs in.

**Sandbox availability (`policy.sandbox.mode`).**
- `'auto'` (default) uses the sandbox when bwrap and socat (Linux) or `/usr/bin/sandbox-exec` (macOS) are present. If they aren't, the session **runs without it (fail open)** and emits a `git-sandbox-unavailable` audit event, so the gap is never silent.
- `'required'` **fails closed**: the session refuses to start and emits a `git-sandbox-required` audit event. When enabled, the SDK itself is also passed `failIfUnavailable: true`.
- `'off'` opts out and emits a `git-sandbox-off` audit event.

**The CLI runtimes' own sandboxes (layer 1b).** Only codex and grok expose a per-session sandbox mode that can be set from the command line, and each was verified against the installed binary before being wired (#263):

| Runtime | `policy.git` `none`/`read`/`commit` | `policy.git` `push` | Audit event | What was verified |
|---|---|---|---|---|
| `codex` | `--sandbox workspace-write -c sandbox_workspace_write.network_access=true` | `--sandbox danger-full-access` (unchanged) | `git-sandbox-cli` | codex-cli 0.154.0 via `codex sandbox` (no model call): `workspace-write` writes the cwd and `$TMPDIR` but not `$HOME`, and has no network until the `network_access` override (curl cannot resolve without it, HTTP 200 with it); `read-only` makes the whole filesystem read-only, cwd and `$TMPDIR` included. |
| `grok` | `--sandbox workspace` | no `--sandbox` (profile `off`, unchanged) | `git-sandbox-cli` | grok 1.0.13. Built-in profiles per the CLI's own shipped README: `workspace` = read everywhere, write cwd + `/tmp` + `~/.grok`, child network allowed; `read-only` = write `~/.grok` only and child network blocked. Confirmed `workspace` and `read-only` resolve as profile names while an unknown one is rejected; no grok credentials on this host for an end-to-end run. |
| `copilot` | unchanged (`--allow-all-tools`) | unchanged | `git-sandbox-unsupported-runtime` | GitHub Copilot CLI 1.0.83. `--sandbox` exists but is ignored outside `--experimental` ("requires the sandbox feature… Ignoring for this session"), and there is no read-only/workspace mode on the command line at all — the policy lives in `settings.json` under `sandbox` (`userPolicy.filesystem.readwritePaths`/`readonlyPaths`/`deniedPaths`), i.e. operator config, not a per-role flag. Its Linux backend also needs `slirp4netns`/`iptables`. |
| `antigravity` | unchanged (`--dangerously-skip-permissions`) | unchanged | `git-sandbox-unsupported-runtime` | `--sandbox` is a boolean ("Run in a sandbox with terminal restrictions enabled") with no levels, and the CLI's own documented per-command `BypassSandbox: true` "requires manual user approval" — which `--dangerously-skip-permissions`, needed to run headless, auto-approves. A `proceed-in-sandbox` permission mode exists only as a settings value; `--mode` accepts `accept-edits`/`plan` only. Wiring it would buy no enforcement. |
| `qwen`, `kimicode`, others | unchanged | unchanged | `git-sandbox-unsupported-runtime` | Not installed where this was done — flags deliberately not guessed. |

`read`/`none` get the workspace-write mode rather than each CLI's read-only mode on purpose: codex's `read-only` makes the entire filesystem read-only (the cwd, `$TMPDIR` and the role's own log dir included) and grok's writes nothing outside `~/.grok` and cuts child network, so a read-level role could not write a log, install a dependency or build a fixture. That is not weaker than the claude runtime at the same level — #258's SDK sandbox also leaves the cwd, `$HOME` and the temp dir writable at `read` and relies on layers 2–4 for git itself.

What layer 1b does **not** give you, compared with the claude runtime: no `canUseTool` gate (these CLIs never consult it), no `Edit`/`Read` deny rules on the `.git` directory, no credential-file deny list, and no `policy.sandbox` knobs (`mode`, `allowedDomains`, `deniedDomains`, `allowWrite`, `allowUnixSockets` are claude-only). It confines *writes*; git itself still rests on layer 4.

Runtimes with no OS sandbox at all get layer 4 only and emit a `git-sandbox-unsupported-runtime` audit event; codex and grok emit `git-sandbox-cli` naming the mode that was applied. `monomind org validate` reports the same split before a run: one warning for roles with no OS sandbox, one for roles relying on the CLI's own sandbox, one for claude roles that would run unsandboxed, and an error for a `'required'` role on a host without the sandbox.

**Residual risk: be explicit about what is not enforced.**
- **Layers 3 and 4 are not a security boundary against a determined role.** The role runs as the same OS user as the operator. Without the OS sandbox it can:
  - override the guard config: `git -c core.hooksPath=… -c protocol.file.allow=always push`, `env -u GIT_CONFIG_COUNT`, `GIT_CONFIG_COUNT=0` — layer 3 denies these when it can read them as command text, but not when they are hidden in a script or an interpreter argument;
  - write refs and objects directly into `.git` or a local remote with `cp`/`echo`;
  - read ssh keys, `~/.git-credentials` or a gh login from disk;
  - use a token found in a project `.env`.
  `--no-verify` alone does **not** get past it: `reference-transaction` and `protocol.file.allow` have no such flag. [`git-guard.test.ts`](packages/@monomind/cli/__tests__/orgrt/git-guard.test.ts) asserts both the covered cases and the `-c` bypass.
- **On Claude roles with the OS sandbox,** the remaining gaps are:
  - pushing through a forge's HTTP API (e.g. the GitHub contents API on `api.github.com`) with a credential the role can read, such as one in the workspace;
  - network pushes to any host, if the role finds credentials for it (in the workspace, in an environment variable an operator set, or in a readable file outside the masked list) — git remote hosts are reachable by design; add hosts to `policy.sandbox.deniedDomains` to cut that off;
  - a unix-socket agent this code doesn't know about, since sockets are reachable by default: set `policy.sandbox.allowUnixSockets: false` for roles that don't need a browser;
  - creating a `~/.gitconfig` or shell rc file that doesn't exist yet. Missing paths can't be denied, because the sandbox would make them unreadable and git treats an unreadable `~/.gitconfig` as fatal. Guard config in the environment still beats `~/.gitconfig`.
- **`opencode` roles that attach to an external server get nothing.** The ephemeral server the runner starts for a role is spawned by the runner itself with `{ ...process.env, ...session env }` (#262), so layer 4 applies to it like any other subprocess runtime — the SDK's own `createOpencode()` could not, because its `ServerOptions` has no env field and it spawns `opencode serve` with the daemon's `process.env`. A server the role **attaches** to instead (`OPENCODE_URL`) is the operator's own process, started before the session: it cannot be given the guard env, the provider credentials or the #249 `MONOMIND_*` scoping, so such a role below `'push'` has no enforcement at all and emits a `git-guard-unapplied` audit event. Unset `OPENCODE_URL` for org runs.
- **On codex and grok roles (layer 1b),** the CLI's sandbox confines writes but nothing else: the role's native shell still never consults `canUseTool`, the `.git` directory inside a writable cwd is writable (so refs and objects can be written directly, which is what the guard's `reference-transaction` hook is there to catch), credential files outside the sandbox's own protections stay readable, and network is deliberately left on. grok's `workspace` profile makes `/tmp` writable but not a relocated `$TMPDIR`, so a role with a custom temp dir outside its cwd cannot write there. grok's enforcement needs Linux ≥ 5.13 (Landlock) or macOS Seatbelt and, per its own docs, logs a warning and continues unenforced when it cannot apply — monomind does not detect that.
- **On the remaining non-claude CLIs,** qwen `--yolo`, copilot `--allow-all-tools`, antigravity `--dangerously-skip-permissions` and the rest still run their native shell with no OS sandbox and without consulting `canUseTool`; see the layer-1b table above for why each was left alone rather than wired.
- **On Windows,** the hooks' path comparison (`pwd -P` vs. Node realpaths) may not match, so `reference-transaction` protection at `read` is not guaranteed there.

### Full access (`policy.access: 'full'`)

Coder mode (#364) for a specific org role, not just chat (`agent exec --access full`, #355): the
role runs with **no** `allowTools`/`denyTools`/`fileWrite`/`fileRead`/`webAllow`/`sandbox`, **no**
OS sandbox, **no** authority mask, and **no** per-tool approval gate — `canUseTool` allows
everything (still observed: every call still lands a `tool_activity` bus event and a line in
`~/.monomind/logs/agent-exec-full-access.log`). `policy.git` behaves as `'push'` regardless of its
own value. Budgets (`maxTokens`/`maxUsd`) are still enforced — full access never bypasses spend
caps. Nothing about *where* the role runs changes: its worktree/workspace is exactly as
`run_config.workspace` says.

**This is the single most security-sensitive knob in the org runtime, so it is human-only by
design:**

1. **Grant it**: `monomind org role set-access <org> <role> full` (interactive confirm, or
   `--yes-i-understand` for scripts). This is the ONLY place in monomind that writes
   `policy.access: 'full'` together with a matching, SIGNED `access_ack`. It refuses a role whose
   resolved runtime doesn't advertise `full_access: true` (`agent scan --json`; claude, codex,
   opencode, antigravity, kimicode, grok, qwen, copilot, crush and pi — not vercel, hermes,
   qwen-rpc or pi-rpc). `monomind org role set-access <org> <role> scoped` (a revoke) needs no signature and
   stays allowed everywhere.
2. **The grant is refused outright when it looks agent-invoked.** Scoped chats/orgs already let an
   agent run `monomind org …` through an allowed Bash prefix, so before doing anything else,
   `set-access full` checks [`agent-context.ts`](packages/@monomind/cli/src/orgrt/agent-context.ts)'s
   `detectAgentContextMarker()` for `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT` (Claude Code sets both
   on every process it spawns for a turn), `MONOMIND_ORG_ROLE` (an org role's own session env),
   `MONOMIND_SDK_AGENT` (a codex/kimicode/opencode hook-handler spawned from inside a role's tool
   call) or `MONOMIND_AGENT_EXEC` (set on `agent exec`'s runner child env, covering a coder-mode
   chat turn with no org role of its own). Any one of these refuses the grant — exit non-zero, "run
   this yourself in a terminal" — regardless of `--yes-i-understand` or a TTY. Outside an agent
   context, a `full` grant still needs an interactive confirmation or `--yes-i-understand`. `scoped`
   is exempt from this check (a downgrade is always safe). This check stops a well-behaved or
   prefix-limited agent; it is not the security boundary — an agent with unrestricted Bash can
   unset env vars (`env -u …`). The boundary is step 3: a role's sandbox or authority mask
   overlays the operator directory with an empty tmpfs, so a grant written from inside a role is
   signed with a throwaway key and never verifies. An agent with unrestricted, unsandboxed Bash
   already has the user's own power and needs no grant.
3. **The grant is signed, not just hashed — `hash` alone is public and recomputable.** Anything
   that can write the org JSON (a mono-agent chat org-design tool, an agent with file access to
   `.monomind/orgs`, a hand-crafted import) could recompute the SAME `access_ack.hash` — it is a
   drift check over fields the file already carries in the clear, not an authenticator.
   [`access-grant-key.ts`](packages/@monomind/cli/src/orgrt/access-grant-key.ts) adds the missing
   authentication: `set-access full` creates (on first use, idempotent) a 32-byte machine-local
   secret key, mode `0600`, in the operator-credential directory
   ([`broker.ts`](packages/@monomind/cli/src/orgrt/broker.ts)'s `defaultOperatorDir()` —
   `~/.monomind/orgrt-operator` by default) — the SAME directory
   [`authority-mask.ts`](packages/@monomind/cli/src/orgrt/authority-mask.ts)'s `authorityDirs()`
   denies Read/Edit on for every scoped/sandboxed role (`role-sandbox-restrictions.ts`'s
   `disallowedTools` and OS-sandbox `denyRead`) — and writes `access_ack.sig`, an HMAC-SHA256 of
   `{org, role, hash, at, by}` under that key. **Residual risk, same class as every other
   authority-dir guarantee in this codebase** (the git guard, the dashboard auth secret): an
   ACTIVE full-access role runs with no sandbox and no authority mask, so it CAN read this key,
   same as any other same-user credential — the barrier is against a SCOPED role, or a
   config-writing path with no shell access, forging a NEW grant, not against a role that already
   has one steering itself further.
4. **The runtime never trusts `policy.access` alone.** [`access-grant.ts`](packages/@monomind/cli/src/orgrt/access-grant.ts)'s
   `resolveRoleAccess()` is the single function every session start calls, and it is the only
   thing that turns a declared `'full'` into actual unrestricted behavior. It never throws — any
   failure below just means the role runs scoped this session:
   - no `access_ack`, or `access_ack.by !== 'human'` → **scoped**, `'suspended'` ("no human
     acknowledgement");
   - `access_ack.sig` is missing → **scoped**, `'suspended'` ("unsigned");
   - `sig` doesn't verify (timing-safe compare) against the grant key — no key on this host, the
     wrong key, or a fabricated `sig` — → **scoped**, `'suspended'` ("invalid-signature");
   - only once `sig` verifies: `access_ack.hash` doesn't match a hash recomputed from the role's
     CURRENT [`access-ack.ts`](packages/@monomind/cli/src/orgrt/access-ack.ts)-covered config
     (prompt/responsibilities, runtime, model, provider, `tool_providers`, `reports_to`,
     `review_input`, `policy.settings`, plus the org's `run_config.allow_unattended_full_access`
     and `run_config.accept_full_access_taint`) → **scoped**, `'suspended'` ("config-changed") —
     so editing ANY of those, by anyone, silently revokes the grant until a human re-runs
     `org role set-access ... full`;
   - the run is unattended (the org has a `schedule` — including one ticked by `org serve`) and
     `run_config.allow_unattended_full_access` isn't `true` → **scoped**,
     `access_state: 'unattended-blocked'`;
   - otherwise → **full**, `access_state: 'active'`.
5. **Every agent-reachable config-writing path is expected to reject or strip `access: 'full'`
   and `access_ack`** — an org-design MCP tool, a hiring/new-agent flow, an org import. None of
   those exist inside monomind's own CLI today (they live in the calling tool, e.g. mono-agent's
   org-design chat tools); `resolveRoleAccess()` above is the actual backstop regardless of what
   such a path does or doesn't strip, since a copied-forward `access_ack` (even with a correctly
   recomputed `hash`) has no way to carry a `sig` that verifies without the grant key.
6. **`org validate`** errors on: an unsupported runtime, `policy.git` explicitly authored below
   `'push'` alongside `access: 'full'` (misleading — it won't be enforced), and taint (below).
   It warns on scoped-only fields left set alongside `access: 'full'` (harmless but misleading)
   and on a role that will run scoped for lack of acknowledgement.
7. **Taint checks** ([`access-taint.ts`](packages/@monomind/cli/src/orgrt/access-taint.ts)): a
   full-access role that is ITSELF an untrusted-input role (`policy.webAllow` non-empty, or a
   `tool_providers` entry that looks like a messages/social/email surface) is always an `org
   validate` **error** — it must not read inbound third-party content directly. A role that DOES
   ingest untrusted input reaching the full-access role via `reports_to` is an error too, unless
   the org names the path in `run_config.accept_full_access_taint` (`["scraper→builder"]` or the
   full arrow-joined path), which downgrades it to a visible warning — and that acceptance list is
   itself covered by the ack hash, so editing it also requires re-acknowledging. The same errors
   are checked again at every session start: a tainted role runs **scoped**, `'suspended'`
   ("tainted"), even if nobody ran `org validate` — another role gaining untrusted input after
   the grant doesn't change this role's ack hash.
8. **Visibility**: `org status`/`org status --json` (`roles_access`, capability
   `org-role-full-access` — see `doc/agent-exec-protocol.md` §7.2) show `access` and
   `access_state` for every role that declares `access: 'full'`.

### Provider kinds (`ProviderSchema`)

`subscription` (default) | `api-key` | `base-url` | `bedrock` | `vertex` | `gemini` | `openai` | `vercel-api-key` | `codex` | `antigravity`

### Org directory constant

`ORG_DIR = '.monomind/orgs'` ([types.ts → ORG_DIR](packages/@monomind/cli/src/orgrt/types.ts#ORG_DIR))

---


## 6. Advanced Features (M1-M5)

### 6.1 M1: Role Tool Providers

**Capability:** `org-tool-providers`

Roles can declare `tool_providers[]` — stdio MCP servers whose tools are exposed to the role alongside the built-in org tools. Each provider's tools are prefixed as `<prefix>__<mcpToolName>` (on the Claude runner: `mcp__org__<prefix>__<tool>`).

**Config shape** ([`types-role.ts → ToolProviderSchema`](packages/@monomind/cli/src/orgrt/types-role.ts#ToolProviderSchema)):

```json
{
  "roles": [{
    "id": "researcher",
    "tool_providers": [{
      "kind": "mcp-stdio",
      "name": "web-search",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-brave-search"],
      "env": { "BRAVE_API_KEY": "..." },
      "allow": ["brave_web_search"],
      "prefix": "web",
      "timeout_ms": 60000,
      "idle_ms": 300000
    }]
  }]
}
```

**Fields:**
- `name`: Unique identifier (alphanumeric + `-_`)
- `command`, `args`: Spawn command for the MCP server
- `env`: Literal environment variables (never expanded from secrets)
- `allow`: Optional tool name allowlist; absent = all tools from the server
- `prefix`: Tool name prefix (default: `name` with `-` → `_`)
- `timeout_ms`: Per-call timeout (default: 660000)
- `idle_ms`: Process exits after this long without calls (default: 300000)

**Arguments:** each tool's `inputSchema` validates the role's arguments on every runtime. Keys listed under `properties` are type-checked. Unlisted keys reach `tools/call` unless the top-level schema sets `additionalProperties: false`, as JSON Schema allows them by default. When `additionalProperties` is itself a schema, unlisted keys are checked against it.

**Lifecycle** ([`tool-providers.ts → ToolProviderHub`](packages/@monomind/cli/src/orgrt/tool-providers.ts#ToolProviderHub)):
- Tool list fetched once per provider config (hash of command, args, env, allow) by a short-lived process, cached for the daemon's lifetime
- Provider process spawned lazily on first call, reused across calls, exits after `idle_ms` idle
- Crash → restarted once per session; after that, calls return `ERROR: tool provider <name> unavailable`
- All provider processes killed on session end and `stopOrg`

**Trace metadata:** Every `tools/call` carries `_meta.trace` for cross-org call-chain tracking ([`role-trace.ts`](packages/@monomind/cli/src/orgrt/role-trace.ts)):

```json
{ "_meta": { "trace": {
  "org": "growth", "run": "run-…", "role": "lead",
  "chain_id": "chn_k3v…", "hop": 2, "turn": 7
} } }
```

| Field | Type | Meaning |
|-------|------|---------|
| `org`, `run`, `role` | string | The org, run id and role making the call |
| `chain_id` | string, `chn_[A-Za-z0-9_-]+` | The chain the role is on: taken from the latest message delivered to it with a `[trace chn_… hop=N]` line; a role that never got one has its own chain, minted on first use |
| `hop` | integer ≥ 0 | The hop from that same line; 0 on a role's own chain |
| `turn` | integer ≥ 1 | The role's turn: 1 for its first, +1 each time a turn ends (the runner's `result`). Every call in one turn has the same value, so they are siblings; a new value is a new turn. Counted per role for the whole run, checkpointed and continued on resume, and kept across a role replacement. It is not reset when the chain changes, so compare it within a role, not across roles |

**Trace on `org_send`:** a role's `org_send` mail — same org, cross-org, cross-process and to endpoint roles — gets the role's current chain at `hop + 1` as its first line, `[trace <chain_id> hop=<hop+1>]`, in the format mono-agent's `WithTrace` writes. A trace line the role put in the body itself is replaced, so a message carries exactly one. The receiving role adopts the line when the message is delivered, so A → `org_send` → B → `org_send` → A climbs one chain (hop 1, 2, 3, …). Mail from a human or operator and task dispatches are not stamped. The runtime does not cap hops or stop loops; it only provides the data a tool provider such as mono-agent needs to.

---

### 6.2 M2: Endpoint Roles

**Capability:** `org-endpoint-roles`

A role with `kind: "endpoint"` is **not an agent session** — it's an automation reached over HTTP. Endpoint roles have no session, mailbox, policy engine, slot, or budget share.

**Config shape** ([`types-role.ts → EndpointSchema`](packages/@monomind/cli/src/orgrt/types-role.ts#EndpointSchema)):

```json
{
  "roles": [{
    "id": "build-webhook",
    "kind": "endpoint",
    "title": "CI Build Automation",
    "reports_to": "coordinator",
    "endpoint": {
      "url": "https://automation.example.com/org-webhook",
      "credential_file": "/abs/path/to/bearer-token.txt",
      "timeout_ms": 600000,
      "input_hint": "Send {build_id, commit_sha} to trigger a build."
    }
  }]
}
```

**Fields:**
- `url`: Where messages are POSTed
- `credential_file` (optional): Absolute path to bearer token file (must be mode `0600`, daemon-owned); sent as `Authorization: Bearer <contents>`
- `timeout_ms` (optional): How long to hold the idle watchdog waiting for a reply (default: 600000)
- `input_hint` (optional): One-line description shown in the boss briefing

**Forbidden keys:** Endpoint roles may not have `policy`, `runtime`, `adapter_config`, `budget_tokens`, `budget_usd`, or `tool_providers` ([`endpoint-roles.ts → ENDPOINT_FORBIDDEN_KEYS`](packages/@monomind/cli/src/orgrt/endpoint-roles.ts#ENDPOINT_FORBIDDEN_KEYS)).

**Delivery protocol** ([`endpoint-roles.ts → deliverToEndpoint`](packages/@monomind/cli/src/orgrt/endpoint-roles.ts#deliverToEndpoint)):

```http
POST <endpoint.url>
Content-Type: application/json
Authorization: Bearer <credential_file contents>

{"orgName","run","from","to","subject","body","messageId"}
```

- **2xx** = delivered
- **Non-2xx** → queued to `inbox.jsonl` with `endpoint: true`, retried after 1s, 5s, 15s
- After 3 failures → `endpoint-unreachable` audit event, message stays queued
- Queued endpoint messages re-attempted every 60s while org runs, plus drained on `startOrg`

**Constraints:**
- Endpoint roles may not be the root (boss) role
- `org validate` enforces structure rules ([`endpoint-roles.ts → endpointStructureErrors`](packages/@monomind/cli/src/orgrt/endpoint-roles.ts#endpointStructureErrors))

---

### 6.3 M3: Operator-Authenticated Cross-Org Delivery

**Capability:** Part of M1-M5 integration

`/api/xdeliver` accepts an **operator credential** that carries human authority — the daemon skips the broker sender-identity check and trusts `fromOrg:fromRole` as given. This allows senders that aren't registered orgs (workflows, automation roles) to deliver messages live ([`server.ts → startOrgServer`](packages/@monomind/cli/src/orgrt/server.ts#startOrgServer)).

**Operator credential:** Stored in `.monomind/operator.key` (generated on first `org serve`), separate from per-org broker credentials. Routes requiring operator authority: `/api/xdeliver`, `/api/human-message`, `/api/answer-question`, `/api/dismiss-question`, `/api/resolve-gate`, `/api/set-approval`.

**Live inbox:** `monomind org inbox` now authenticates with the operator credential (falling back to the sender org's broker credential), fixing the issue where messages to a running org were rejected and silently queued until next start ([`server.ts → startOrgServer`](packages/@monomind/cli/src/orgrt/server.ts#startOrgServer)).

**Message IDs:** Every logical message gets one `messageId` (`msg-<ms>-<8 hex>`) at its origin, stamped at `data.messageId` on every bus copy: in-process `message`/`xorg` copies, both sides of remote delivery, and queued inbox entries. The ID is reused on drain ([`cross-org.ts`, `inbox.ts`](packages/@monomind/cli/src/orgrt/cross-org.ts)).

---

### 6.4 M4: Cross-Root Federation

**Capability:** `org-federation`

Orgs under different project roots can send messages to each other if explicitly allowlisted via `federation` config ([`types.ts → federation`](packages/@monomind/cli/src/orgrt/types.ts#federation)).

**Config shape:**

```json
{
  "name": "release-pipeline",
  "federation": {
    "allow_from": ["build-org", "test-org", "*"],
    "allow_to": ["deploy-org", "*"]
  }
}
```

**Fields:**
- `allow_from`: Org names this org accepts messages from; `"*"` = any; absent = unrestricted
- `allow_to`: Org names this org may send to; `"*"` = any; absent = unrestricted

**Trust domain:** Orgs under the **same project root** are one trust domain and never restricted — federation rules only apply to cross-root delivery ([`cross-org-deliver.ts → deliver`](packages/@monomind/cli/src/orgrt/cross-org-deliver.ts#deliver)).

**Enforcement:**
- Sender's `allow_to` checked by `deliver()` — rejects with `ERROR: federation: <from> may not send to <to>` plus `federation-denied` audit event
- Receiver's `allow_from` checked by `receiveRemote()` — rejects `federation: sender not allowed`
- Broker entries record hosting daemon's project root; `lookupOrg` returns it for cross-root identity checks
- Operator-authenticated deliveries (M3) are **exempt** from federation restrictions

---

### 6.5 M5: Decision Attribution & Request-Scoped Approvals

**Capability:** `org-decision-attribution`

Every human decision (approvals, question answers, gate resolutions) now records **who decided** and supports **request-scoped resolution** ([`approvals.ts`, `questions.ts`, `decisions.ts`](packages/@monomind/cli/src/orgrt/approvals.ts)).

**Request IDs:**
- Each approval request gets `requestId` (`apr-<ms>-<8 hex>`)
- Visible in `org approvals --format json` output
- CLI flag `org approve --request <id>` resolves only that specific request; without it, every pending entry for the `(org, role, action)` pair

**Attribution fields:**
- `resolvedBy`: Who resolved the decision (default: `"human"`)
  - CLI: `org approve --by <name>`, `org deny --by <name>`, `org answer --by <name>`, `org questions dismiss --by <name>`, `org gate-approve --by <name>`, `org gate-reject --by <name>`
  - API: `resolvedBy` param on `/api/set-approval`, `/api/answer-question`, `/api/dismiss-question`, `/api/resolve-gate`
- `resolvedAt`: Timestamp of resolution
- Stored in `approvals.json`, `questions.json`, `gates.json`

**Audit trail:**
Every daemon-side resolution emits an audit event with reason `decision-resolved`, carrying `{kind, ref, resolver, verdict}` ([`server.ts`, `decision-gates.ts → resolveGate`](packages/@monomind/cli/src/orgrt/decision-gates.ts#resolveGate)).

**API changes:**
- Approval requests now carry `requestId` and summarized `input` on the question event
- `org approvals --format json` includes `requestId`, `resolvedBy`, `input` fields

---

### 6.6 Org Skill Library

**Source:** [`orgrt/skill-library.ts`](packages/@monomind/cli/src/orgrt/skill-library.ts), [`orgrt/skill-import.ts`](packages/@monomind/cli/src/orgrt/skill-import.ts)

A skill is a directory `<name>/SKILL.md` (frontmatter + markdown) with optional `.md` reference files. Three roots are searched, first match wins: `<project>/.monomind/org-skills/`, `~/.monomind/org-skills/`, then the 376 curated skills shipped in `@monoes/monomindcli` (`org-skills/`, provenance in `org-skills/SOURCES.md`), then active catalog skills. How to write one (frontmatter, tags from `org-skills/TAGS.md`) and the `org skills` commands are on [Agents & Skills](./agents-and-skills.md#4-adding-an-org-skill).

- **`skills`** are pinned into the role's system prompt and never change mid-run, so the prompt stays a stable cache prefix.
- **`skill_pool`** skills appear only as one-line descriptions; the role loads the full text (or one of its reference files) with `org_skill_load`, which serves only that role's own skills.
- **Discovery is wider than access.** A role with any `skills`/`skill_pool` also gets `org_skill_search`, which ranks the whole library against a query and returns names and descriptions only, marking each hit outside the role's own skills as `(not in your pool)`. Loading stays limited to the role's own skills; for a match outside them the role asks its coordinator to add it to its `skill_pool`. There is no policy switch that widens loading — the config stays the single place that grants a skill (and, through it, its tools).
- **Tools follow skills.** A skill's frontmatter `tools:` names the monomind MCP tools its work needs (`monograph_*`, `monodesign_*`). The daemon attaches the monomind MCP server to the role as a tool provider allow-listed to exactly the tools its skills declare — a code role gets the code graph, a copywriter gets nothing extra. A role-configured provider named `monomind` wins over the derived one.
- `org validate` and `org run` fail on an unknown skill name or a `tag:` selector that matches nothing. `org migrate` turns an old archetype `ui.icon` into an explicit `skills` entry.

```bash
monomind org skills search "backend engineer REST APIs postgres"   # rank skills for a role
monomind org skills show systematic-debugging                        # read one
monomind org skills import obra/superpowers --global                 # MIT/Apache-2.0 only
```

`import` accepts `owner/repo`, a git URL or a local path; it copies only `.md` files, refuses any skill whose governing license (its own frontmatter or LICENSE file, else the repository's) is not MIT or Apache-2.0, records `source`/`source_path`/`source_commit`/`license` in the frontmatter, and keeps the license text beside the skill.

### 6.7 Sections (generally available)

**Config shape:** `run_config.experimental: "eval"` is no longer required. A sections org
starts, resumes and restarts roles through the normal `org run` / `org serve` path. An org that
still declares `experimental: "eval"` keeps the old eval-harness-only start (`startOrg({evalGate:
true})`) and the no-restart rule.

A sections org partitions roles into **sections** — isolated sub-orgs, each with its own budget,
single-writer document policy, lead rights and loop/rework rounds. Sections cannot talk to each
other directly: **docs are the only cross-section channel** (one cross-section predicate; a role
in no section is never treated as a cross-section case).

**Isolation registry** (`orgrt/runtime-isolation.ts`): every runtime kind has one strategy —
`mask-bind`, `in-process`, `config-env`, `private-home` or `refused` — with its credential files,
native directories, probe state and verification status. `codex`, `pi`, `antigravity`, `opencode`
and `crush` run with a private, masked home (`CODEX_HOME`, `PI_CODING_AGENT_HOME`, etc.); `claude`
runs in-process with a per-role private copy of its native transcripts (the copy-inventory entry
below). `kilo` and `freebuff` are `refused` in a sections org and report why:

| Runtime | Sections support | Reason |
|---|---|---|
| `kilo` | refused | full-access only (§ Coder Mode), and a sections org refuses full access |
| `freebuff` | refused | discovery stub only — its CLI has no headless transport |

Every other runtime without a copy-inventory entry is also refused in a non-eval sections org
until it gets one; only Claude roles have one today. `agent scan` and `doctor -c agent-runtimes`
report `execution_supported` and the refusal reason for each.

**Hardening (gate rows R1–R7):**

- **R1 — single-daemon lock:** an OS-held lock per org root; a network filesystem is refused.
- **R2 — authenticated routing envelopes:** cross-section/task-routing messages are signed and
  verified, not trusted by shape alone.
- **R3 — mail digest read-denial:** per-recipient mail digests; a role cannot read another
  role's digest.
- **R4 — mail digest write-denial:** mail digests are immutable and hash-journalled; a write to
  an existing digest is denied.
- **R5 — per-role private native copies:** each role gets its own copy of runtime-native state
  (e.g. Claude's transcripts) instead of sharing one.
- **R6 — host preflight:** authority mask, SDK sandbox and copy-inventory checks run on every
  start, resume and role replacement.
- **R7 — adversarial probe suite:** a mutation check exercises the above under fault injection.

**Scheduled sections orgs:** `org validate` no longer refuses `schedule` for a sections org (an
eval-mode org still cannot be scheduled — only the eval harness starts it). Every scheduled tick
is a fresh run with its own run id and document store through the same start path as a manual
run, so the host preflight, the eval gate and the daemon lock all apply — there is no
carry-forward between ticks. A tick that cannot start (preflight refusal), lands on a run that is
already live, or lands mid-run leaves a line in `<org dir>/schedule-audit.jsonl`; a boss
auto-restart during a scheduled run no longer leaves the restarted run outside the tick's
`max_run` bound.

**Related runtime fixes:**

- Trusted runner inputs no longer sit in a writable temp root
  ([#599](https://github.com/monoes/monomind/issues/599)): the hermes, cline and kimi prompt
  files live under `<monomind home>/runner-inputs`, one directory per org role, which sections
  role protection hides from every other role.
- An `is_error` tool result now ends the session at once instead of leaving it to time out; the
  release lock reads a run's end from its own bus log rather than `runtime.json` alone
  ([#611](https://github.com/monoes/monomind/issues/611)).
- A role may read the persisted tool output of its own prior sessions
  ([#622](https://github.com/monoes/monomind/issues/622)).
- A role's Bash timeout is capped to a fraction of the time left in a run that has a deadline, so
  a long command can no longer outlive the run itself
  ([#623](https://github.com/monoes/monomind/issues/623)).

---

## 7. Supporting Modules

### OrgBus (`bus.ts`)

- Append-only JSONL event log at `<org>/bus.jsonl` + in-process fan-out.
- `emit()` queues disk writes serially (never blocks callers), fans out synchronously.
- `flush()` awaits all pending disk writes.
- 10 event types: `message | xorg | tool | asset | chat | status | audit | usage | question | gate`
- `OrgBus.readHistory()` (static) — reads bus.jsonl from disk for replay.

### Dashboard forwarder (`forwarder.ts`, `dashboard-health.ts`)

- Forwards every bus event to the dashboard `.monomind/control.json` names.
- That dashboard is used only while its pid is alive, the server script it runs still exists on
  disk (recorded as `server` in control.json, or read from the process's command line), and —
  when control.json records a `version` — that version is this CLI's.
- Otherwise the forwarder heals once per process: it stops the stale dashboard if it can prove it
  is this project's own (it runs a monomind dashboard script from this project directory; proven
  from `/proc`, so it never stops one on platforms without it), reuses a live dashboard already
  serving this project on ports 4242–4251, and only then starts a new `server.mjs`, recording
  its `server` path and `version`.

### State Detector (`state-detector.ts`)

Infers a role's current activity from the raw SDK message stream — wired into the session
loop at [`session-run.ts → runOneSession`](packages/@monomind/cli/src/orgrt/session-run.ts#runOneSession) (`const detector = new StateDetector()`):

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
path at [`commands/org-serve.ts → serveAction`](packages/@monomind/cli/src/commands/org-serve.ts#serveAction). If any check fails, the run is skipped rather
than started, and the failure is logged.

### Remote Hosts — SSH Cross-Org Dispatch (`remote.ts`)

A **separate SSH-based transport** from the broker's HTTP cross-process delivery described in
§4.3 above — the two are not the same mechanism and shouldn't be conflated. Hosts are
registered in `.monomind/orgs/remote-hosts.json` (`RemoteRegistry`); `lookupRemoteOrg(name,
projectRoot)` resolves a target org name to a `RemoteHost` ([`remote.ts → lookupRemoteOrg`](packages/@monomind/cli/src/orgrt/remote.ts#lookupRemoteOrg)), and
`deliverRemote()` ([`remote.ts → deliverRemote`](packages/@monomind/cli/src/orgrt/remote.ts#deliverRemote)) shells out over SSH to deliver a message. It's the last
fallback in `deliver()`'s cross-org path, tried after local-org and broker lookups both come up
empty ([`cross-org-remote.ts → deliverRemote`](packages/@monomind/cli/src/orgrt/cross-org-remote.ts#deliverRemote)).

> **Known issue — SSH dispatch currently fails.** `deliverRemote()` shells out to
> `npx monomind org inbox <name> --json ...` on the remote host ([`remote.ts → deliverRemote`](packages/@monomind/cli/src/orgrt/remote.ts#deliverRemote)), but
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
- `MAX_TOOL_ROUNDS = 10`: the default tool-call round cap per mailbox message. `run_config.max_tool_rounds`, or a role's own `max_tool_rounds`, changes it for a role. When a round reaches the cap, its calls don't run. Each gets a tool result saying the round cap was reached, so the role knows why. It then gets one wrap-up round whose calls do run, to report its progress and ask to be continued (e.g. `org_send` to whoever gave it the work). Calls after the wrap-up round are dropped with a `[monomind] tool-call round cap … dropping` note on the bus ([`tool-fence.ts → runToolRound`](packages/@monomind/cli/src/orgrt/tool-fence.ts#runToolRound)).
- `buildToolProtocol(tools)` — renders org tools as system-prompt markdown.
- `parseToolCalls()` / `executeToolCall()` / `formatToolResults()` — parse → execute → format.

### Checkpoint (`checkpoint.ts`)

Resume state persistence:

- `OrgCheckpoint` includes: `status`, `run`, `pid`, `updated`, `roleState`, `pendingRoles`,
  `abandonedRoles`, `checksum`.
- `RoleCheckpoint` includes: `mailboxQueue`, `mailboxClosed`, `tokensUsed`, `costUsd`,
  `lastMessageId`, `sessionId`, `status`, `error`, `scrollback?: string[]` (last N lines of
  terminal output, [`checkpoint.ts → RoleCheckpoint`](packages/@monomind/cli/src/orgrt/checkpoint.ts#RoleCheckpoint) — backed by the bounded ring-buffer `ScrollbackBuffer`
  class, [`daemon-types.ts → ScrollbackBuffer`](packages/@monomind/cli/src/orgrt/daemon-types.ts#ScrollbackBuffer), 500-line default cap; restored on resume at
  [`checkpoint-ops.ts → resumeOrg`](packages/@monomind/cli/src/orgrt/checkpoint-ops.ts#resumeOrg)).
- TTL: 24 hours (`CHECKPOINT_TTL_MS`).
- `captureCheckpoint()` — called **before** mailboxes close in `finishStop()`. In that stop
  checkpoint a role whose session was still live is recorded with `status: "stopped"`, never
  `"running"`; resume brings it back as running.
- `validateCheckpoint()` — recomputes checksum before applying.

---

## 8. Session and Tools

**Source:** [`orgrt/session.ts`](packages/@monomind/cli/src/orgrt/session.ts)

### Role System Prompt (`buildRolePrompt()`)

Constructs system prompt containing:
- Agent id, title, org goal
- A `Task for this run:` block with the `org run --task` text, whenever it differs from the goal (every role gets it, not only the coordinator; a run with no task, or one equal to the goal, adds nothing)
- Coordinator vs worker role differentiation
- Responsibilities list from org config
- Pinned skills and the on-demand skill catalog (§6.6)
- Communication protocol (org_send usage)
- That the role's `$TMPDIR` is private and cleanup globs must never run on a shared parent (see Private TMPDIR per Session below)
- org_complete instructions (boss only)
- Entity glossary

### Tools Available to Every Role

| Tool | Available to | Purpose |
|---|---|---|
| `org_send` | All roles | Send message to another role or org (`org:role` syntax) |
| `ask_human` | All roles | Queue a question for a human; the answer arrives as a new message. While a `blocking` question is unanswered, `org_complete` is refused except as `partial` with blocker `human` |
| `org_recall` / `org_remember` / `org_learn` | All roles | Cross-run knowledge-graph memory |
| `knowledge_search` | All roles (if enabled) | Semantic search over Second Brain |
| `org_gate` | All roles | Create a decision gate — a hard-blocking human-approval checkpoint for irreversible actions ([`org-tools.ts → buildOrgTools`](packages/@monomind/cli/src/orgrt/org-tools.ts#buildOrgTools)) |
| `org_task` / `org_task_done` / `org_tasks` | All roles | Create, complete, and list tasks in a dependency DAG — deps must already exist, ready tasks auto-dispatch to their assignee ([`org-tools.ts → buildOrgTools`](packages/@monomind/cli/src/orgrt/org-tools.ts#buildOrgTools), backed by the `TaskDag` class, [`task-dag.ts → TaskDag`](packages/@monomind/cli/src/orgrt/task-dag.ts#TaskDag)). `assignee: "auto"` resolves to a live role instead of a fixed id (Jev-or-keyword, see below). `org_task_done` refuses (tool error, task left as-is) when any of the task's own deps are not yet `done`/`cancelled` — completing early used to promote dependents before their prerequisite work existed (#246) — and when the task has already reached a terminal status, naming the caller's own open tasks instead (#319, see below). `org_tasks` takes an optional `taskId` and then returns only that task's row — status, result and latest evidence — instead of the whole DAG, which on a long run is large enough to be spilled to a file ([`decisions.ts → dagListTasks`](packages/@monomind/cli/src/orgrt/decisions.ts#dagListTasks)). |
| `org_skill_load` | Roles with `skills`/`skill_pool` | Load the full text of one of the role's own skills, or one of its reference files (§6.6) |
| `org_skill_search` | Roles with `skills`/`skill_pool` | Search the whole skill library by name and description; loading stays limited to the role's own skills (§6.6) |
| `org_complete` | Boss only | Signal that the org's goal is achieved |

`org_gate` and the `org_task*` trio are literally the tools this org's own agents use for
gated approvals and dependency-tracked work.

**Strict arguments.** Every tool above rejects an argument key it does not declare, at the top level and inside nested objects (`org_plan_graph` nodes, `org_task_done` evidence and checks, `org_task_split` children, `org_learn` entries). The call fails with a tool error that names the key and changes nothing, and each schema advertises `additionalProperties: false` so the model sees the rule. Stripping the key instead let a wrong field name pass silently: `org_plan_graph` nodes carrying `deps` (org_task's field) instead of `after` were accepted with no edges, so every node started at once. Keys callers are known to confuse get a correction in the error: `deps` on an `org_plan_graph` node points to `after` (node names), and `after` on `org_task` points to `deps` (task ids) ([`tool-fence.ts → strictArgs`](packages/@monomind/cli/src/orgrt/tool-fence.ts#strictArgs)). Tool-provider tools (§6.1) keep their own `inputSchema` rules.

**Claude Code harness tools a role does not get.** Every claude-runtime role, at every `policy.git` level, runs with `AskUserQuestion`, `ScheduleWakeup`, `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`, `CronCreate`, `CronDelete`, `CronList`, `EnterPlanMode` and `ExitPlanMode` in the SDK's `disallowedTools` ([`org-harness-tools.ts`](packages/@monomind/cli/src/orgrt/org-harness-tools.ts)), so the model never sees them. They either wait on a human who isn't attached to a headless session or schedule and track work outside the org's task DAG, where no other role and no daemon watchdog can see it. The org equivalents are `ask_human`, `org_task`/`org_tasks` and `org_task_block`. `SendMessage` stays denied by the policy engine as before.

### Task Dispatch and Completion Notices

A ready task is handed to its assignee by [`decisions.ts → dispatchReadyTasks`](packages/@monomind/cli/src/orgrt/decisions.ts#dispatchReadyTasks)
as one mailbox line, `[task:<id>] <title>` (plus `[loadout:<name>]` when one was selected).
`org_task` and each `org_plan_graph` node take an optional `brief` (at most 4000 characters) — the
creator's instructions: scope, acceptance criteria, paths, what failed last time. It is stored on
the task ([`task-dag-types.ts → OrgTask`](packages/@monomind/cli/src/orgrt/task-dag-types.ts#OrgTask)), so it
rides the checkpoint and split children inherit it, and [`task-provenance.ts → dispatchLine`](packages/@monomind/cli/src/orgrt/task-provenance.ts#dispatchLine)
appends it below the title in every dispatch of the task — the first one, one made later when its
deps complete, and a re-dispatch after a refused close or a resume. A briefing sent as a separate
`org_send` only joins the dispatch if it lands inside the 500 ms coalescing window; on the 2.16.0
release run it often did not, and assignees started, or finished, tasks before their briefs arrived.
The `[task:<id>]` tag is also the routing key: with `run_config.session_scope: "task"` the role's
model session is keyed per task, so a dispatch resumes that task's session
([`session-ledger.ts → mailRouteKey`](packages/@monomind/cli/src/orgrt/session-ledger.ts#mailRouteKey)).

`org_task`'s `assignee` accepts the literal string `"auto"`: [`task-match.ts → resolveAutoAssignee`](packages/@monomind/cli/src/orgrt/task-match.ts#resolveAutoAssignee)
picks the role with [`task-match.ts → pickTaskRole`](packages/@monomind/cli/src/orgrt/task-match.ts#pickTaskRole)
from the task's title and the first 600 characters of its brief. Candidates are the agent roles
other than the caller — an endpoint role or the role creating the task is never picked. The Jev
decision model decides when configured (`MONOMIND_JEV_URL` / `TYPESAFE_API_KEY`, see
[Routing](./routing.md)) and its answer clears the confidence floor; otherwise (Jev unset, a failed
call, low confidence) a deterministic keyword match over each role's id, title and
responsibilities does. It drops stopwords, weighs each word by how few candidates mention it (a
word every role shares — the org's rules skill, "worktree" — counts for nothing), counts title
words double and the title's leading verb double again, and needs a score of at least
`MIN_ROLE_SCORE` (1.5). Among the roles that clear it, each score is multiplied by how that role did on similar finished tasks of this run (title-word overlap of at least 0.2; `done` counts as a success, `failed` as a failure): a factor in [0.85, 1.15] once a role has 3 such outcomes, 1 before that, so history breaks near-ties but cannot overturn a gap wider than 1.35× ([`task-match.ts → roleOutcomePrior`](packages/@monomind/cli/src/orgrt/task-match.ts#roleOutcomePrior)). Equal scores go to the more specific role — deeper in the reporting tree,
then the narrower description — and between interchangeable roles (say two identical developers)
to the one with fewer open tasks, never to whichever is declared first; a tie that survives all
of that, like no role clearing the bar, refuses the call with an error naming the closest roles,
so the caller names the assignee. The wiring is unconditional (an earlier gate, commit
`7b767f8a4`, left a literal `"auto"` assignee `ready` forever when Jev was off).

Every task created by `org_task` records `assignedBy` (`"auto"` or `"explicit"`); an auto-assigned
one also records `pick` — `method` (`jev`, `keyword`, or `only` when a single candidate was left),
Jev's `confidence` or the keyword `score`, and the top three `candidates` — and emits a
`task-auto-assigned` audit event with the same data. All of these are optional task fields, so they
ride the checkpoint and older checkpoints load unchanged.

Each dispatch also names the assignee's unloaded on-demand skills that fit the task's title and
brief, appended to the mailbox line — `Skills that fit this task (load with org_skill_load): <names>`
([`task-provenance.ts → dispatchLine`](packages/@monomind/cli/src/orgrt/task-provenance.ts#dispatchLine),
[`picks.ts → suggestTaskSkills`](packages/@monomind/cli/src/decision/picks.ts#suggestTaskSkills)):
Jev's pick when it answers, otherwise a keyword match over the pool (`MIN_SKILL_SCORE`, at most
two, near-ties broken the same bounded way by the outcomes of this run's tasks that loaded each skill — [`task-match.ts → skillOutcomePrior`](packages/@monomind/cli/src/orgrt/task-match.ts#skillOutcomePrior)), and only ever names from the role's own pool. The suggestion is recorded on the task
(`suggestedSkills`) with a `task-skills-suggested` audit event (`method`: `jev` or `keyword`). When
the role then loads a skill with `org_skill_load`, a `skill-loaded` audit event says whether an open
task of that role suggested it, and the skill is added to that task's `loadedSkills` — so
suggestion adherence can be read from the bus or the checkpoint.

`org_task_done` closes the task the caller names, and with `run_config.notify_task_creator` the
creator is sent `[task:<id>] DONE — …`. Both the tag and the title come from the task that just
closed, never from the caller's session state. Because a session resumed for a follow-up task still
carries the earlier task in its context, a close aimed at a task that already reached a terminal
status is refused (`task-already-closed` audit event) and the refusal names the caller's own open
tasks — re-closing used to succeed and send the creator a second notice for work reported long ago
while the real task sat `running` (#319). When the assignee re-closes its own `done` task with
nothing else open, which is a retry of a close that succeeded, the refusal says the earlier close
was accepted and nothing else is needed.

When a role's turn ends (the runner's `result` message, i.e. its session is about to park),
[`dag-dispatch.ts → nudgeOpenTasksAtTurnEnd`](packages/@monomind/cli/src/orgrt/dag-dispatch.ts#nudgeOpenTasksAtTurnEnd)
checks what it left open: for each of its own `running` tasks it delivers one short
`[task:<id>] STILL OPEN — …` message naming the task and what closing it takes (`evidence` too when
`run_config.completion_evidence` is on) and emits a `task-open-at-turn-end` audit event. It is
bounded — nothing is sent while the role still has mail queued or coalescing (it is about to work
again), a task blocked on a real-world time (`org_task_block`) is never nudged, and each task earns
at most one nudge per dispatch. It does not change the idle watchdog, which remains the org-wide
backstop.

#### Blocked tasks

`org_task_block(taskId, untilIso, reason?, recheckAfterMinutes?)` moves a `running` task (or an
already `blocked` one, to re-block it) to `blocked` until `untilIso`. The idle watchdog holds
through an active block and, when the time passes, flips the task back to `running` and re-sends it
([`task-dag.ts → unblockExpired`](packages/@monomind/cli/src/orgrt/task-dag.ts#unblockExpired)).

Nothing external wakes a blocked task. A background command's completion or a Monitor event exists
only in the role's own process stream, and `session_idle_exit_ms` may have ended that process; npm
propagation reaches nobody. So every block is re-checked
([`block-recheck.ts → wakeDueBlockRechecks`](packages/@monomind/cli/src/orgrt/block-recheck.ts#wakeDueBlockRechecks)):
every `run_config.block_recheck_minutes` (default 5), or the block's own `recheckAfterMinutes`, the
assignee gets `[task:<id>] still blocked (reason: …; until …) — re-check now …` and a
`task-block-recheck` status event is emitted. The role closes the task (`org_task_done` works on a
blocked task), re-blocks it, or reports. Re-checks repeat until the deadline or the close. The next
re-check time (`recheckAt`) and the interval are on the task row, so they ride the checkpoint: after
a resume, a re-check that fell due while the daemon was down fires on the first tick. A block
restored from a checkpoint written before this existed is scheduled on the first tick. Roles should
run waits in the foreground rather than block on a command they started.

#### Budget-closed assignees

A role that spends its own `budget_usd` or `budget_tokens` has its session closed
(`budget-exhausted` status event). Its open tasks, and any task dispatched to it afterwards, become
`blocked` with the reason in `blockedReason`, e.g.
`assignee "release-auditor" closed: budget_usd exhausted ($12.17 / $12)`, so `org_tasks` shows why
instead of an unstarted `ready` task
([`budget-closure.ts`](packages/@monomind/cli/src/orgrt/budget-closure.ts)). Such a block has no
`untilIso`: the idle watchdog neither expires it nor treats it as a legitimate wait. The
`dispatch-recipient-unavailable` audit event says "budget exhausted" rather than "crashed or
unreachable". The coordinator gets a `[budget]` notice when the role closes, and each task
dispatched to the closed role afterwards sends its creator (or the coordinator) a
`[task:<id>] BLOCKED` notice. The coordinator is also warned, once per run, when a role passes 80%
of its `budget_usd` or of its token cap (its own `budget_tokens`, or its even split of
`run_config.budget_tokens`), and when the whole run passes 80% of `run_config.budget_tokens`. Each
warning is a `budget-warning` audit event whose `data.budget` names the budget: `budget_usd`,
`budget_tokens` or `run_config.budget_tokens`.

When the run's total token spend reaches `run_config.budget_tokens`, every open session is closed
(`org-budget-exhausted` status event), roles not yet spawned stop being spawned, and the closed
roles' tasks are held the same way, e.g.
`assignee "dev" closed: org-wide budget_tokens exhausted (1203 / 1000)`.

To recover, raise the role's `budget_usd` / `budget_tokens` in the org definition and run
`monomind org reload <name>`. The new cap applies to total spend, which is kept. Once the role is
under it, its session resumes (`role-budget-reopened` audit event) and its held tasks go back to
`ready` and are dispatched. `org_respawn_role` is not needed for this.

For the org-wide ceiling, raise `run_config.budget_tokens` and reload. If the run's total spend is
now under the new value, the roles the ceiling closed resume with their spend kept, unspawned roles
can be spawned again, their held tasks are dispatched (`org-budget-reopened` audit event), and the
ceiling stays enforced at the new value. A raise that leaves the ceiling at or below the spend
keeps them closed and updates the numbers in the held tasks' reason. A role that is also over its own cap
stays closed until that cap is raised.

A reload recomputes the token cap of every live role that uses the value the definition gives it.
So a changed `run_config.budget_tokens`, or a role gaining or dropping its own `budget_tokens`,
moves the even split of the other roles too. A role closed on its old share reopens when its new
share is above its spend. A role given an explicit budget by `org_respawn_role` keeps it. Adding
roles in a reload does not by itself move the live roles' shares; the next reload that changes a
token budget counts them.

#### Token budgets on codex and antigravity roles

`budget_tokens` (a role's and `run_config.budget_tokens`) is charged on uncached input plus output,
with cache reads and writes counted separately. The Claude runtime reports usage that way. The codex
and agy CLIs report the whole prompt as input with the cached part inside it (codex
`cached_input_tokens`, agy `cache_read_tokens`), so their runners move the cached part out of
`tokens_in` into `cache_read` (and codex's `cache_write_input_tokens` into `cache_creation`) before
metering ([`runner-usage.ts`](packages/@monomind/cli/src/orgrt/runner-usage.ts)). A usage event's
`tokens` total is unchanged. Before #550 the cached part was charged as uncached, so one turn could
spend 7-35 times a role's budget and exhaust the org-wide ceiling for every other role.

Neither CLI reports usage while a model call runs, so the budget is checked at coarser points than on
the Claude runtime:

- **antigravity** reports usage per completed step, each step's usage being that step's own model
  call (checked live against agy 1.2.14: the steps of a four-call exec summed exactly to its
  `result.usage`). Each step is metered as it completes, and the exec is killed at the step that
  exhausts the role's budget.
- **codex** (`codex exec --json`) reports usage only when the exec ends, and an exec is a whole agent
  run. Each exec is metered when it ends, and no further tool round is started once the budget is
  spent. An exec that has started runs to its end, so a role can still overshoot its budget by one
  exec.
- Neither runner starts an exec when the role has less than 5% of its token cap left, or when its
  session was closed for budget (its own cap, `budget_usd`, or the org-wide ceiling). The role is
  then closed for budget (`budget-exhausted` status event, `error_budget` usage subtype) instead of
  counted as a failed turn. Under the floor such a role counts as out of budget: the coordinator's
  notice and the held tasks give its numbers, and `org reload` reopens it only once its token cap
  leaves more than the floor.
- Neither CLI reports a cost, so `cost_usd` is `null` and `budget_usd` never binds on these roles.
  Use `budget_tokens` for them.
- The org-wide ceiling is checked on each `usage` event, which these roles emit once per mailbox
  message, so it can still be passed by the message in flight when it is reached.
- A checkpoint written before this fix holds the old, inflated usage for these roles, and resuming
  from it restores that. Start the run fresh, or raise the role's `budget_tokens` to cover it.

#### Cancelled tasks

`org_task_cancel(taskId, reason?)` marks the task `cancelled` and stops its assignee's work on it
([`task-cancel.ts → stopCancelledTaskWork`](packages/@monomind/cli/src/orgrt/task-cancel.ts#stopCancelledTaskWork)).
The assignee gets `[task:<id>] CANCELLED by "<role>" (<reason>) — stop now, do not commit or report
further work for it`, and a `task-cancel-notified` status event is emitted. Mail reaches a role only
when its turn ends, so in task scope (`session_scope: 'task'`) the assignee's process for that task, if
one is running, is also ended the way a sandbox fault ends it: the runner is aborted and its child
killed (`task-cancel-stopped` status). Processes for the role's other tasks are not touched. The
notice then starts a fresh session for the task instead of resuming the long one. In role scope one
process serves every task, so only the notice is sent, and the role reads it when its turn ends. A
role cancelling its own task is not sent anything. `org_task_done` on a cancelled task is refused
with the cancel reason and the instruction to stop (2.16.2 release run: the fixer worked on and
committed for 25 minutes after its task was cancelled).

### Cost and Token Accounting

The Claude SDK reports `total_cost_usd` and `modelUsage` as running totals for the CLI process, so
each `result` is turned into a per-turn delta before it reaches the `usage` event and the role's
`maxUsd`/`maxTokens` meters ([`cumulative-meter.ts → CumulativeMeter`](packages/@monomind/cli/src/orgrt/cumulative-meter.ts#CumulativeMeter)).
A resumed session runs in a new process, and Claude Code only carries the old total into it when
that session was the last to exit in the project directory — in an org, with several roles sharing
a cwd, the total usually starts again from zero. The first result of a new process is therefore
compared with the last value the previous process reported for the same session: at least as high
means the total was carried over and only the increase counts; lower means it restarted and all of
it counts. Within one process a total that dips floors at 0. Before this, a resumed session's first
turn was billed as `max(0, small − previous) = 0`.

**`budget_usd` is a hard stop on Claude roles.** USD cost arrives only when a turn ends, so each Claude query carries the SDK's `maxBudgetUsd`, set to what the role has left of its cap, and the SDK stops the query once it is exceeded. Overshoot is limited to the model call in flight. That stop closes the role for budget like any exhausted cap; it is not a failed turn, does not trip the circuit breaker and is not reported as a crash. A role with no USD left starts no query. Codex and antigravity roles report no USD and are unchanged.

**The token meter counts each model response once.** One API response can reach the SDK stream as several assistant messages that share a `message.id` and repeat the same input and cache usage. The Claude runner passes the response id through, and the meter counts only what a message adds over the largest usage already seen for that response (and takes the final output count, not the placeholder on earlier messages). Subagent responses have their own ids and are still counted. Before this fix (#597) roles were metered at roughly twice their real tokens and `budget_tokens` caps closed sessions early.

**A role stopped mid-query still reports its cost.** When an org completes or is stopped, the Claude runner interrupts a working query first. The SDK answers with a result carrying the cost so far, which is recorded as an `interrupted` stop that is not a failed turn. A query that does not answer within 3 seconds is aborted as before.

A turn cut off before its `result` — by `org_complete`, an org stop, or a crash — still gets a
`usage` event for the turns already metered (`subtype: "aborted"`, `cost_usd: null`, since the SDK
reports cost only on `result`). A session aborted by the org's own stop reports a `session-stopped`
status rather than `session-error`.

### Sandbox Faults

A Bash result that is wholly one of bubblewrap's own setup failures — a single `bwrap: Can't …`,
`bwrap: Creating …`, `bwrap: setting up …`, `bwrap: execvp …` (and the other messages bwrap dies
with before it execs the command), optionally after the tool's `Exit code N` line — is the OS
sandbox failing to start, not the command failing
([`sandbox-fault.ts → isSandboxFault`](packages/@monomind/cli/src/orgrt/sandbox-fault.ts#isSandboxFault)).
Output a command produced by running bwrap itself does not count: another `bwrap:` message, or a
setup failure printed among other lines, is the command's own output.
Each one raises a `sandbox-fault` audit event. Two in a row end the role's runner process — a new
process builds a new sandbox — and the same session is resumed (in task scope, that task's session)
with a continuation message saying why (`sandbox-restart` status). This happens at most twice per
task session; after that the role's `reports_to` coordinator is sent one message saying the role's
shell is not running (`sandbox-fault-exhausted` audit event), and later faults are only audited.

### Private TMPDIR per Session

Every role session gets its own temp directory (#480), created by
[`role-tmpdir.ts → createRoleTmpdir`](packages/@monomind/cli/src/orgrt/role-tmpdir.ts#createRoleTmpdir)
before the runner starts: `<base>/<org>-<role>-XXXXXX/`, mode 0700, exported to the runner as
`TMPDIR`, `TMP`, `TEMP` and `CLAUDE_CODE_TMPDIR`. `<base>` is the TMPDIR the role would have had without it, i.e. the
daemon's own (`$TMPDIR`, else `$TMP`/`$TEMP`, else the OS default), so the release org's
`TMPDIR=$HOME/mrg-tmp` becomes `$HOME/mrg-tmp/release-builder-a1B2c3/`. In role scope the role has
one for its session's life; with `session_scope: "task"` each task session has its own. Before, every
role shared the base: a bare `mktemp -d` put `tmp.XXXXXXXXXX` straight into it, and one role's
`rm -rf tmp.*` there deleted the scratch of every other role running at the same time (13 matches
where 3 were meant, 2.19.0 release run). Each role's prompt now says its `$TMPDIR` is private and
that a cleanup glob must never run in a directory other roles also use.

`CLAUDE_CODE_TMPDIR` is for the claude runtime (#503). Claude Code reads it before `TMPDIR`, and its
Bash tool exports it to every command it runs, so an org started from a Claude Code session's Bash
tool (the release org's QA roles start drill orgs that way) inherited the outer session's value. In
the 2.20.0 release run a sandboxed claude role's Bash then saw
`TMPDIR=$HOME/mrg-tmp/claude-1000/claude-1000`, a directory every such role shared. With it set to the
role's directory, the sandboxed Bash tool gets that directory as `$TMPDIR`, and Claude Code keeps its
own files in `claude-<uid>/` inside it.

The subdirectory sits under the base, so the OS sandbox's writable temp root and the file-tool
roots (both built from the base, see `file-roots.ts` above) already cover it. It separates scratch;
it is not a security boundary: every role can still read and write the base, and so each other's
directories.

Cleanup removes only what the runtime created, by exact path, after checking the path is directly
in the base, carries this org's and role's `<org>-<role>-` prefix and is a real directory, not a
symlink
([`removeRoleTmpdir`](packages/@monomind/cli/src/orgrt/role-tmpdir.ts#removeRoleTmpdir)). A task
session's directory goes once its task is closed; the rest go when the role's session ends, and
anything left when the org stops
([`releaseRunTmpdirs`](packages/@monomind/cli/src/orgrt/role-tmpdir.ts#releaseRunTmpdirs)). On start
the org sweeps what a killed daemon left behind
([`sweepStaleRoleTmpdirs`](packages/@monomind/cli/src/orgrt/role-tmpdir.ts#sweepStaleRoleTmpdirs),
`role-tmpdir-sweep` audit event): each directory holds a `.monomind-role-tmpdir.json` marker with its
org, role, run, project root and owner pid, and only a directory whose marker names this org and
project root and whose owner process is gone (or is this process, for an earlier run) is removed. A
directory without a readable marker, of another org or project, or owned by a live process is left.
A daemon crash-restart of one role starts it with a fresh directory.

An explicit value wins: a `TMPDIR` set by a role-specific env overlay applied after the inherited
environment (the git guard, cost tier or provider env) is kept as it is. There is no per-role `env`
field in the org schema; to give a whole run a different base, set `TMPDIR` for `monomind org run`.
If the base does not exist or is not writable, the role runs with the shared base as before.

### Tool Permission Channel

A claude-runtime role asks the SDK host whether each tool call may run, and calls its in-process
org tools, over the stdio channel to its Claude Code process. The SDK closes that channel's input
when the prompt stream ends, so the mailbox stream is kept open for as long as a turn is live
([`mailbox.ts → observeTurn`](packages/@monomind/cli/src/orgrt/mailbox.ts#observeTurn)): the
`run_config.session_idle_exit_ms` window counts from the turn's `result`, not from the SDK's pull for
the next message, and in task scope a message for another task waits for the turn to end before
the process exits. Before this (#331), a turn longer than the idle window, or one that received mail
for another task, had its channel closed mid-turn. Every org tool, `Read`, and Bash call needing a
permission decision then failed with `Tool permission request failed: AbortError: Stream closed`,
while Bash allowed by a static rule kept working. On the 2.16.1 release run the publisher spent
ten minutes unable to close its task.

If the channel closes anyway, the first such tool result
([`sandbox-fault.ts → isChannelFault`](packages/@monomind/cli/src/orgrt/sandbox-fault.ts#isChannelFault))
raises a `channel-fault` audit event and ends the process. The same session resumes in a fresh one
with a continuation message (`channel-restart` status), through the same path and bound as a
sandbox fault. The bound is counted separately for each fault kind. Once it is spent, the
coordinator gets one message (`channel-fault-exhausted`).

### Silent Session Alarm

`SILENT_SESSION_MS = 4 minutes` — if the stream opens but emits zero messages within this window, an alarm is raised.

---

## 9. Human-in-the-Loop Flow

1. A role agent calls the `ask_human` tool with a question string.
2. The question is appended to `<org>/questions.json` and a `question` BusEvent fires (dashboard SSE updates immediately).
3. `monomind org questions <name>` reads pending questions.
4. `monomind org answer <name> <question-id> "<text>"` delivers the answer:
   - **Live delivery** if the org is running (daemon receives it immediately).
   - **Queued offline** if the org is stopped (answer stored, consumed on next start).
   - If the asking role was removed from the org definition, the answer is recorded without delivery and the audit event says `delivery: "skipped"`.
5. `monomind org questions dismiss <name> <question-id> [--reason "<text>"]` closes a question without an answer (`state: "dismissed"` in `questions.json`). It releases the `org_complete` gate and the idle-watchdog hold, and tells the asking role no answer is coming (live, or queued while the org is stopped; not at all for a removed role). The dashboard's Human Input view has a Dismiss button for the same thing.
