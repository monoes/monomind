# Coder Mode: Threat Model & Guardrails

> Part of the **Coder mode** epic ([#364](https://github.com/monoes/monomind/issues/364)) — a
> coding-agent session with full, automated, unrestricted access to the machine, driven through
> `monomind agent exec --access full` instead of a direct CLI spawn. Since protocol rev 19 this
> covers every coding runtime with `full_access: true` in `agent scan --json` (claude, codex,
> opencode, antigravity, kimicode, grok, qwen, copilot, crush, pi; rev 20 adds pi-rpc, cline,
> aider and dsh; #601 adds verified Kilo 7.8.3), not only Claude Code. This document is the
> threat model and guardrail record required by
> [#360](https://github.com/monoes/monomind/issues/360), refined against what was actually built
> in [#355](https://github.com/monoes/monomind/issues/355) (`--access full`),
> [#356](https://github.com/monoes/monomind/issues/356) (`--settings`), and
> [#357](https://github.com/monoes/monomind/issues/357) (`tool_activity`). See
> [`doc/agent-exec-protocol.md`](../agent-exec-protocol.md) §3.1/§3.2 for the wire protocol these
> guardrails sit on top of.

## 1. Threat model

Coder mode is **full access by design**: the user explicitly wants the agent to run any command
and read/write any file with no approval prompts. The user is therefore **not** the adversary.
The risk is **untrusted content steering the agent** (prompt injection) into doing something the
user never asked for, now with a real, unrestricted shell.

| Source of untrusted text | Present in coder mode? | Mitigation |
|---|---|---|
| mono-agent synced messages / DMs / emails / social content (`get_message`, `list_messages`, people notes, …) | **Must not be.** | monomind has no such tool surface at all — there is nothing in this repo to wire in. The guarantee is enforced on mono-agent's side (never handing a coder-mode turn its communications/people tools — monoes/mono-agent#202/#203). Same reason `run_workflow` is locked after any message read in scoped chat. |
| Web pages (`WebFetch`/`WebSearch`, native SDK tools) | Yes, in `--access full` mode. | Accepted risk, identical to running interactive Claude Code with `--dangerously-skip-permissions`. Every native tool call — including `WebFetch` — is still observed via `tool_activity` (§3, below), so a caller can show/log what a fetched page caused the agent to do next. Not blocked; documented as residual risk (§4). |
| Files in the working folder (a cloned third-party repo's own `README`/`CLAUDE.md`/`AGENTS.md`/`.claude/settings.json`) | Yes, when the turn also opts into `--settings project` (or `user`/`local`). | Accepted, with a sharper edge than the original issue's table: `--settings project` doesn't just let the model *read* a repo's `CLAUDE.md` as ordinary file content — the Claude Code SDK's own settings discovery **loads and executes** that repo's `.claude/settings.json` hooks (`PreToolUse`/`PostToolUse`/etc.) as real, code-level hooks (see §4's residual-risk entry). `--settings none` (the default) never discovers or runs anything from the target directory. |
| Other agents' output (subagents, org bus) | Its own `Task` subagents only; in orgs, messages from other roles (for roles granted full access under #365). | Chat coder mode is not exposed as a workflow node, MCP tool, or extension action anywhere in monomind (verified — see §3). Org roles may opt in to full access per role under #365, with the taint checks that issue defines (a full-access role must not itself read untrusted input; a role that does must not hand off to one). |

## 2. Guardrails implemented (monomind side)

### 2.1 No transitive escalation — full access is human-CLI-only

`access: 'full'` can only ever originate from a **human-typed** `agent exec --access full`
invocation, parsed in [`commands/agent-exec.ts`](../../packages/@monomind/cli/src/commands/agent-exec.ts)
(`ctx.flags.access`). From there it flows through exactly one path:
`AgentExecOptions.access` → `orgrt/agent-exec.ts`'s `resolveAccess()`/`checkFullAccessGuards()`
([`orgrt/agent-exec-access.ts`](../../packages/@monomind/cli/src/orgrt/agent-exec-access.ts)) →
`AgentRunArgs.access` → the runner's strict `args.access === 'full'` check. For claude that is
`ClaudeAgentRunner.run()`
([`orgrt/agent-runner-claude.ts`](../../packages/@monomind/cli/src/orgrt/agent-runner-claude.ts)),
the only place `permissionMode: 'bypassPermissions'` + `allowDangerouslySkipPermissions: true`
get set; for every other full-access runtime (rev 19) it is that runner's own switch to its
CLI's no-approval, no-sandbox mode (codex `--dangerously-bypass-approvals-and-sandbox`, opencode
permission `allow`, the others' yolo flags; rev 20: pi/pi-rpc `--approve`, cline on the user's
own `~/.cline` with `--auto-approve true`, aider's shim answering every confirmation yes, dsh
`DSH_PERMISSION_MODE=danger-full-access`), taken only on the same literal `'full'`.

Audited (by direct source inspection, and pinned by regression tests in
`agent-exec-no-transitive-escalation.test.ts` so a future change fails loudly):

| Reachable-by-an-agent path | Status today | Guard |
|---|---|---|
| `monomind mcp exec -t <tool>` (generic "run an MCP tool" CLI/MCP surface, [`commands/mcp-tool-commands.ts`](../../packages/@monomind/cli/src/commands/mcp-tool-commands.ts)) | **Cannot reach it.** `mcp exec` only dispatches to tools registered under `src/mcp-tools/**`/`src/mcp/**`; none of those ~90 tool modules import the agent-exec engine (`orgrt/agent-exec.ts`), `resolveExecRunner`, or `runAgentExec` — verified by a source scan test. There is no `agent_exec`-shaped MCP tool to call in the first place. | Structural: nothing to strip, because the surface doesn't exist. Regression-tested. |
| `agent_spawn`/other `agent_*` MCP tools ([`mcp-tools/agent-tools-lifecycle.ts`](../../packages/@monomind/cli/src/mcp-tools/agent-tools-lifecycle.ts)) | **Unrelated surface.** These are the swarm bookkeeping tools (agent records in a JSON store) — they never call `runAgentExec`/`resolveExecRunner` and have no `access` concept at all. | N/A — different subsystem entirely. |
| Org runtime (`orgrt/session.ts` → `session-stream.ts`'s `sessionRunArgs`, driving every org role's turn) | **Only through the #365 grant gate.** `sessionRunArgs` sets `access: 'full'` only when the session's `resolvedAccess` is `'full'`, and `resolvedAccess` comes only from `access-grant.ts`'s `resolveRoleAccess` (called in `session-full-access.ts`), which requires a human `access_ack` whose HMAC `sig` verifies and whose config hash has not drifted. Anything else — no grant, a forged or copied grant, a drifted config, a runtime without full access support — runs scoped (`permissionMode: 'default'`). Regression tests pin both the single `access:` key in `sessionRunArgs` and its only source. | Signed grant (#365) + regression test. |
| `RolePolicySchema` ([`orgrt/types-policy.ts`](../../packages/@monomind/cli/src/orgrt/types-policy.ts)) | **Declares, never grants.** `policy.access: 'full'` is a real schema field since #365, but on its own it does nothing: without a valid `access_ack` the role runs scoped with state `suspended`, emits a `full-access-not-active` audit event, and `org validate` reports it. | Runtime backstop (#365). |
| Workflow/routine nodes | **No such node exists.** There is no workflow-script or routine primitive anywhere in this codebase that shells out to `monomind agent exec` or imports the agent-exec engine (verified by the same source scan — no `src/**` file outside `commands/agent-exec.ts` and its own tests calls `runAgentExec`). | Structural. |
| Local dashboard / extension UI server routes (`src/ui/server-routes-*.mjs`, `src/ui/routes-org-*.mjs`) | **No route touches it.** None of the ~35 UI route modules reference `orgrt/agent-exec`, `resolveExecRunner`, or `runAgentExec` — verified by source scan. Coder mode is deliberately **not** an extension action (epic #364, "out of scope v1"). | Structural. |
| Hooks (`hooks-*.ts` lifecycle hooks, filesystem `PreToolUse`/etc. hooks a project or `--settings` load installs) | A hook can run arbitrary code as a **side effect** of a tool call (that's what a hook is), including inside a coder-mode turn itself once one is already running under `--access full` — but a hook cannot **initiate** a new `agent exec --access full` invocation with escalated access; it has no privileged entry point into `resolveAccess`/`checkFullAccessGuards` that a plain `agent exec --access full` typed by a human doesn't also have to go through. | Same guard as "any process on this machine can run `monomind agent exec --access full` if a human decided to let it" — see §2.2. |
| Any org write path — org MCP tools, `create-json`, `import`/`okf-import`, runtime role hiring, or an agent editing the org JSON directly | **Can write the config, cannot make it run with full access.** These paths are not individually filtered; the runtime is the backstop. A role written with `policy.access: 'full'` (and even a copied or hand-written `access_ack`) runs scoped unless `sig` verifies under the machine-local key in the operator-credential directory, which sandboxed roles are denied Read/Edit on. The only command that writes a valid grant, `org role set-access <org> <role> full`, refuses in any agent context (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `MONOMIND_ORG_ROLE`, `MONOMIND_SDK_AGENT`, `MONOMIND_AGENT_EXEC`, and since rev 19 the other CLIs' own markers — see §2.6), even with `--yes-i-understand`. | HMAC-signed human grant + agent-context refusal (#365). |

**A note on "a script/process could just run the CLI itself":** guardrail 1 is about
monomind not *handing* full access to something that only has agent-level (tool-call) reach —
it is not, and cannot be, a defense against a human explicitly scripting
`agent exec --access full` themselves (e.g. a cron job, a Makefile target) any more than a
human can be stopped from running `claude --dangerously-skip-permissions` directly today. That is
the accepted, intended trust boundary (§1): the human who typed or scheduled the invocation is
not the adversary.

### 2.2 Guards inside `checkFullAccessGuards` (regardless of what a caller already validated)

Implemented in [`orgrt/agent-exec-access.ts`](../../packages/@monomind/cli/src/orgrt/agent-exec-access.ts),
run unconditionally by `orgrt/agent-exec.ts` before a full-access turn is allowed to start —
tested in `agent-exec.test.ts`'s `"agent exec: --access full"` suite:

- **Root refusal**: refuses `--access full` when `process.getuid?.() === 0`, on every runtime —
  the same restriction Claude Code itself applies to `bypassPermissions`, kept for CLIs whose own
  yolo mode would allow root — `error {code:"unsafe", fatal:true}` instead of an opaque runner
  failure. A granted full-access org role gets the same refusal: under uid 0 it runs scoped
  (`suspended`, `access-grant.ts`).
- **Explicit, validated `--cwd`**: required (no silent inherit-the-caller's-cwd), must exist, must
  be a directory — `error {code:"unsafe"}` otherwise.
- **Runtime allowlist**: only a `RunnerSpec` with `supportsFullAccess: true` may run full access —
  since rev 19 that is claude, codex, opencode, antigravity, kimicode, grok, qwen, copilot, crush
  and pi, since rev 20 also pi-rpc, cline, aider and dsh, and since #601 verified Kilo 7.8.3 (`orgrt/runner-specs.ts`, merged
  into `RUNNER_SPECS`; the exact set is pinned by
  `agent-exec-no-transitive-escalation.test.ts`, so widening it fails a test until this document
  is updated with it). vercel (no native tools), hermes and qwen-rpc get
  `error {code:"unsupported", fatal:true}`, never a silent scoped fallback (guardrail 5, below).
  Kilo supports only explicit full access with `--settings user,project,local`: scoped/read
  turns and isolated settings fail before execution. Its `--dangerously-skip-permissions` approval is
  unrestricted access. Monomind requires exactly the verified CLI 7.8.3,
  checks the selected CLI version before each turn, and sets `KILO_NO_DAEMON=1` so a reused daemon
  cannot bypass a later turn's settings. Org roles still require the same signed human grant;
  adding Kilo to the allowlist supplies no grant and cannot promote scoped access.
- **No silent downgrade/upgrade**: `access` is resolved once, before the runner ever starts, and
  is reported honestly on the `start` event (`access: "scoped"|"full"`) — a runtime that can't
  do what was asked fails loudly rather than quietly running the other mode.

### 2.3 Env hygiene

Guardrail requirement (#360): "monomind doesn't *add* anything sensitive to the full-access child
env beyond what the caller passed."

`agent exec` (both `scoped` and `full` — this is not access-mode-specific) sets
`envAuthoritative: false` when calling `runner.run()`
([`orgrt/agent-exec.ts`](../../packages/@monomind/cli/src/orgrt/agent-exec.ts), the `o-18` comment
at the `env:` field). `ClaudeAgentRunner` then builds the child's env as:

```
env: args.envAuthoritative === false
  ? { ...process.env, ...args.env }
  : { ...omitAnthropicManagedKeys(process.env), ...args.env }
```

Every other runner builds `{ ...omitAnthropicManagedKeys(process.env), ...args.env }` (ambient
Anthropic credentials never reach a vendor CLI), in both access modes. For `agent exec` on
claude, it's the first branch: the **exact same `process.env`** monomind's own process
already has (HOME/PATH/USER/keychain-backed Claude credentials, and — deliberately, per the
`o-18` comment in `agent-runner-claude.ts` — an ambient `ANTHROPIC_API_KEY`/`BASE_URL`/`AUTH_TOKEN`
if the invoking shell had one) is reconstructed and merged with `--env KEY=V` overrides the caller
passed. Nothing is *added*: `{...process.env, ...args.env}` cannot introduce a key that
wasn't already in one of those two sources, and the child would have inherited `process.env`
under Node's own default spawn behavior regardless. `--env` values are the caller's
responsibility (mono-agent must not pass vault secrets into a coder-mode turn — tracked in
monoes/mono-agent#202/#203, out of monomind's scope). `omitAnthropicManagedKeys` — used by every
**other** caller (the org runtime, every non-`agent-exec` runner invocation) — is unchanged by
this epic; `agent exec`'s opt-out of it predates and is orthogonal to `--access full`.

This exact boundary — ambient `ANTHROPIC_API_KEY` reaching (or not reaching) the spawned child,
`--env`/explicit values always winning, HOME/USER/PATH always inherited — is covered by
`packages/@monomind/cli/__tests__/orgrt/env-boundary.test.ts`'s
`"agent-runner (Claude) — same boundary, no working reference implementation"` suite, specifically
the case `'is present when a caller explicitly opts out (envAuthoritative: false — agent-exec.ts's
documented case)'`. No new seam was found that needed a new test for this issue: `--access full`
does not touch env construction at all (`args.access` and `args.envAuthoritative` are independent
fields), so the existing coverage already exercises the exact code path a full-access turn runs.

**codex shell snapshots** (#535). codex's `shell_snapshot` feature is enabled by default (stable)
in codex 0.156.1, and `codex exec` — what the codex runner runs — creates
`$CODEX_HOME/shell_snapshots/`. A snapshot holds the user's shell environment, so every API key
and token in the environment above, and is created with the process umask (0644 under the usual
022; codex restricts `auth.json` and `history.jsonl` to 0600 but not these). The codex runner, in
every access mode, passes `-c features.shell_snapshot=false -c features.shell_snapshot_v2=false`
(codex's own feature flags), so no snapshot is written. Before each spawn, `restrictCodexHome` in
[`orgrt/codex-runner-stream.ts`](../../packages/@monomind/cli/src/orgrt/codex-runner-stream.ts)
makes `$CODEX_HOME` (default `~/.codex`) and its `sessions/` and `shell_snapshots/` 0700 when the
current user owns them: a 0700 directory hides its files whatever their modes. The process umask is
not changed, so the agent's workspace files keep their usual modes. monomind sets no `CODEX_HOME`
and never copies codex's auth. Snapshots already on disk stay there: delete
`~/.codex/shell_snapshots/*.sh` and rotate the keys they contain.

### 2.4 Audit trail

Every `tool_activity` event (§3.2 of the protocol doc) is the caller's own live audit log — the
caller (e.g. mono-agent) is expected to journal it. As a backstop independent of that journal,
`orgrt/agent-exec.ts` calls
[`appendFullAccessAudit`](../../packages/@monomind/cli/src/orgrt/full-access-audit.ts) exactly
once per `--access full` turn, at the single `finish(exitCode)` chokepoint every exit path
(success, error, timeout, cancelled, budget) funnels through — **never for `scoped` access**.
Each line is one JSON object appended to `~/.monomind/logs/agent-exec-full-access.log`
(override: `MONOMIND_FULL_ACCESS_LOG`, used by tests):

```json
{"ts":"2026-09-28T00:12:03.456Z","cwd":"/home/user/scratch/coder-1","runtime":"claude","sessionId":"sess_abc","exitCode":0,"toolCalls":14}
```

The line is written for every runtime (`runtime` names it). `toolCalls` is only as complete as
that runtime's `tool_activity_fidelity`: exact for `"full"` runtimes, a count of liveness signals
for `"start-only"` ones.

- `ts` — turn-end ISO timestamp.
- `cwd`, `runtime` — from the resolved `AgentExecOptions`.
- `sessionId` — the runner's own session id once known (omitted if the turn never reached one,
  e.g. cancelled before the first message).
- `exitCode` — the protocol exit code (§3.2: `0`/`1`/`124`/`130`).
- `toolCalls` — the number of native `tool_activity` **start** events observed this turn
  (`ToolActivityTracker.toolCallCount`, `orgrt/tool-activity.ts`) — i.e. how many native tool
  calls (Bash, Edit, Write, Read, …) the agent actually made, not merely how many were requested.
- `org`/`role` — reserved for full-access org roles (#365); unset for `agent exec`.

The write is **best effort by design** (`full-access-audit.ts`'s own doc comment): a failure to
write the log (disk full, permissions) never fails or blocks the turn — the live `tool_activity`
stream remains the primary, real-time audit trail; this file is the backstop for when a caller's
own journal is lost.

### 2.5 No silent downgrade/upgrade

Covered by §2.2's runtime allowlist and root/`--cwd` guards: a request that can't be honored as
asked fails with a fatal `error` + `done`, never silently substituting `scoped` for a caller who
asked for `full` (they'd believe they had full access and didn't) or vice versa.

### 2.6 Every runtime, same kill and marker guarantees (rev 19)

- **Process tree**: each full-access subprocess runner spawns its CLI through
  [`orgrt/process-group-spawn.ts`](../../packages/@monomind/cli/src/orgrt/process-group-spawn.ts)
  (`spawnRunnerProcess`): its own process group, the `MONOMIND_EXEC_TREE` marker, and the same
  sampled tracker claude uses (`process-tree.ts`). `cancel`/`--timeout`/`--budget-usd` kill the
  whole tree; a normal end reports `done.background_pids`. Scoped turns keep a plain spawn in
  monomind's own group, byte-identical to before.
- **`--settings` on other CLIs**: non-`none` stops isolating the CLI's own configuration, so its
  user config, the repo's `AGENTS.md`/`GEMINI.md`/`opencode.json` and its configured MCP servers
  load as they would in the user's own terminal. That is the same "the target repo can steer the
  agent" risk as claude's `--settings project` (§4); a `status {phase:"notice"}` names what loads.
- **Agent-context markers** (`orgrt/agent-context.ts`) for `org role set-access … full` now also
  cover the other CLIs, found in each installed CLI's own code on 2026-09-29: the cross-vendor
  `AI_AGENT` (pi, crush, Claude Code) and `AGENT` (opencode, crush); codex `CODEX_SANDBOX`,
  `CODEX_SANDBOX_NETWORK_DISABLED`, `CODEX_THREAD_ID`, `CODEX_CI`; opencode `OPENCODE`,
  `OPENCODE_PID`; antigravity `ANTIGRAVITY_AGENT`; gemini `GEMINI_CLI`; grok `GROK_SESSION_ID`,
  `GROK_MANAGED_BY_NPM`; copilot `COPILOT_CLI_BINARY_VERSION`, `COPILOT_AGENT_SESSION_ID`; crush
  `CRUSH`; pi `PI_CODING_AGENT`; qwen `QWEN_CODE` (not installed here — unverified). No marker
  was found for kimi (not installed here). Rev 20: pi's `PI_SESSION_ID` (inside its bash tools),
  dsh `DSH_SHELL`, `DSH_SESSION_ID`; cline and aider export none of their own, so their runners
  set `MONOMIND_CLINE_TURN` (on cline, its hub daemon and every command they run) and
  `MONOMIND_AIDER`. As before, this is a speed bump, not the boundary
  (§4). `MONOMIND_AGENT_EXEC` is still set on every runner's env by `agent exec` itself.
- **Rev 20 runtime specifics**: cline starts a detached `cline --cline-hub-daemon`; the runner
  finds the one a turn started (by its per-turn marker or a new hub-lock pid, confirmed by its
  command line) and kills it at turn end and on abort, and never touches a daemon that was
  running before the turn — but when the user already runs one, cline may execute the turn inside
  it, outside the turn's process-group tracker. Scoped cline isolates its config
  (`--config`/`--data-dir`, an empty MCP list) and refuses every tool call that needs approval
  instead of approving it: it runs with `--auto-approve false` plus a monomind plugin in that
  config dir that re-approves only cline's own safe tools (read, search, web fetch, questions,
  skills) plus file edits and patches whose every target resolves inside the turn's `--cwd`
  (relative paths against it, symlinks resolved, nothing under `.git`, and refused when the
  folder is unknown), and skips commands, edits outside the project, subagents, teams and MCP
  tools; a resumed (ACP) turn answers permission requests by the same rule. Nothing waits for an answer (a non-TTY cline refuses
  an unanswered approval at once, and desktop approval IPC is switched off); the refused call ends
  `ok:false, denied:true` and the turn goes on. Without the plugin the turn fails closed (every
  tool refused). A workspace's own `.cline/plugins` still load, as in the user's terminal.
  aider has no sandbox:
  scoped mode declines model-suggested shell commands (reported as failed shell calls), slash
  commands and file writes outside the turn's cwd or into `.git`, full mode runs them; aider always writes its repo-map cache
  (`.aider.tags.cache.v4/`) into the repo. dsh scoped stays at `workspace-write`. pi and cline
  full-access resumes run on the user's own provider logins; none of these runners ever starts a
  login or opens a browser.
- **Org roles**: `access-grant.ts`, `access-validate.ts` and `org role set-access` accept any
  runtime whose spec supports full access; the grant flow (signed human ack, drift suspension,
  taint, unattended gate) is unchanged.

### 2.7 Read access (`--access read`, rev 21, issue #388)

`read` sits between `scoped` and `full`: it is a narrowing of what a turn can do, not a new way to
reach full access, so it does not widen §2.1. It flows through the same single path
(`commands/agent-exec.ts` → `resolveAccess()` → `AgentRunArgs.access`), the engine hands the
allow-everything `fullAccessCanUseTool` to a turn only when `access === 'full'` (pinned by
`agent-exec-no-transitive-escalation.test.ts`, together with the set of runtimes that accept
`read`), and no runner treats `read` as anything but read-only: claude keeps `permissionMode:
'default'` with a gate, and no runtime gets its yolo flags or process-group spawn for `read`.

- **claude**: `orgrt/agent-exec-read.ts`'s `readAccessCanUseTool`, installed like the scoped gate
  (`canUseTool` plus the PreToolUse hook, so calls the CLI would allow itself are checked too).
  Allowed: `Read`, `Grep`, `Glob`, `LS`, `WebSearch`, `WebFetch`, `TodoWrite`, `Skill`,
  `ToolSearch`, the caller's own stdio tools, and `Bash` only for an allowlisted prefix (`git
  status|diff|log|show|blame`, `ls`, `cat`, `head`, `tail`, `wc`, `rg`, `grep`, `find`, plus
  `--allow-bash-prefix` entries). A shell command must be one literal invocation (the scoped
  mode's metacharacter scanner plus no unquoted parentheses) and carry no argument that makes an
  allowed command run or write something: `find -exec|-execdir|-ok|-okdir|-delete|-fprint|
  -fprint0|-fprintf|-fls`, `rg --pre`, `git --output`/`--ext-diff` (checked on the words bash
  would see, quotes removed). Everything else — `Edit`, `Write`, `MultiEdit`, `NotebookEdit`,
  other shell commands, `Task`/`Agent`, MCP tools from the user's `--settings` — is denied, and
  the call's `tool_activity` end carries `denied: true`.
- **codex**: `codex exec --sandbox read-only` regardless of `MONOMIND_GIT_LEVEL` (a read turn is
  never `danger-full-access`); the whole filesystem is read-only and the network is off for its
  shell commands. Its shell rules are codex's, not the allowlist above.
- **pi / pi-rpc**: `--tools read,grep,find,ls`, pi's documented read-only mode: no bash, edit or
  write tool (extension tools off too).
- **Everything else** (opencode included: its permission config cannot express deny-by-default,
  see `orgrt/runner-access.ts`) answers `error {code:"unsupported", fatal:true}`; nothing falls
  back to scoped or full.

Residual risks specific to `read`: `Read`, `cat` and `git show` can read any file the user can
(`~/.ssh`, `.env`), and `WebFetch` can send what was read to a URL — read access keeps the working
tree and the machine unchanged, it does not keep data inside it. `git` commands still honor the
repository's own `.git/config` (e.g. `core.fsmonitor`, or a `diff.<driver>.textconv` filter named
in `.gitattributes`), so a checkout whose config already sets such a command runs it through `git
status`/`git diff`/`git show`; `find` and `rg` read whatever is in the tree. `--allow-bash-prefix`
entries are trusted exactly as in scoped mode. Callers that need no network or no reads outside
the project should use a runtime sandbox (codex) or run the turn in a container.

### 2.8 Caller tools with full access (rev 22, issue #389)

`--access full --tools stdio` adds the caller's own tools to a full-access turn; it grants nothing
the caller did not already hold (each call is executed by the caller, which sees every `tool_call`
frame). On claude the caller tools are marked `readOnlyHint` so Claude Code runs parallel calls
concurrently. That annotation is a scheduling hint, not a claim monomind relies on for security:
the caller's tools may well write, and in `scoped`/`read` mode the gate allows them by name
exactly as before. `--allow-bash-prefix` stays a usage error with `--access full`.

### 2.9 The permissive default, and `--sandbox` (rev 23, issue #396; rev 26, issue #482)

A non-org `agent exec` turn is **not sandboxed by default**, and this is deliberate (kept so no
existing caller changes behaviour). `--access scoped` is monomind's own mode: on claude it is
enforced (`canUseTool` + PreToolUse gate), but on a vendor CLI it only limits the caller-tool
wiring. The CLI itself starts in its most permissive headless mode unless an org role's git level
says otherwise: codex `--sandbox danger-full-access` (can write anywhere on disk), grok profile
`off`, and approvals off on copilot (`--allow-all-tools --no-ask-user`), qwen (`--yolo`),
antigravity (`--dangerously-skip-permissions`), kimicode, crush, pi and aider. Only
`MONOMIND_GIT_LEVEL` below `push` (set for org roles by the git guard, or passed with `--env`)
moves codex/grok into `workspace-write`.

Since rev 23 this is reported rather than implied: every `start` event carries `native_sandbox`
(`read-only`, `workspace-write`, `full` = native sandbox off, `none` = no native sandbox,
`monomind` = claude's own enforcement) and `approvals` (`off`, `on`, `n/a`), and `agent scan
--json` lists the same defaults per runtime plus `sandbox_modes`.

**Callers such as mono-agent that do not want an unsandboxed turn should pass `--sandbox`**
instead of relying on `--env MONOMIND_GIT_LEVEL=…`: `--sandbox workspace-write` (writes in the
cwd, network on) or `--sandbox read-only`, on runtimes whose `sandbox_modes` lists the mode
(codex, grok, dsh today). Anywhere else the turn fails with `error {code:"unsupported"}` rather
than running unsandboxed, so a caller can pick a different runtime or a container. Check
`native_sandbox` on `start` for what the turn really got. The flag can only narrow: an org role's
git level below `push` keeps `workspace-write` even under `--sandbox full`, `--access read` keeps
codex `read-only` whatever the flag says (`--access read --sandbox full` is a usage error), and
`--sandbox` never enables anything `--access` did not. It is a flag on the human-typed CLI like
`--access` (§2.1): nothing else constructs it. With `--access full`, `--sandbox read-only|
workspace-write` keeps the native tools fully approved but inside that sandbox. A native sandbox
covers what the vendor CLI runs, not monomind's own process or the caller's stdio tools, and the
runtimes listed as `none` still need a container if the caller needs isolation.

**Rev 26 (issue #482) adds modes where a CLI can refuse actions, and names them for what they
enforce.** Each was checked against the installed CLI's `--help` and a live turn that tried a file
write and a shell command (`orgrt/runner-sandbox.ts` records the versions):

| Runtime | Mode | How | What is enforced, and by whom |
|---|---|---|---|
| copilot | `read-only` | `--deny-tool=write --deny-tool=shell`, no `--allow-all-tools` | copilot's permission engine refuses every file-editing tool and every shell command; deny rules beat any allow rule, the user's included. No OS sandbox |
| copilot | `workspace-write` | `--allow-tool=write --deny-tool=shell`, no `--allow-all-paths` | copilot's path check keeps edits under the cwd, `--add-dir` and the temp dir (an absolute path outside and a symlink out of the cwd were refused); no shell at all. No OS sandbox |
| copilot | `restricted` | no `--allow-all-tools` | copilot's own approval rules; everything that would ask is refused |
| antigravity | `restricted` | no `--dangerously-skip-permissions` | agy's own rules: shell and file writes are auto-denied (the temp dir excepted), and the turn then ends without a reply. The user's `permissions.allow` rules in agy's settings can widen it |
| opencode | `restricted` | `OPENCODE_PERMISSION` sets edit, bash, task and external_directory to `ask`; monomind rejects every ask | opencode's permission engine. An agent's own `permission` block in the user's **or the project's** `opencode.json` overrides the override, so a repository can widen it; not with an attached `OPENCODE_URL` server (refused) |
| pi, pi-rpc | `read-only` | `--tools read,grep,find,ls` | pi exposes no write, edit or shell tool at all |
| claude (`--access scoped\|read`) | `read-only`, `workspace-write` | nothing added: monomind's own gate | `canUseTool` + the PreToolUse hook run no native tool that is not allow-listed, so Write/Edit/NotebookEdit never run; Bash runs only the caller's `--allow-bash-prefix` commands (single literal invocations, with the user's own rights), and caller tools run on the caller's side. Under these modes a caller tool named like a native tool (`Write`) no longer lets that tool through. `native_sandbox: "monomind"` |

`restricted` is not a file-system boundary: it means "the CLI's own approval rules, with every
question answered no", so its reach is the CLI's rule set, including rules the user (or, for
opencode, the project) added. It ranks between `read-only` and `workspace-write`: under default
rules every CLI that has it refuses shell and file edits, but nothing stops those rules from being
widened. `workspace-write` is advertised only where writes really stay in the cwd; claude's is the
stricter "no native writes at all", and copilot's has no shell.

claude with `--access full` still has only `full`. The Agent SDK sandbox that org roles use (#258,
#339) runs the Bash tool in bubblewrap/Seatbelt, but Write/Edit run in-process outside it, the org
profile keeps `$HOME` and the temp dir writable, and `--settings` MCP servers and hooks run outside
it too, so wiring it would not confine a full-access turn's writes to the cwd; it was not wired.
Not verified, so still `full` only: qwen, qwen-rpc, kimicode, cline and aider (not installed
here); crush, hermes and vercel have no mode monomind can drive.

**`--sandbox-fallback fail|strictest|run`** lets a caller send one `--sandbox` value to every
runtime. `fail` (default) keeps the fatal `unsupported`, which is the safe choice for a caller that
must not run looser than it asked. `strictest` runs the closest listed mode that is at least as
strict, and only when every listed mode is looser (e.g. claude `--access full`, qwen) runs the
strictest one there is, which is looser than asked. `run` runs the runtime default. Both emit a
`status` notice and report `sandbox_requested` and `sandbox_applied` on `start`, so a caller that
uses them must read `sandbox_applied` (and `native_sandbox`) rather than assume the request held.

### 2.10 Model and effort pinning, delegation caps, and what the result reports (rev 30, issue #655)

Applies to the Claude runtime when the turn loads Claude Code settings (`--settings user|project|local`),
which is what makes it a coder-mode turn. Those settings files can carry an `env` block, and the
ambient environment can too. `CLAUDE_CODE_EFFORT_LEVEL=max` in either outranks the `--effort` flag, and a
subagent can name its own model, so a session could run on a different model or effort than the one
you selected. `orgrt/coder-pin.ts` closes both:

- **Effort.** When `--effort` is set (and is not `off`), monomind sets `CLAUDE_CODE_EFFORT_LEVEL` to
  it in the spawned environment and in the inline `settings` option. Inline settings outrank the
  user, project and local files.
- **Model.** When `--model` is set (and is not `default`/`inherit`), monomind sets
  `CLAUDE_CODE_SUBAGENT_MODEL` to it. A per-call `Agent.model` or an agent's frontmatter model
  wins over that variable, so a PreToolUse hook also denies any `Agent`/`Task` launch that names a
  different model and tells the model to omit the argument. An alias that matches the selected
  model (`sonnet` for `claude-sonnet-5-5`) is allowed.
- **Delegation caps.** The same hook counts `Agent`/`Task` launches in the session and denies
  further ones past a cap. `MONOMIND_CODER_MAX_AGENTS` (default 40) caps all launches;
  `MONOMIND_CODER_MAX_REVIEW_AGENTS` (default 12) caps launches whose description or
  `subagent_type` contains "review". Set either to `0` to lift that cap. A value that is not a
  non-negative integer falls back to the default. The caps apply even when no model or effort is
  selected.

`agent exec`'s `result` event reports what the turn actually ran on, so an escalation is visible instead of
inferred (Claude runtime only; each field is present only when it has a value):

| Field | Meaning |
|---|---|
| `model_usage` | Tokens per model the API served (`input`, `output`, `cache_read`, `cache_creation`), child agents included |
| `unexpected_models` | Served models that do not match `--model` |
| `effort` | The effort the request was sent with |
| `peak_context_tokens` | Largest main-thread context sent in one call (input + cache read + cache write) |
| `context_warning` | `true` when `peak_context_tokens` is above 200,000 |
| `agent_launches` | `{total, review}`: `Agent` launches this turn (coder mode) |

The fields come from `agent exec`'s final `result` event; the org run bus does not carry them. `monomind doctor`
also has a read-only **Token Cost Settings** check for the settings that multiply token use
(see [hooks.md](hooks.md#token-cost-settings-check)). Wire format: [agent-exec-protocol.md](../agent-exec-protocol.md) §3.2.

## 3. What callers own (not monomind's job)

- **mono-agent's coder-mode gating**: off by default, a risk-confirmation dialog before first use,
  mode fixed per conversation, local-only, and critically — **never wiring its own
  communications/people/message tools into a coder-mode turn's tool surface**
  (monoes/mono-agent#202/#203). monomind has no way to enforce this from its side; it has no
  visibility into what tools a caller decides to bridge over `--tools stdio`.
- **`--env` hygiene**: not passing vault secrets or other credentials a coder-mode turn doesn't
  need. monomind passes `--env` values through unfiltered by design (they're the caller's explicit,
  human-reviewable request).
- **Not pointing coder mode at untrusted repos**: the UI-level warning ("don't run coder mode
  against a repo you don't trust, especially with `--settings project`") is a caller/product
  responsibility; monomind's part is limited to making the risk visible and documented (§1, §4).
- **Org-role opt-in (#365)**: granting `policy.access: "full"` to an org role is a human decision
  made with `monomind org role set-access`; the grant flow, drift suspension, taint checks and
  unattended-run gating are documented in [`org-runtime.md`](org-runtime.md) ("Full access"),
  layered on top of the guardrails in §2 of this document. The `access_ack` signature covers only
  a full-access grant. The rest of a role's policy (scopes, git level, `sandbox.allowWrite`) lives
  in the same org definition file, so that file, the decision files and the daemon's state under
  `.monomind/orgs/` are authority files. On the Claude runtime, no scoped role may write them with
  a file tool, whatever its scope (#498). Other runtimes' own file tools, like Bash, are held back
  only by the OS layer. Writing a definition is not enough, though: the operator signs the whole
  authority part of every org definition with `monomind org sign` (#502), under the same key as
  `access_ack`, and `org run`, `org serve` (runfile poll and schedule), `org reload` and resume
  refuse a definition whose signature does not verify. The list, these limits and the signing
  model are in [`org-runtime.md`](org-runtime.md), "Authority files" and "Operator-signed
  definitions". An active full-access role runs with no policy gate and can still write them, and
  like any role that can read the operator-credential directory, it can sign.
  The same layers keep a sandboxed role from replacing what the operator's own processes run:
  the node, npm, claude and monomind installs under `$HOME` (mise, nvm, volta, fnm, asdf, bun,
  pnpm, …), the writable directories on `PATH`, mise's trust store and direnv's allow list are
  read-only to it, and the directories above them cannot be renamed aside (#527;
  [`org-runtime.md`](org-runtime.md), "What the operator's own sessions run").

## 4. Residual risks (accepted, not mitigated further by this issue)

These are known, accepted trade-offs of "full access by design" (§1) — listed explicitly so they
are never mistaken for oversights:

- **Unconfined org roles can sign org definitions (#502, allowed by decision)**: a role that runs with
  neither the SDK sandbox nor the bubblewrap authority mask can read the operator key in
  `~/.monomind/orgrt-operator/`, and with it sign any org definition and forge any full-access
  grant. That is an active full-access role; a `policy.git: push` role or one with
  `policy.sandbox.mode: 'off'` on a host without bubblewrap; a CLI runtime other than claude
  there (codex on macOS, for example); and any role when bubblewrap is missing or cannot start.
  Such roles are allowed, not refused: operator-signed definitions protect every other role, and
  an org that needs an unconfined role (a push-level releaser, codex on macOS) keeps working.
  `monomind org sign` lists each one in its review with the reason it runs without an OS sandbox,
  and every org start prints the same warning. To confine a role, run it on the claude runtime
  below `policy.git: push` with `policy.sandbox.mode` not `'off'`, or install bubblewrap (Linux).

- **`WebFetch`/`WebSearch` under `--access full`**: a fetched page can contain instructions the
  model may act on with a real, unrestricted shell — identical to interactive Claude Code with
  `--dangerously-skip-permissions` (or any other CLI's yolo mode). Mitigation is observability only: every native tool call
  (including the fetch itself and whatever the model does next) is a `tool_activity` event on the
  caller's stream and, being a native tool call, counts toward the full-access audit log's
  `toolCalls` field. There is no content-level filtering of fetched pages.
- **A repo's own `CLAUDE.md`/`AGENTS.md`/hooks, loaded by `--settings project`**: this is not
  passive text — `--settings project` (or `user`/`local`) makes the Claude Code SDK's own settings
  discovery load and **execute** that repo's `.claude/settings.json` hooks
  (`PreToolUse`/`PostToolUse`/etc.) as real, code-level hooks for the remainder of the turn
  (`orgrt/agent-runner-claude-settings.ts`'s doc comment: "the user's own `PreToolUse` hooks …
  **will** run on coder-mode turns," carried over verbatim from #356). A malicious repo's hook
  runs with the same unrestricted access the turn already has. `--settings none` (the default)
  never discovers or runs anything from the target directory — this risk exists only when a
  caller explicitly opts into `--settings project`/`user`/`local` on top of `--access full`.
- **Ambient environment inheritance** (§2.3): an already-authenticated shell's `ANTHROPIC_API_KEY`
  (or other exported secrets not stripped by `omitAnthropicManagedKeys`, since `agent exec` opts
  out of that helper) is available to the full-access child exactly as it would be to any command
  the invoking human could already run directly in that shell. Not a new exposure created by
  coder mode — the same shell session could always do this — but worth naming since `agent exec`'s
  env-authoritative opt-out is easy to miss when reasoning about this feature in isolation.
- **`Task` subagents**: a coder-mode turn's own subagent calls run with the same `--access full`
  permissions (there is no narrower policy to hand a subagent in this mode) and are only visible
  as `tool_activity` events with `parent_tool_use_id` set — there is no separate approval or
  scoping layer between a top-level turn and its own subagents.
- **Background jobs that hide from the process-tree kill** (#359): cancel/`--timeout`/budget kill
  every process that inherited the turn's `MONOMIND_EXEC_TREE` env marker or was sampled under
  the agent CLI process, and a normal end reports survivors in `done.background_pids`. A job that
  clears its own environment and whose launching shell exited between samples can escape both,
  as can one that sets `MONOMIND_EXEC_TREE` to another value (how monomind's own hook daemons
  opt out, #366);
  so can one that deliberately detaches under another user or service manager. A CLI that runs
  its tools in a separate long-lived server it did not spawn itself (e.g. an already-running
  opencode server) is outside the tree too. Full access is not a sandbox.
- **Weaker observability where fidelity is not `full`**: crush reports no tool events at all
  (rev 19), and aider's plain-CLI fallback (rev 20, used only when its Python shim cannot import
  aider) reports tool starts without ends or real inputs, so the caller's journal and the audit
  line's `toolCalls` show less than on claude; the UI labels fidelity instead of pretending.
  Budgets are unenforceable where `reports_cost` is false (dsh, among others).
- **Agent-context detection for `org role set-access … full` is a speed bump** (#365): an agent
  with unrestricted Bash can unset the env markers. The boundary is the operator directory: a
  role's SDK sandbox (`denyRead`) or authority mask (`--tmpfs`) overlays it with an empty tmpfs,
  so the grant key can be neither read nor replaced from inside a role (verified live: writes
  "succeed" into the overlay and never reach disk), and a grant signed there never verifies. If
  bubblewrap is unavailable, the mask fails open with an `authority-mask-unavailable` audit event.
- **`init --project --if-missing` follows a symlinked directory inside the project** (e.g. a
  cloned repo's `.claude` pointing elsewhere): new files can land where the link points. It never
  overwrites an existing file and runs with the user's own permissions; symlinked `.claude`
  directories are a common, legitimate setup, so this is accepted.

## 5. Security review of this diff (#360 acceptance criterion)

The full Coder-mode diff (`git diff main...HEAD` at the time of this issue: `--access full`
(#355), `--settings` (#356), `tool_activity` (#357), headless `init` (#358)) was reviewed with a
security lens for injection, escalation, path handling, and env leaks:

- **Scoped-mode Bash allowlist (`agent-exec-shell-syntax.ts`'s `hasUnsafeShellSyntax`)** — unaffected
  by this epic (`--access full` explicitly *rejects* `--allow-bash-prefix` rather than reusing this
  scanner), but reviewed since it sits in the same file family: correctly tracks single/double-quote
  state and backslash-escaping before checking for `;`/`&`/`|`/backtick/`$(`/`<`/`>`, including the
  documented `\'; touch /tmp/PWNED` backslash-escape bypass class. No issue found.
- **`--cwd`/`--project` path handling** (`agent-exec-access.ts`'s `checkFullAccessGuards`,
  `init-action.ts`'s `--project` resolution): both resolve the caller-supplied path with
  `path.resolve`/`statSync` against the existing filesystem and reject a missing/non-directory
  target; neither does any shell interpolation with the path. No path-traversal-into-execution
  issue — a caller directing monomind at an arbitrary absolute directory is the feature (§1: "scope
  is anywhere on disk"), not a bug.
- **The scoped/default path stays byte-identical**: `access` undefined/`'scoped'`,
  `settingSources` empty, and the tool_activity tracker's behavior with no native tool signal are
  all proven by existing snapshot/regression tests (`agent-exec-access-flags.test.ts`,
  `agent-runner-claude-settings-sdk.test.ts`, `tool-activity.test.ts`) — re-verified as part of
  this review by re-running the full CLI suite.
- **No new escalation path was found** beyond the ones already named and closed structurally in
  §2.1 — see that section's table for exactly what was checked and how.
- **Nothing required a code fix** during this review; the residual risks in §4 are by-design
  trade-offs of "full access," not defects.
