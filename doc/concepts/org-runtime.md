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

The `AgentRunner` interface ([`orgrt/agent-runner.ts → AgentRunner`](packages/@monomind/cli/src/orgrt/agent-runner.ts#AgentRunner)) decouples the agent loop from any specific provider SDK:

```typescript
interface AgentRunner {
  run(args: AgentRunArgs): AsyncIterable<AgentMessage>;
}
```

Three concrete implementations are available:

### 2.1 ClaudeAgentRunner (Default)

- **Source:** [`orgrt/agent-runner.ts → ClaudeAgentRunner`](packages/@monomind/cli/src/orgrt/agent-runner.ts#ClaudeAgentRunner)
- **SDK:** `@anthropic-ai/claude-agent-sdk` — wraps `query`, `tool`, `createSdkMcpServer`.
- **Activation:** Default when `MONOMIND_RUNTIME` is unset. Also the fallback inside `runOneSession()`.
- **Singleton:** `defaultClaudeRunner` (line 132) — stateless, reused across sessions.
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
- **Cost tracking:** Token-only (`cost_usd: 0`). Vercel returns token usage but no USD; pricing is vendor-specific and drifts, so we ship with zero and let token budgets enforce.
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
| `gemini` | **Deprecated.** Sets `GEMINI_API_KEY` from `cfg.apiKeyEnv ?? 'GEMINI_API_KEY'` and nothing else — no runtime reads it, so the role silently runs on the default `ClaudeAgentRunner`. `startOrg` warns at start ([`daemon.ts → startOrg`](packages/@monomind/cli/src/orgrt/daemon.ts#startOrg)). Use `vercel-api-key` + `vendor: 'google'` instead. |
| `openai` | **Deprecated.** Same shape as `gemini` — sets `OPENAI_API_KEY` from `cfg.apiKeyEnv ?? 'OPENAI_API_KEY'`, routes nothing, and falls through to Claude. Use `vercel-api-key` + `vendor: 'openai'` instead. |
| `vercel-api-key` | Surfaces the named `apiKeyEnv` for the Vercel runner to read; **auto-resolves runtime to `'vercel'`**. Pair with `vendor` to pick the provider. |
| `codex` | No env setup — Codex CLI reads `~/.codex/auth.json` from `codex login`; **auto-resolves runtime to `'codex'`** |
| `antigravity` | No env setup — Antigravity CLI (`agy`) reads Google OAuth credentials from the OS keyring after interactive login; **auto-resolves runtime to `'antigravity'`** |

---

## 4. OrgDaemon Lifecycle

**Class:** `OrgDaemon` — [`orgrt/daemon.ts → OrgDaemon`](packages/@monomind/cli/src/orgrt/daemon.ts#OrgDaemon)
**Constructor:** `constructor(private root: string, private opts: DaemonOpts = {})`

### 4.1 `startOrg(name, taskOverride?)`

Source: [daemon.ts → startOrg](packages/@monomind/cli/src/orgrt/daemon.ts#startOrg)

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
   `"pi-rpc"`, `"qwen-rpc"`, `"hermes"` (the `RuntimeKind` union in [`daemon.ts`](packages/@monomind/cli/src/orgrt/daemon.ts), dispatched by `resolveRunner()`) —
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

Source: [daemon.ts → stopOrg](packages/@monomind/cli/src/orgrt/daemon.ts#stopOrg)

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

## 5. Org Config Schema

**Source:** [`orgrt/types.ts`](packages/@monomind/cli/src/orgrt/types.ts)  
**Location:** `.monomind/orgs/<name>.json`

`workspace: 'worktree-per-role'` is a real, distinct fourth mode beyond the three above: each
non-boss role gets its own `git worktree add <path> HEAD --detach` under
`.monomind/orgs/<name>/worktree-<role-id>/` ([`daemon.ts → spawnRoleIncarnation`](packages/@monomind/cli/src/orgrt/daemon.ts#spawnRoleIncarnation)), cleaned up on stop
alongside the shared `'worktree'` mode ([`daemon.ts → finishStop`](packages/@monomind/cli/src/orgrt/daemon.ts#finishStop)). Falls back to the shared cwd if the
`git worktree add` call fails for a given role.

### Top-level `run_config` defaults

| Field | Default | Purpose |
|---|---|---|
| `max_concurrent_agents` | `4` | How many role sessions run concurrently |
| `budget_tokens` | `1 000 000` | Token spend ceiling for the entire org run, split evenly across roles unless a role sets its own `budget_tokens` |
| `max_turns_per_message` | `100 000` | Agent turns cap per inbound mailbox message. Deliberately huge (`DEFAULT_MAX_TURNS_PER_MESSAGE`, [`types.ts → DEFAULT_MAX_TURNS_PER_MESSAGE`](packages/@monomind/cli/src/orgrt/types.ts#DEFAULT_MAX_TURNS_PER_MESSAGE)) so the ceiling never bricks a long task — set it explicitly, or a role's own `max_turns_per_message`, to impose a real cap |
| `max_tool_rounds` | `10` | Tool-call rounds per inbound message on the fence-protocol runtimes (every runtime but `claude` and `vercel`, which are bounded by `max_turns_per_message`). A positive integer up to 200 (`MAX_TOOL_ROUNDS_LIMIT`). A role's own `max_tool_rounds` overrides it. What happens at the cap: see the Fence Protocol section |
| `workspace` | `'repo'` | `'repo'` \| `'isolated'` \| `'worktree'` \| `'worktree-per-role'` |
| `idle_minutes` | `10` | Idle timeout in minutes before the watchdog nudges the boss and ultimately calls `stopOrg()`. Unset falls back to 10 ([`daemon.ts → startOrg`](packages/@monomind/cli/src/orgrt/daemon.ts#startOrg)); `0` disables the watchdog. Fractions allowed |
| `block_recheck_minutes` | `5` | How often the assignee of a task blocked with `org_task_block` is woken to re-check it, until the block's deadline or the task's close ([#329](https://github.com/monoes/monomind/issues/329)). Positive, at most 60 (`MAX_BLOCK_RECHECK_MINUTES`), fractions allowed. A block cannot opt out, because nothing external (a background command finishing, a Monitor event, npm propagation) wakes a blocked task; the role may pass `recheckAfterMinutes` (1–60) for one block. Runs on the idle watchdog's tick, so `idle_minutes: 0` disables it along with block expiry. See [Blocked tasks](#blocked-tasks) |
| `circuit_breaker` | _(unset)_ | `{ failure_threshold?, cooldown_ms? }` — trip after N consecutive non-success session results from a role and close its mailbox instead of looping ([`types.ts → circuit_breaker`](packages/@monomind/cli/src/orgrt/types.ts#circuit_breaker), applied [`daemon.ts → circuitBreaker`](packages/@monomind/cli/src/orgrt/daemon.ts#circuitBreaker)) |
| `completion_evidence` | `false` | Gate `org_task_done` on machine-checkable evidence: `{ headSha, worktree?, checks: [{ command, exitCode, expectExit?, expectReason?, output }] }`. A check passes iff `exitCode === (expectExit ?? 0)` — declare `expectExit` for a criterion met by a non-zero exit (a lookup that must 404 → 1, a timeout that must fire → 124) rather than appending `\|\| true`. A non-zero `expectExit` is only for a SINGLE-PURPOSE command and always needs a one-line `expectReason` ("404 = branch not protected"), which renders with the code everywhere (`exit 1 (expected 1: 404 = branch not protected)`) and raises an `evidence-expect-exit` audit event when accepted; on a test suite or other aggregate runner (`vitest`, `jest`, an `npm`/`pnpm`/`yarn` test script, `node --test`, `pnpm -r`, `pnpm --filter … test`, `run verify`, `test:all`) it is refused, because a suite's exit code means "at least one of many things failed" and accepting it accepts every other failure too — run the failing test file alone and declare `expectExit` on that, or exclude it and record the exclusion. A report task (QA, audit) closes on commands proving the report exists and is complete (e.g. `test -s <report>`); the failures it found go in `result`, not `checks`. Evidence from outside a git worktree (a scratch dir, an installed tarball) is pinned to the worktree the artifact was built from. `headSha` must be `headSha` must be the current head of some local work — the `HEAD` of any worktree of the repository or the tip of any local branch; with `worktree` named, that worktree's `HEAD` exactly. A sha that is the head of nothing is stale and refused — unless git has no commit by that name at all, which is refused as an unknown commit (typo?) instead; a `worktree` that is an unfilled placeholder (a literal `<…>`/`{{…}}`, or a nonexistent all-caps path such as `…/SRC`) is refused with a hint to pin the real worktree path ([`completion-gate.ts → checkTaskEvidence`](packages/@monomind/cli/src/orgrt/completion-gate.ts#checkTaskEvidence), heads from [`decisions.ts → localHeads`](packages/@monomind/cli/src/orgrt/decisions.ts#localHeads)). `max_evidence_attempts` (default 3) bounds refused proofs before the task is escalated; a call with no `evidence` object at all is refused without counting |
| `stale_base_threshold` | `0` (disabled) | Warn when the working tree is more than N commits behind its tracking branch ([`types.ts → stale_base_threshold`](packages/@monomind/cli/src/orgrt/types.ts#stale_base_threshold), checked at start in [`daemon.ts → startOrg`](packages/@monomind/cli/src/orgrt/daemon.ts#startOrg) — best-effort, skips silently if git or an upstream tracking branch is unavailable) |

### Role fields (`RoleSchema`)

| Field | Default | Notes |
|---|---|---|
| `id` | required | Any non-empty string ([`RoleSchema`](packages/@monomind/cli/src/orgrt/types.ts) does not constrain its shape — `/^[a-z0-9][a-z0-9_-]*$/i` is the **org name** rule, not this). Must be unique within the org, and every non-root `reports_to` must name one (`checkOrgStructure` in [`migrate.ts`](packages/@monomind/cli/src/orgrt/migrate.ts), run by `org validate`) |
| `type` | `'specialist'` | `'boss'` or `'specialist'` |
| `reports_to` | _(required)_ | `null` → boss |
| `adapter_config.model` | runtime/vendor default | Model string passed to runner. When unset, `resolveModel()` in [`session.ts`](packages/@monomind/cli/src/orgrt/session.ts) picks the vendor default, then the runtime default — `claude-sonnet-5` (`DEFAULT_CLAUDE_MODEL` in [`vercel-providers.ts`](packages/@monomind/cli/src/orgrt/vercel-providers.ts)) for the `claude` runtime and when no runtime is set. `/mastermind:createorg` and `monomind org create` always write it explicitly (the latest model for the role's runtime) so a created org doesn't drift when the default changes |
| `runtime` | _(unset)_ | Per-role runtime override: `'claude'` \| `'kimicode'` \| `'opencode'` \| `'vercel'` \| `'codex'` \| `'antigravity'` \| `'grok'` \| `'qwen'` \| `'crush'` \| `'copilot'` \| `'pi'` \| `'pi-rpc'` \| `'qwen-rpc'` \| `'hermes'`; beats the org-level `runtime` and `MONOMIND_RUNTIME` for this role's sessions |
| `budget_tokens` | _(unset)_ | Per-role token budget override — replaces this role's even split of `run_config.budget_tokens`, so a token-hungry model (e.g. GLM via opencode) doesn't force an inflated org-wide budget. `policy.maxTokens`, when set, still wins |
| `max_turns_per_message` | _(unset)_ | Per-role override of `run_config.max_turns_per_message` — a role doing long build/fix/verify cycles can get more turns without raising the cap for every other role |
| `max_tool_rounds` | _(unset)_ | Per-role override of `run_config.max_tool_rounds`, for a role that makes many tool calls in reply to one message |
| `budget_usd` | _(unset)_ | Per-role USD spend cap. Unlike `budget_tokens` there is **no** org-wide even split: unset means no USD enforcement for this role, only token budgets |
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
| `fileWrite` | `[]` | Glob patterns allowed for writes — relative (matched against the org workdir) or absolute (an explicit, author-written grant; see the file-tool roots note below) |
| `fileRead` | `[]` | Glob patterns allowed for reads — same absolute/relative rule as `fileWrite` |
| `webAllow` | _(unset)_ | Domain allowlist for WebFetch/WebSearch: exact host, suffix match, `*.example.com`, or `*` for any host; `[]` = no web |
| `maxTokens` | _(unset)_ | Per-role token budget override |
| `maxUsd` | _(unset)_ | Per-role USD spend cap — `PolicyEngine.decide()` denies once accumulated cost meets or exceeds it, the same way `maxTokens` works |
| `autoApproveTools` | _(unset)_ | Tool/action names this role may use **without** pausing for human approval, even when on the built-in sensitive list (`Bash`, `WebFetch`, `WebSearch`, `org_complete`). Still subject to `allowTools`/`denyTools` |
| `approvalTools` | _(unset)_ | Extra tool/action names that pause for approval exactly like the built-in sensitive list. Bare names (`org_send`), never the `mcp__org__` form. `autoApproveTools` wins on conflict |
| `fence` | _(unset)_ | Per-role MonoFence tool-fence config (`FenceConfigSchema`) — see [Fence Protocol](#fence-protocol-tool-fencets) |
| `git` | `'read'` | `'none'` \| `'read'` \| `'commit'` \| `'push'` — see [Git policy enforcement](#git-policy-enforcement) |
| `sandbox` | `{ mode: 'auto' }` | OS sandbox for claude-runtime roles below `git: 'push'`: `mode` `'auto'` \| `'required'` \| `'off'`; `allowedDomains` (default `['*']`); `deniedDomains` (opt-in host deny list); `allowWrite` (extra writable paths); `denyWrite` (paths made read-only for the role's shell and file tools, relative paths resolved against the org root — `["."]` keeps a QA role from writing anywhere in the checkout it tests from); `allowUnixSockets` (default `true` — Chrome needs one) |

**Path placeholders.** `{{org_root}}` (the org's project root, not the role's cwd) and `{{home}}` (the home directory of the user running the org) expand in a role's `responsibilities` and in its path-holding policy lists: `fileRead`, `fileWrite`, `sandbox.allowWrite` and `sandbox.denyWrite` ([`prompt-vars.ts`](packages/@monomind/cli/src/orgrt/prompt-vars.ts)). The policy lists expand when the daemon loads the org (at start, on `org reload`, and for a replay), so the file-tool roots and the OS sandbox only ever see absolute paths, and a tracked config can grant `"allowWrite": ["{{home}}/mrg-tmp"]` without hard-coding anyone's home. An unknown placeholder is left verbatim and `org validate` reports it as an error, naming the field.

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
  - **A denied directory that is, or holds, the role's cwd or `~/.claude` goes to the SDK as its existing children (#323, [`sandbox-deny-write.ts`](packages/@monomind/cli/src/orgrt/sandbox-deny-write.ts), Linux only).** The SDK binds `/dev/null` over missing "dangerous files" in the cwd (`.gitconfig`, `.bashrc`, `.mcp.json`, …) and in `~/.claude` (`ide`, `local`, `settings.local.json`, …), and bubblewrap has to create a 0-byte mount-point file for each. Under a read-only `denyWrite: ["."]` (the org root) or `~/.claude`, that failed with `bwrap: Can't create file …: Read-only file system` and took the role's Bash call with it — it only worked while another sandboxed process held the stub. Now every entry that existed at session start is still read-only (a mount point, so it can't be rewritten, removed, renamed or replaced), and the directory itself is a writable bind mount, so it can't be renamed either. What the OS layer newly allows is creating **new** entries directly in that directory (and changing its mode bits). The names that matter to Claude Code or git there (settings, hooks, skills, commands, agents, `.mcp.json`, `.gitconfig`, …) are the SDK's own denies, which it can now enforce because their stubs can be created. The file tools are unaffected: their `Edit(//<dir>/**)` rules and `fileToolDenied()` keep the whole directory, so `Write`/`Edit` still refuse a new file in the org root of a `denyWrite: ["."]` role.
- **Network:** every host is reachable by default (`policy.sandbox.allowedDomains`, default `['*']`), minus the opt-in `deniedDomains`. Git remote hosts are deliberately NOT denied: `read` roles legitimately `ls-remote`; `fetch`/`clone` need `policy.git: 'push'`, and the barrier against publishing is the withheld credentials, verified against the real sandbox (`git ls-remote https://github.com/…` succeeds; a push to an https remote fails with "could not read Username" even with the guard env stripped, because the gh credential helper cannot read `~/.config/gh`).
- **Reads:** credential files (`~/.ssh`, `~/.git-credentials`, `~/.config/gh`, `~/.netrc`) can't be read, and neither can the XDG runtime dir. That dir matters more than the files: it carries the session D-Bus, and through it the login keyring, which is where `gh` actually keeps its token — while it was reachable, `gh auth token` returned the operator's GitHub token to a sandboxed role and a `--dry-run` push to the real repository succeeded. The SDK's own default deny of `/run/user` does not survive passing our own `filesystem` block, so this deny is set explicitly. At `none`, the `.git` dir can't be read either.
- **Unix sockets:** allowed, because Chrome's process singleton needs one — without it `monomind browse` dies with `socket() failed: Operation not permitted`. The sockets that would hand out push credentials or the operator's desktop are masked instead (`$SSH_AUTH_SOCK`, `ssh-agent`'s default `/tmp/ssh-*` dirs, `~/.1password`, `/tmp/.X11-unix`, the docker/podman/containerd sockets, and the runtime dir above). `policy.sandbox.allowUnixSockets: false` blocks every AF_UNIX socket and gives up Chrome.
- **Proxy:** sandboxed egress goes through the runtime's HTTP proxy, which node's global `fetch()` ignores unless `NODE_USE_ENV_PROXY=1`, so the session env sets it for sandboxed roles (an operator value wins). curl, npm and git read the proxy variables on their own.
- **Gating:** Bash commands still go through `canUseTool` (`autoAllowBashIfSandboxed: false`), and the `dangerouslyDisableSandbox` parameter is ignored (`allowUnsandboxedCommands: false`).

The guard's config block is self-contained: it re-emits the operator's own `GIT_CONFIG_*` entries ahead of its own rather than continuing their numbering, so it stays valid even when the child process doesn't inherit them. Its hooks never chain to another guard's dispatcher (a role session nested inside another leaves both `core.hooksPath` values in the config, and each picking the other made them exec each other forever); they do still chain to the repository's own hooks.

The guard protects the git common directories of the role's cwd and of the org root, so worktree-per-role worktrees share their main repo's protection. Scratch repositories elsewhere, such as test fixtures under `$TMPDIR`, can still commit at `read`, but nothing can push below `push`. Every other hook passes through to the repository's own hooks (husky, lint-staged), so they keep running for `commit` roles.

**File-tool roots (`file-roots.ts`, #303).** Until this item, `Read`/`Write`/`Edit`/`Glob`/`Grep` (`policy.ts`'s `PolicyEngine`) were confined to the role's cwd alone — even though the OS sandbox above already made `$TMPDIR`, the org root and `policy.sandbox.allowWrite` writable for Bash, so a role could create a scratch file with Bash but not read or edit it back, and degraded to heredocs. `fileToolRoots()` widens the file tools to match: cwd, `$TMPDIR`, the org root and `policy.sandbox.allowWrite` entries are now all roots, plus an absolute `fileRead`/`fileWrite` glob is honoured as its own explicit grant (independent of any root). Every root is checked on `realpath()`-resolved output, so a symlink inside one root cannot resolve outside all of them.

`$HOME` is deliberately **not** one of these roots, even though it is already writable for Bash above. Bash needs a writable `$HOME` for package-manager caches and installs; the file tools do not, and every denial in the reproduction that motivated this item was under `$TMPDIR`. Granting it to the file tools would make the operator's entire home directory — every other checkout, every note, everything outside the deny list below — readable and editable by an autonomous role, which is a far larger widening than the issue needed and buys nothing the reproduction required. If a future item wants `$HOME` as a file-tool root, it needs its own issue and its own justification; this decision should not silently erode.

Regardless of which root admits a path, a deny pass (`fileToolDenied()`) still blocks credential stores (`~/.ssh`, `~/.git-credentials`, `~/.config/git/credentials`, `~/.config/gh`, `~/.netrc`), guard-undoing config (`~/.gitconfig`, `~/.config/git`, shell rc files, `~/.claude`, `~/.claude.json`), the daemon sockets and the XDG runtime dir listed above — the same lists the OS sandbox already enforces for Bash, now shared from one module so the two boundaries cannot drift apart. This deny pass runs for **reads as well as writes**: `policy.ts`'s `SENSITIVE_FILE` pattern only suppresses bus snapshots of a write, it was never a deny, so before this item a credential file was unreachable by the file tools purely because it sat outside cwd — an accident that would otherwise have vanished the moment a widened root (e.g. `policy.sandbox.allowWrite: [$HOME]`) admitted it.

**Legitimate work stays possible under the sandbox.** The role's cwd, the org root, `$HOME` and the temp dir remain writable, so installs, caches and test fixtures still work; local port binding is allowed for dev servers and tests; and `commit` roles can still commit in worktrees whose git dir sits outside their cwd. Verified inside the real sandbox against this repo (see the workload table in the #258 PR): `pnpm install --frozen-lockfile --offline`, `npm run build` in the CLI package, vitest slices that create git repositories under `$TMPDIR`, `monomind browse` driving headless Chrome, `curl` against a forge API, `node`'s `fetch()`, a nested `claude -p` and `monomind agent exec --runtime claude`, and `monomind init` in a scratch directory all succeed. `~/.claude.json`, the shell rc files and everything already in `~/.claude` stay read-only (only new entries can be created in `~/.claude`, see #323 above), and nothing in that list needs to write them.

**Two things behave differently inside the sandbox**, both from the SDK's own design rather than this code:
- Each Bash call gets its own sandbox, so **a background process does not outlive the call that started it**. A browser session must be driven within one command (`monomind browse open … && monomind browse get title && monomind browse close`); an `open` in one call followed by a `get` in the next silently drives a freshly launched browser.
- The sandbox runtime **shadows its own cwd-relative deny entries with `/dev/null`** (`.bashrc`, `.gitconfig`, `.ripgreprc`, `.idea`, `.vscode`, `.claude/hooks`, …), which is what a role sees as an empty, unwritable file; in the working tree they are untracked noise a `commit` role could `git add -A` into a release. The guard therefore writes an excludes file listing exactly those paths and points `core.excludesFile` at it (only when the sandbox actually runs). Git honours one excludes file, so the operator's own — an explicit `core.excludesFile`, else `$XDG_CONFIG_HOME/git/ignore` — is copied into it at session start; later edits to their file reach the next session. Nothing tracked is hidden: git never ignores a file that is already tracked.
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

### Provider kinds (`ProviderSchema`)

`subscription` (default) | `api-key` | `base-url` | `bedrock` | `vertex` | `gemini` | `openai` | `vercel-api-key` | `codex` | `antigravity`

### Org directory constant

`ORG_DIR = '.monomind/orgs'` ([types.ts → ORG_DIR](packages/@monomind/cli/src/orgrt/types.ts#ORG_DIR))

---


## 6. Advanced Features (M1-M5)

### 6.1 M1: Role Tool Providers

**Capability:** `org-tool-providers`

Roles can declare `tool_providers[]` — stdio MCP servers whose tools are exposed to the role alongside the built-in org tools. Each provider's tools are prefixed as `<prefix>__<mcpToolName>` (on the Claude runner: `mcp__org__<prefix>__<tool>`).

**Config shape** ([`types.ts → ToolProviderSchema`](packages/@monomind/cli/src/orgrt/types.ts#ToolProviderSchema)):

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

**Config shape** ([`types.ts → EndpointSchema`](packages/@monomind/cli/src/orgrt/types.ts#EndpointSchema)):

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

**Operator credential:** Stored in `.monomind/operator.key` (generated on first `org serve`), separate from per-org broker credentials. Routes requiring operator authority: `/api/xdeliver`, `/api/human-message`, `/api/answer-question`, `/api/resolve-gate`, `/api/set-approval`.

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

**Trust domain:** Orgs under the **same project root** are one trust domain and never restricted — federation rules only apply to cross-root delivery ([`cross-org.ts → deliver`](packages/@monomind/cli/src/orgrt/cross-org.ts#deliver)).

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
  - CLI: `org approve --by <name>`, `org deny --by <name>`, `org answer --by <name>`, `org gate-approve --by <name>`, `org gate-reject --by <name>`
  - API: `resolvedBy` param on `/api/set-approval`, `/api/answer-question`, `/api/resolve-gate`
- `resolvedAt`: Timestamp of resolution
- Stored in `approvals.json`, `questions.json`, `gates.json`

**Audit trail:**
Every daemon-side resolution emits an audit event with reason `decision-resolved`, carrying `{kind, ref, resolver, verdict}` ([`server.ts`, `decisions.ts → resolveGate`](packages/@monomind/cli/src/orgrt/decisions.ts#resolveGate)).

**API changes:**
- Approval requests now carry `requestId` and summarized `input` on the question event
- `org approvals --format json` includes `requestId`, `resolvedBy`, `input` fields

---

### 6.6 Org Skill Library

**Source:** [`orgrt/skill-library.ts`](packages/@monomind/cli/src/orgrt/skill-library.ts), [`orgrt/skill-import.ts`](packages/@monomind/cli/src/orgrt/skill-import.ts)

A skill is a directory `<name>/SKILL.md` (frontmatter + markdown) with optional `.md` reference files. Three roots are searched, first match wins: `<project>/.monomind/org-skills/`, `~/.monomind/org-skills/`, then the ~380 curated skills shipped in `@monoes/monomindcli` (`org-skills/`, provenance in `org-skills/SOURCES.md`).

- **`skills`** are pinned into the role's system prompt and never change mid-run, so the prompt stays a stable cache prefix.
- **`skill_pool`** skills appear only as one-line descriptions; the role loads the full text (or one of its reference files) with `org_skill_load`, which serves only that role's own skills.
- **Tools follow skills.** A skill's frontmatter `tools:` names the monomind MCP tools its work needs (`monograph_*`, `monodesign_*`). The daemon attaches the monomind MCP server to the role as a tool provider allow-listed to exactly the tools its skills declare — a code role gets the code graph, a copywriter gets nothing extra. A role-configured provider named `monomind` wins over the derived one.
- `org validate` and `org run` fail on an unknown skill name or a `tag:` selector that matches nothing. `org migrate` turns an old archetype `ui.icon` into an explicit `skills` entry.

```bash
monomind org skills search "backend engineer REST APIs postgres"   # rank skills for a role
monomind org skills show systematic-debugging                        # read one
monomind org skills import obra/superpowers --global                 # MIT/Apache-2.0 only
```

`import` accepts `owner/repo`, a git URL or a local path; it copies only `.md` files, refuses any skill whose governing license (its own frontmatter or LICENSE file, else the repository's) is not MIT or Apache-2.0, records `source`/`source_path`/`source_commit`/`license` in the frontmatter, and keeps the license text beside the skill.

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
loop at [`session.ts → runOneSession`](packages/@monomind/cli/src/orgrt/session.ts#runOneSession) (`const detector = new StateDetector()`):

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
path at [`commands/org.ts → serveAction`](packages/@monomind/cli/src/commands/org.ts#serveAction). If any check fails, the run is skipped rather
than started, and the failure is logged.

### Remote Hosts — SSH Cross-Org Dispatch (`remote.ts`)

A **separate SSH-based transport** from the broker's HTTP cross-process delivery described in
§4.3 above — the two are not the same mechanism and shouldn't be conflated. Hosts are
registered in `.monomind/orgs/remote-hosts.json` (`RemoteRegistry`); `lookupRemoteOrg(name,
projectRoot)` resolves a target org name to a `RemoteHost` ([`remote.ts → lookupRemoteOrg`](packages/@monomind/cli/src/orgrt/remote.ts#lookupRemoteOrg)), and
`deliverRemote()` ([`remote.ts → deliverRemote`](packages/@monomind/cli/src/orgrt/remote.ts#deliverRemote)) shells out over SSH to deliver a message. It's the last
fallback in `deliver()`'s cross-org path, tried after local-org and broker lookups both come up
empty ([`cross-org.ts → deliverRemote`](packages/@monomind/cli/src/orgrt/cross-org.ts#deliverRemote)).

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
  class, [`daemon.ts → ScrollbackBuffer`](packages/@monomind/cli/src/orgrt/daemon.ts#ScrollbackBuffer), 500-line default cap; restored on resume at
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
- Coordinator vs worker role differentiation
- Responsibilities list from org config
- Pinned skills and the on-demand skill catalog (§6.6)
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
| `org_gate` | All roles | Create a decision gate — a hard-blocking human-approval checkpoint for irreversible actions ([`session.ts → buildOrgTools`](packages/@monomind/cli/src/orgrt/session.ts#buildOrgTools)) |
| `org_task` / `org_task_done` / `org_tasks` | All roles | Create, complete, and list tasks in a dependency DAG — deps must already exist, ready tasks auto-dispatch to their assignee ([`session.ts → buildOrgTools`](packages/@monomind/cli/src/orgrt/session.ts#buildOrgTools), backed by the `TaskDag` class, [`task-dag.ts → TaskDag`](packages/@monomind/cli/src/orgrt/task-dag.ts#TaskDag)). `assignee: "auto"` resolves to a live role instead of a fixed id (Jev-or-keyword, see below). `org_task_done` refuses (tool error, task left as-is) when any of the task's own deps are not yet `done`/`cancelled` — completing early used to promote dependents before their prerequisite work existed (#246) — and when the task has already reached a terminal status, naming the caller's own open tasks instead (#319, see below). `org_tasks` takes an optional `taskId` and then returns only that task's row — status, result and latest evidence — instead of the whole DAG, which on a long run is large enough to be spilled to a file ([`decisions.ts → dagListTasks`](packages/@monomind/cli/src/orgrt/decisions.ts#dagListTasks)). |
| `org_skill_load` | Roles with `skills`/`skill_pool` | Load the full text of one of the role's own skills, or one of its reference files (§6.6) |
| `org_complete` | Boss only | Signal that the org's goal is achieved |

`org_gate` and the `org_task*` trio are literally the tools this org's own agents use for
gated approvals and dependency-tracked work.

**Claude Code harness tools a role does not get.** Every claude-runtime role, at every `policy.git` level, runs with `AskUserQuestion`, `ScheduleWakeup`, `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`, `CronCreate`, `CronDelete`, `CronList`, `EnterPlanMode` and `ExitPlanMode` in the SDK's `disallowedTools` ([`org-harness-tools.ts`](packages/@monomind/cli/src/orgrt/org-harness-tools.ts)), so the model never sees them. They either wait on a human who isn't attached to a headless session or schedule and track work outside the org's task DAG, where no other role and no daemon watchdog can see it. The org equivalents are `ask_human`, `org_task`/`org_tasks` and `org_task_block`. `SendMessage` stays denied by the policy engine as before.

### Task Dispatch and Completion Notices

A ready task is handed to its assignee by [`decisions.ts → dispatchReadyTasks`](packages/@monomind/cli/src/orgrt/decisions.ts#dispatchReadyTasks)
as one mailbox line, `[task:<id>] <title>` (plus `[loadout:<name>]` when one was selected).
`org_task` and each `org_plan_graph` node take an optional `brief` (at most 4000 characters) — the
creator's instructions: scope, acceptance criteria, paths, what failed last time. It is stored on
the task ([`task-dag.ts → OrgTask`](packages/@monomind/cli/src/orgrt/task-dag.ts#OrgTask)), so it
rides the checkpoint and split children inherit it, and [`decisions.ts → dispatchLine`](packages/@monomind/cli/src/orgrt/decisions.ts#dispatchLine)
appends it below the title in every dispatch of the task — the first one, one made later when its
deps complete, and a re-dispatch after a refused close or a resume. A briefing sent as a separate
`org_send` only joins the dispatch if it lands inside the 500 ms coalescing window; on the 2.16.0
release run it often did not, and assignees started, or finished, tasks before their briefs arrived.
The `[task:<id>]` tag is also the routing key: with `run_config.session_scope: "task"` the role's
model session is keyed per task, so a dispatch resumes that task's session
([`session-ledger.ts → mailRouteKey`](packages/@monomind/cli/src/orgrt/session-ledger.ts#mailRouteKey)).

`org_task`'s `assignee` accepts the literal string `"auto"`: [`daemon.ts → resolveAutoAssignee`](packages/@monomind/cli/src/orgrt/daemon.ts#resolveAutoAssignee)
picks a live role for the task — the Jev decision model when configured (`MONOMIND_JEV_URL` /
`TYPESAFE_API_KEY`, see [Routing](./routing.md)), falling back to a deterministic keyword match
over each role's title and skills ([`picks.ts → pickRoleForTask`](packages/@monomind/cli/src/decision/picks.ts#pickRoleForTask))
whenever Jev is unset, a call fails, or its confidence is too low — fixing an earlier bug (commit
`7b767f8a4`) where a literal `"auto"` assignee only ever resolved via Jev and stayed `ready`
forever with nothing dispatched when Jev was off, the default.
Separately, when Jev is configured, each dispatch also asks it which of the assignee's own
unloaded on-demand skills fit the task's title and appends the match to the mailbox line —
`Skills that fit this task (load with org_skill_load): <names>` ([`decisions.ts → dispatchLine`](packages/@monomind/cli/src/orgrt/decisions.ts#dispatchLine),
[`picks.ts → suggestTaskSkills`](packages/@monomind/cli/src/decision/picks.ts#suggestTaskSkills)) —
this half has no keyword fallback and is silent when Jev is off.

`org_task_done` closes the task the caller names, and with `run_config.notify_task_creator` the
creator is sent `[task:<id>] DONE — …`. Both the tag and the title come from the task that just
closed, never from the caller's session state. Because a session resumed for a follow-up task still
carries the earlier task in its context, a close aimed at a task that already reached a terminal
status is refused (`task-already-closed` audit event) and the refusal names the caller's own open
tasks — re-closing used to succeed and send the creator a second notice for work reported long ago
while the real task sat `running` (#319).

When a role's turn ends (the runner's `result` message, i.e. its session is about to park),
[`decisions.ts → nudgeOpenTasksAtTurnEnd`](packages/@monomind/cli/src/orgrt/decisions.ts#nudgeOpenTasksAtTurnEnd)
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

A turn cut off before its `result` — by `org_complete`, an org stop, or a crash — still gets a
`usage` event for the turns already metered (`subtype: "aborted"`, `cost_usd` unset, since the SDK
reports cost only on `result`). A session aborted by the org's own stop reports a `session-stopped`
status rather than `session-error`.

### Sandbox Faults

A Bash result that starts with `bwrap: ` is the OS sandbox failing to start, not the command
failing ([`sandbox-fault.ts → isSandboxFault`](packages/@monomind/cli/src/orgrt/sandbox-fault.ts#isSandboxFault)).
Each one raises a `sandbox-fault` audit event. Two in a row end the role's runner process — a new
process builds a new sandbox — and the same session is resumed (in task scope, that task's session)
with a continuation message saying why (`sandbox-restart` status). This happens at most twice per
task session; after that the role's `reports_to` coordinator is sent one message saying the role's
shell is not running (`sandbox-fault-exhausted` audit event), and later faults are only audited.

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

---

## 10. Known Historical Trap (v1 Only)

Early debugging uncovered that the legacy v1 `runorg.md` skill path lost `runId`/`sessionId` because Claude Code truncated long bash stdout — the fix was writing a `<org>-runcontext.json` context file. **This trap applies only to the v1 skill path.** The Org Runtime v2 source (`packages/@monomind/cli/src/orgrt/`) has zero references to `runcontext.json` or `ORG_VARS` stdout parsing — v2 does not use a bash-to-Task handoff.
