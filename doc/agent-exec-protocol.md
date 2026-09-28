# Agent Exec Protocol — v1 (rev 15)

- **Status**: Implemented (Phase 0 of the mono-agent delegation plan — see
  `mono-agent:docs/plans/local-agent-monomind-delegation.md`)
- **Security**: see [`doc/concepts/coder-mode-security.md`](concepts/coder-mode-security.md) for
  the Coder mode threat model, the `--access full` guardrails (root refusal, no transitive
  escalation, env hygiene, audit log), what callers own, and residual risks (issue #360).
- **Revision history**:
  - rev 15 (2026-09-29): **per-profile web captures** — new capability
    `knowledge-profile-captures`. A capture envelope whose `meta.json` names a `profile` ingests
    into `profile:<id>` even when its URL has a query string (earlier builds failed every chunk
    with `all chunk stores failed`); the other documents in an envelope (`transcript.md`,
    `summary.md`) are indexed as their own documents and no longer supersede `readable.md`; and
    `doc search`, `doc cite`, `doc related`, `doc lookup` and `doc list` with
    `--scope profile:<id>` all read that profile's store. Callers that ingest more than
    `readable.md` from an envelope check for this capability first. Additive only.
  - rev 14 (2026-09-28): **runtime model lists** (issue #369) — new capability `agent-models`:
    `monomind agent models --runtime <id> --json` (§12) prints the runtime's own model list —
    Claude Code's `/model` picker via the Agent SDK's `supportedModels()` (no prompt sent),
    `codex debug models`, `agy models`, `opencode models`. Additive only.
  - rev 13 (2026-09-28): **threat model + guardrails** (issue #360). `agent exec --access full`
    now appends one JSON line per turn to `~/.monomind/logs/agent-exec-full-access.log`
    (`MONOMIND_FULL_ACCESS_LOG` overrides), regardless of how the turn ended — `ts, cwd, runtime,
    session_id?, exit_code, tool_calls` (the number of native `tool_activity` starts observed) —
    never for `scoped` access; best-effort (a write failure never fails the turn). No protocol
    surface (flags/events/capabilities) changed — see `doc/concepts/coder-mode-security.md` for
    the full write-up, including the audited set of paths (MCP tools, the org runtime, workflow/
    routine nodes, UI routes, hooks) that were confirmed unable to set `access: "full"` today.
  - rev 12 (2026-09-28): **`--settings` / coder mode** (issue #356, capability
    `agent-exec-settings`). `agent exec --settings none|<csv of
    user,project,local>` (default `none`, byte-identical to before — proven by
    an SDK-options snapshot test); a non-empty list (claude runtime only) sets
    `settingSources`, `strictMcpConfig: false`, merges the in-process `org` MCP
    server only when `--tools stdio` supplied caller tools (otherwise no
    `mcpServers` override at all, letting the SDK's own discovery be the sole
    MCP surface), and switches the system prompt to `{type:'preset',
    preset:'claude_code', append: <text>}` instead of replacing Claude Code's
    own prompt. The programmatic hooks (`coverEveryToolCall`, tool spill) keep
    registering over the SDK control protocol alongside any filesystem hooks
    the settings sources load — the user's own `PreToolUse` hooks (e.g. a
    graph-gate) **will** run on coder-mode turns. New `status` event (§3.2)
    from the SDK's `system/init` message, only when `--settings` is non-none;
    a startup watchdog (`--startup-timeout`, default 30s) emits
    `error {code:"runner-error"}` instead of hanging if `phase:"ready"` never
    arrives. The historical hang this isolation was added for (settings
    discovery vs. a concurrent interactive Claude Code session's
    multi-agent-teams handshake) was re-verified live — 8 trials of
    `settingSources:['user','project','local']` against a real account, with
    3+ interactive `claude` sessions already running throughout (sequential,
    repeated, and 3 concurrent SDK sessions sharing one HOME) — and did not
    reproduce with the currently pinned SDK/CLI versions; the startup watchdog
    stays in place regardless, as a backstop. `agent-exec.ts` (org runtime)
    never sets `--settings`, so its behavior is unchanged.
  - rev 1 (2026-08-24): initial draft.
  - rev 2 (2026-08-25): review fixes — `agent list` collision resolved (§6), dual-mode tool
    definitions via `--tools-file` (§4), `--timeout` added so exit 124 is defined (§3.1),
    `pid`/`child_pid` disambiguation, stdout purity mandated (§3.2), error-code taxonomy (§3.4),
    stdin EOF semantics (§4), `--protocol` added to flags (§3.1), concrete `--max-turns` default,
    machine-readable `stop_reason` (§3.2), org project resolution rule (§7.1), `org list` /
    `org events` marked as new commands (§7), golden transcript fixtures (§8).
  - rev 3 (2026-08-25): **correction** — `org list` was NOT new; it already existed
    (`commands/org-manage.ts → listAction`, human-output only, already project-cwd-scoped per §7.1) and only
    needed `--json` added, same as the other §7.2 commands. `org events` is the only genuinely new
    org command (§7.2). Also noted: `resolveRunner` can return `undefined` for the implicit
    default-runner case — `agent exec` must classify "no runner resolved" distinctly from
    `missing-binary` in its error taxonomy (§3.4).
  - rev 4 (2026-08-25): **implementation notes** from the Phase 0 build — `--tool-names` added as
    the §4.2 mechanism (§4.2); `--budget-usd` granularity documented honestly (§3.1);
    `child_pid` is omitted in v1 (§3.2); org JSON rides the global `--format json` flag and is
    compact single-line (§7.1); `agent test` emits the same NDJSON stream (§6); fixtures published
    at §8.4 with a contract test; `stop_reason:"tool_round_cap"` detection is best-effort (§3.2).
  - rev 5 (2026-09-13): **`streams_incrementally` capability** — added to `start` (§3.2) and
    `agent scan --json` (§6), sourced from the new `RunnerSpec.streamsIncrementally` static field
    (`runner-registry.ts`). Lets a caller (e.g. a chat UI) set the user's expectations honestly
    instead of a live turn on a whole-message-only runtime looking stuck. `claude`, `antigravity`,
    `vercel`, `opencode`, and `pi-rpc` stream real incremental text; `qwen-rpc` got a promptness
    fix but stays `false` (see §9 step 3 — a whole-message wire format shipped faster is still not
    per-token streaming). New §9 gives future runner authors a checklist for deciding and wiring
    this field; the pattern below is what §9 distills.

    Every incremental runner's fix follows the SAME decouple-and-diff shape (§9 step 2): the
    authoritative full text a runner already needed (for tool-call fence parsing, final usage) is
    left completely unchanged; a separate fast path tracks how much of it has already been shown
    and yields only new increments; any gap is reconciled at the turn's true end via a diff, never
    duplicating or losing text. And every one of them is opt-in via
    `AgentRunArgs.extras.includePartialMessages` — `agent exec` sets it unconditionally for every
    runtime (§3.1), `session.ts` (the org runtime) never does, because it needs exactly one
    complete `AgentMessage` per step/round for its chat-bus emission and state-detector pattern
    matching, regardless of which runner backs the org role. This was caught as a real bug during
    the `claude` work — session.ts is runner-agnostic, so the SAME risk applied to every other
    runner already made incremental in this pass, not just `claude` — and fixed by retrofitting
    the identical gate onto all of them rather than treating `claude` as a special case.

    Per-runner specifics: `claude` streams via the SDK's `includePartialMessages`
    (`SDKPartialAssistantMessage`/`stream_event`, content-block-index keyed). `antigravity` streams
    `agy`'s `text_delta` events, fence-safely buffered by the shared `computeSafeChunk` helper
    (`antigravity-runner.ts`) that every other fence-protocol runner below reuses rather than
    reimplementing. `opencode` switched from a blocking `session.prompt()` to
    `session.promptAsync()` + `client.event.subscribe()`, whose real per-token event —
    `message.part.delta` — turned out to be undocumented in the installed SDK's own `.d.ts` (only
    `message.part.updated` is, whose `delta` field was observed to always be `undefined` live);
    caught only by live-verifying against a real server, which also caught a real bug (the echoed
    user prompt leaking out as a fake assistant message) before it shipped. `pi-rpc` streams
    `message_update`'s `assistantMessageEvent.text_delta`, contentIndex-keyed and reset on each
    `message_start` — verified against `docs/rpc.md` bundled with the installed pi package at the
    exact version already in use, not independently live-tested end-to-end (no funded model
    credential was available in the verifying environment) — weaker evidence than the live
    confirmation every other incremental runner here got, though still materially stronger than
    inference. `qwen-rpc`'s fix (yield each complete `assistant` event immediately instead of
    buffering a whole multi-round turn into one blob) is real but orthogonal to this flag, per §9
    step 3.
  - rev 6 (2026-09-14): **`hermes` runtime added** — Nous Research's Hermes Agent CLI (`hermes`),
    same fence-protocol/fresh-spawn-per-round shape as `codex` (`hermes-runner.ts`),
    `streams_incrementally: false`. First shipped docs-only, then LIVE-VERIFIED the same day
    against a real installed binary (official installer, configured with a free OpenRouter model)
    — live testing caught two real bugs the docs never mentioned: `--usage-file` is a top-level
    `-z` flag, not a `chat` flag (passing it to `chat` is a hard argument-parse error — usage/cost
    reporting dropped, always 0, same documented limitation as vercel-runner.ts), and `-Q` ("quiet
    mode") does not guarantee pure stdout — a leaked dependency warning was observed ahead of the
    real answer on one run, non-deterministically, now defended against with a pattern-based
    stdout filter. session_id is available (parsed from stderr) for observability, though it still
    can't be used to resume — confirmed live that `--resume`/`--continue`/`-c` all resume by
    session ID, none reachable from a `--oneshot` invocation, so every tool-call round resends the
    full transcript instead, and `args.resume` across mailbox messages cannot be honored (does not
    affect `agent exec`, whose prompt stream is single-message per process — see agent-exec.ts). A
    live end-to-end trial of the fence-based org-tool protocol against a small free model did not
    successfully round-trip a tool call — the model attempted a native-style call instead of
    following the fenced-text convention, got hermes's own "tool not found," and gave up. Left
    open whether this is a small-model instruction-following limitation or hermes's native
    tool-calling competing for the model's attention — not yet root-caused. `hermes serve`'s
    JSON-RPC/WebSocket gateway is the plausible path to real per-token streaming but has no
    published protocol/schema doc found — left as a flagged follow-up, not guessed at.
  - rev 7 (2026-09-16): **`result.text` is reliable again** (issue #245). Since rev 5's incremental
    `assistant` events, `result` carried no `text` for any runner that doesn't set it on its own
    result message (i.e. nearly all of them), so clients falling back to the latest `assistant`
    event got only the last chunk. `agent exec` now always derives it (§3.2): the runner's own
    result text if it has one; otherwise, for a `streams_incrementally: true` runtime, the
    concatenation of every `assistant` event's text in the turn (including any text emitted before
    tool calls — incremental runners expose no message boundaries); for a non-incremental runtime,
    the last `assistant` message. Omitted only when the turn produced no assistant text. Callers
    that must also work with older monomind versions should still join `assistant` texts when
    `result.text` is absent.
  - rev 8 (2026-09-17): **org capabilities in the handshake** — the §2 `--version --json` example
    now shows 2.10.31's capability list, which adds `org-tool-providers` (role tool providers),
    `org-endpoint-roles` (REST/webhook endpoint roles), `org-federation` (cross-root federation)
    and `org-decision-attribution` (decision attribution and request-scoped approvals) to
    `agent-exec`, `agent-scan` and `org-json-v1`. Additive only; no existing capability changed.
  - rev 9 (2026-09-24): **setup and health for callers** — new capability `doctor-json`:
    `monomind doctor --json` (§10) prints the health checks as one JSON document with a stable
    `component` id and fix safety per result, so a caller (mono-agent's Settings › System health)
    can show and apply monomind's own checks. `agent scan --json` entries gain `install` (the
    `install_hint` as `npm` packages, an https `script`, or `manual`) and `login_hint`, display
    text never to be executed (§6).
    Additive only.
  - rev 10 (2026-09-24): **read-only and offline doctor** (issue #335) — new capabilities
    `doctor-read-only` and `doctor-offline`. `doctor --json` without `--fix`/`--install` now changes
    no file (it used to rewrite `.monomind/registry.json`, create the memory database and fill
    `~/.npm`), `--read-only` asks for the same in human output, and `--offline` skips the checks
    that use the network. The payload gains `read_only`, `offline`, `summary.skipped` and a
    `skipped_reason` per result; `status` gains `skipped` (§10). Additive only.
  - rev 11 (2026-09-25): **read-only `agent scan`** (issue #337) — new capability
    `agent-scan-read-only`. `agent scan` used to run every installed runtime's `--version`, and
    several CLIs change the machine when run that way (grok downloads its ~159MB native binary into
    `~/.grok`; hermes writes `~/.hermes/logs` and `.update_check`). Scan now reads the version from
    install files and runs a binary only when it is known to be side-effect free or the caller
    passes `--probe`, always in a scratch HOME. Entries gain `version_source` (§6). Additive only.
  - rev 12 (2026-09-28): **`agent exec --access full`** (issue #355, part of the Coder mode
    epic #364) — new capability `agent-exec-full-access`. `scoped` (default, unchanged) is
    exactly today's allow-list behavior, byte-identical SDK options. `full` (claude runtime
    only): `canUseTool` allows every tool (native, MCP, stdio-bridged) — still wrapped by
    `coverEveryToolCall`, so every call remains observed — and the SDK gets
    `permissionMode: "bypassPermissions"` plus the bundled SDK's own required opt-in,
    `allowDangerouslySkipPermissions: true` (§3.1). `--allow-bash-prefix` is a usage error
    combined with `--access full` (meaningless there). Guards live in monomind itself, not
    only the caller (§3.4's new `unsafe`/`unsupported` codes): refuses root, refuses a
    runtime whose `RunnerSpec.supportsFullAccess` is false, and requires an explicit,
    existing, directory `--cwd`. `start` gains `access` (§3.2); `agent scan --json` gains
    `full_access` per runtime (§6). Additive only.
  - rev 12 (2026-09-28): **`tool_activity` events** (issue #357) — new capability
    `agent-exec-tool-activity`. `agent exec` used to emit nothing for the agent's own NATIVE tool
    calls (Bash, Edit, Write, Read, …) — only `--tools stdio` bridged calls got `tool_call`/
    `tool_result` frames. Native calls now get matched `tool_activity` start/end pairs on stdout,
    correlated by the SDK's own tool_use id, in every access mode (§3.2). `Edit`/`MultiEdit` carry
    `old_string`/`new_string`, `Write` carries `file_path`/`content`; string fields and the flattened
    tool output are capped at 16 KiB each with a `*_truncated:true` sibling, and the whole event
    stays well under 64 KiB. `parent_tool_use_id` nests a subagent's own tool calls under the
    `Task`/`Agent` call that started it. A denied call (scoped mode) closes with
    `phase:"end", ok:false, denied:true`; a turn cut short by `--timeout` or a `cancel` frame closes
    any still-open id with `ok:false, cancelled:true` before `done`. Bridged calls are unaffected —
    they keep their existing `tool_call`/`tool_result` frames. Non-Claude runtimes map their own
    `{type:'tool_use', text: toolName}` liveness signal to a best-effort, start-only `tool_activity`
    under a locally-minted id; fidelity per runtime (`"full"|"start-only"|"none"`) is now on both
    `agent scan --json` entries (`tool_activity_fidelity`) and §9. Additive only.
  - rev 12 (2026-09-28): **headless, idempotent workspace init** (issue #358) — new capability
    `init-json`: `monomind init --json` (§11), plus `--project <dir>`, `--if-missing`,
    `--no-graph`, and `--register-claude-project`, all usable with or without `--json`. Answers
    the "does a headless Claude turn already trust the folder" question empirically (§11.3):
    the Agent SDK's `query()` creates `~/.claude/projects/<slug>/` on its first real turn
    regardless of `settingSources`, so mono-agent's throwaway `claude -p` registration call is
    unnecessary once a coder session's first real turn runs; it never writes
    `~/.claude.json`'s `hasTrustDialogAccepted`, which is interactive-CLI-only and out of reach
    headlessly. Additive only.
  - rev 13 (2026-09-28): **per-role `policy.access: "full"` for org roles** (issue #365, part of
    the Coder mode epic #364) — new capability `org-role-full-access`. A specific org role can
    now run with the same unrestricted native tool access as `agent exec --access full`, but only
    when a human explicitly grants it: `monomind org role set-access <org> <role> full` refuses
    outright when it detects an agent-context env var (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`,
    `MONOMIND_ORG_ROLE`, `MONOMIND_SDK_AGENT`, `MONOMIND_AGENT_EXEC` — the last set on `agent
    exec`'s own runner child env, §3), not overridable by `--yes-i-understand` or a TTY — this is
    what stops a scoped chat/org from reaching a grant through an allowed `monomind org …` Bash
    prefix. Outside an agent context it requires an interactive confirmation or
    `--yes-i-understand`, then writes an `access_ack` with a `hash` over the role's
    security-relevant config (prompt, runtime, model, tool providers, `reports_to`, coder-mode
    settings, plus the org's unattended/taint knobs) AND a `sig` — an HMAC-SHA256 of that hash
    under a machine-local secret key created on first grant and stored in the operator-credential
    directory, which every scoped/sandboxed role is denied Read/Edit on. `hash` alone is a public,
    recomputable drift check, not an authenticator, so the runtime verifies `sig` (timing-safe)
    before ever trusting it: no `sig`, an invalid `sig` (missing/wrong key), or a `hash` mismatch
    (any covered field edited since the grant) drops the role to scoped
    (`access_state: "suspended"`, reason distinguishing unsigned/invalid-signature/config-changed);
    a scheduled/daemon run without `run_config.allow_unattended_full_access` also drops it
    (`access_state: "unattended-blocked"`); and no MCP tool, hiring flow, or import path can
    produce a grant the runtime will honor, since none of them can read the signing key. `org
    validate` errors on an unsupported runtime, a `policy.git` explicitly authored below `push`
    alongside `access: "full"`, and taint (a full-access role that itself ingests untrusted input,
    or is reachable from one via `reports_to`, unless the path is in
    `run_config.accept_full_access_taint`). `org status --json` gains `roles_access` for any role
    that declares `access: "full"` (§7.2). Budgets (`maxTokens`/`maxUsd`) are still enforced.
    Additive only.
  - rev 13 (2026-09-28): **`--access full` kills the whole process tree, and reports
    background survivors** (issue #359, part of the Coder mode epic #364) — new capability
    `agent-exec-background-pids`. A full-access turn can start long-running or background
    processes via its Bash tool (a dev server, `sleep 600 &`, a watcher); `agent exec` now
    spawns the `claude` CLI as the leader of its OWN process group instead of joining
    monomind's, so `cancel`, `--timeout`, and `--budget-usd` SIGTERM the WHOLE tree (not just
    the CLI process) and SIGKILL it after a 5s grace if anything survives.
    A single point-in-time group/closure check was live-verified INSUFFICIENT against the
    real, installed Claude Code CLI, in two ways: (1) it spawns each Bash-tool shell
    invocation as the leader of its OWN, separate process group, not a member of the top
    `claude` process's group; (2) that shell, and a background job's own launching chain
    generally, frequently exits within milliseconds of starting the job — by the time
    anything checks, the PPID edge to it is gone and its process-group id was never recorded
    anywhere. `orgrt/process-tree.ts`'s `trackDescendants` fixes both, two ways:
    (1) the `claude` child's env carries a per-turn `MONOMIND_EXEC_TREE=<random uuid>`
    marker that every descendant inherits — including a `nohup cmd &` job reparented to
    init after its shell exited (live-verified) — and every kill and report also scans for
    processes carrying it (`/proc/<pid>/environ` on Linux, `ps -E` elsewhere), so timing
    doesn't matter; (2) for jobs that clear their own environment, it samples the process
    tree every 50ms (250ms off Linux) plus at each native tool call's start and result, and
    remembers every process-group id seen under the leader — a recorded group stays
    signalable via `kill(-pgid, …)` after its leader exits. Everything is read BEFORE any
    signal is sent (kill-then-read would sever the PPID edge a nested group needs). On a
    NORMAL `end_turn`, survivors are left running (the common "start the dev server, test it
    next turn" flow) but reported: `done` gains `background_pids: number[]`.
    **Residual v1 limitation**: a job that both clears or replaces its environment (`env -i`,
    some daemons) AND whose launching chain exited between samples can still go
    undiscovered on both the kill and the report paths. A fully deterministic fix would
    need cgroups or an event-based mechanism (eBPF/ptrace) outside this change's scope.
    Implemented in the RUNNER layer (`ClaudeAgentRunner`/`agent-runner-claude-fullaccess.ts`/
    `process-tree.ts`), so full-access org roles (#365) get the same kill on abort. Scoped mode's SDK
    options are unaffected (proven by an updated SDK-options snapshot test in
    `agent-runner.test.ts`). Windows: process-GROUP semantics don't exist there; the kill side
    falls back to `taskkill /T` (best-effort, tree- not group-based) and `background_pids`
    discovery is unsupported for v1 (the field is omitted, never fabricated as an empty list)
    — a documented gap, not a crash. §3's caller guidance is extended: a caller SHOULD also run
    monomind in its own process group and kill the group on Stop, and background jobs (§3.2's
    `background_pids`) are explicitly in scope of that guidance, not just the agent-CLI
    grandchild.
- **Stability**: Versioned. Frames and events carry `"v": 1`. Breaking changes bump `v` and are
  announced via the capability handshake (§2).
- **Purpose**: Expose monomind's `AgentRunner` engine (14 local agent CLI runners) and org
  observe surface to **any calling process** via stable, machine-readable subprocess contracts.
  First caller: `monoagentcli`. The protocol is public — other tools may drive monomind's runner
  engine through it.

## 1. Surfaces

| Surface | Command |
|---|---|
| One-shot agent turn | `monomind agent exec` (§3) |
| Installed-agent detection | `monomind agent scan --json` (§6) |
| Capability handshake | `monomind --version --json` (§2) |
| Org observe | `monomind org <cmd> --json` (§7) |
| Org live tail | `monomind org events --ndjson` (§7.3) |
| Workspace init | `monomind init --json` (§11) |
| Runtime model list | `monomind agent models --runtime <id> --json` (§12) |

`agent exec`, `agent scan`, and `agent test` join the **existing** `monomind agent` namespace
(swarm lifecycle: `spawn/list/status/stop/metrics/pool/health`). The name `agent list` is taken
by swarm management and is NOT reused by this protocol — the installed-only view is
`agent scan --installed` (§6).

## 2. Capability handshake

```
$ monomind --version --json
{"v":1,"version":"<x.y.z>","min_caller":"1.0.0","capabilities":["agent-exec","agent-exec-full-access","agent-exec-settings","agent-exec-tool-activity","agent-exec-background-pids","agent-scan","agent-scan-read-only","agent-models","org-json-v1","org-tool-providers","org-decision-attribution","org-endpoint-roles","org-federation","org-idle-deadline","org-role-full-access","doctor-json","doctor-read-only","doctor-offline","init-json","knowledge-profile-captures"]}
```

Callers MUST handshake before use and fail with an actionable message (install/upgrade hint)
when a required capability is absent. `min_caller` is advisory. New capabilities are additive;
removals or semantic changes bump the capability string (e.g. `org-json-v2`) or frame `v`.

## 3. `monomind agent exec`

Runs one agent turn through the resolved runner. Process model: monomind spawns the agent CLI as
its child (directly, or via the runner's SDK); the caller spawns monomind. Callers SHOULD place
monomind in its own process group so a group-kill reaps monomind **and** the agent-CLI
grandchild. **rev 13, coder mode (`--access full`)**: monomind itself now spawns the agent CLI
as the leader of a SEPARATE process group and kills that whole group on `cancel`/`--timeout`/
`--budget-usd` (§3.4) — this reaches the Bash tool's own grandchildren and `&` background jobs,
not just the CLI process, so callers should NOT assume a group-kill of monomind alone is
sufficient for those; background jobs are explicitly in scope of this guidance, and a survivor
left running after a normal `end_turn` is reported via `done.background_pids` (§3.2), not
silently leaked. To stop a full-access turn, send a `cancel` frame (with `--tools stdio`, even
when no tools are declared) or SIGTERM/SIGINT to monomind, and allow at least 6s before any
SIGKILL: monomind kills the agent's tree itself (SIGTERM, then SIGKILL after 5s). A SIGKILL sent
straight to monomind or its group never reaches the agent CLI, which is in its own group.

stdout is reserved **exclusively** for NDJSON events (§3.2). All diagnostics, warnings, and
progress go to stderr. A caller must be able to `JSON.parse` every stdout line.

### 3.1 Flags

| Flag | Req | Meaning |
|---|---|---|
| `--runtime <id>` | ✓ | Runner id: `claude, codex, kimicode, opencode, antigravity, grok, qwen, qwen-rpc, crush, copilot, pi, pi-rpc, vercel, gemini, cursor` (set grows with monomind releases) |
| `--prompt <text>` | ✓* | Prompt text (or `--prompt-file`) |
| `--prompt-file <path>` | ✓* | Prompt from file (large prompts; avoids argv limits) |
| `--system-file <path>` | | System prompt file (prepended first turn only, runner-dependent — same semantics as orgrt) |
| `--tools <mode>` | | `none` (default) or `stdio` — enable caller-side tool execution (§4) |
| `--tools-file <path>` | | Tool definitions as JSON (§4.1); enables native tool wiring where the runner supports it |
| `--tool-timeout <dur>` | | Max wait for a caller `tool_result` frame (default `120s`) |
| `--model <id>` | | Model override |
| `--cwd <path>` | | Working dir for the agent (default: cwd) |
| `--resume <sessionId>` | | Resume a prior session/thread/conversation |
| `--max-turns <n>` | | Cap agent turns (default `25`; the orgrt default is effectively unlimited and is NOT inherited here) |
| `--timeout <dur>` | | Overall wall-clock timeout for the whole exec (default: none). On expiry monomind SIGTERMs the agent child, emits `error {code:"timeout"}` + `done`, exits `124` |
| `--env KEY=V` | | Extra env for the agent process (repeatable) |
| `--protocol <v>` | | Protocol version pin (`1`); reserved for the v2 transition window (§5) |
| `--access <mode>` | | rev 12. `scoped` (default) or `full`. `full` (claude runtime only) gives the turn unrestricted native tool access: `canUseTool` allows everything (still observed via `coverEveryToolCall`), and `permissionMode: "bypassPermissions"` + the SDK's required `allowDangerouslySkipPermissions: true` opt-in are set. Rejects `--allow-bash-prefix` (usage error, exit 2). Requires an explicit, existing, directory `--cwd` and refuses root (uid 0) — both `error {code:"unsafe", fatal:true}` (§3.4). A runtime without full-access support (see `agent scan --json`'s `full_access`, §6) yields `error {code:"unsupported", fatal:true}` |
| `--settings <sources>` | | rev 12, capability `agent-exec-settings`. Coder mode: `none` (default) or a CSV of `user,project,local`. Non-`none` (claude runtime only) loads the SDK's own settings discovery — CLAUDE.md, skills, hooks, and project/user MCP servers — appends the caller's system prompt to Claude Code's own preset instead of replacing it, and merges the `org` MCP server only when `--tools stdio` gave this turn caller tools. `--settings bogus` → exit 2. See §3.2's `status` event and the `agent-exec-settings` capability note in §2. |
| `--startup-timeout <dur>` | | rev 12. Max wait for `phase:"ready"` when `--settings` is non-none (default `30s`); on expiry monomind emits `error {code:"runner-error", message:"claude did not initialize (settings/MCP startup hang?)"}` + `done`, exit 1, instead of hanging until `--timeout`. No effect with `--settings none`. |
| `--budget-usd <n>` | | rev 3. Optional spend cap for this turn, enforced via the same per-role budget mechanism orgrt already uses internally. On breach: SIGTERM the agent child, emit `error {code:"budget", fatal:true}` + `done`, exit 1. Bare `agent exec` has no default cap — callers driving cost-sensitive flows (e.g. a chat UI, not an org role) should set this explicitly. **rev 4 granularity**: on a single-shot exec the cap is checked when the turn's `result` message arrives (the AgentRunner interface surfaces usage at result granularity) — the overspend is reported as the terminal outcome (`error budget` + exit 1, **no success `result` event`) so callers stop, but a single turn's own spend cannot be interrupted mid-flight. Mid-turn enforcement arrives with M2 (`agent_ask` in orgrt, where the mailbox-close mechanism applies). |

Exactly one of `--prompt` / `--prompt-file`. Unknown flags → exit 2 with JSON error on stderr.

There is no output-mode flag: NDJSON events on stdout are the command's only output mode.

Implementation note: `AgentRunArgs.prompt` is an `AsyncIterable` (mailbox stream) and
`AgentRunArgs.tools` are in-process `OrgToolDef` handlers — `agent exec` adapts the one-shot
prompt into a single-message stream and bridges tool handler invocations to §4 frames.

### 3.2 Output: NDJSON events (stdout, one JSON object per line)

All events carry `"v": 1`. Order per turn: `start → [status] → [session] → assistant* →
[tool_call → tool_result]* → [tool_activity(start) → tool_activity(end)]* → [usage]* → result →
done`. On failure: `start → … → error → done`.

| Event | Fields | Notes |
|---|---|---|
| `start` | `v, runtime, model?, cwd, resume?, pid, child_pid?, access, streams_incrementally` | `pid` = the monomind process; `child_pid` = the agent-CLI subprocess when the runner spawns one (omitted for in-process runners). **rev 4**: v1 always omits `child_pid` — the `AgentRunner` interface does not surface child pids; add it if/when runners expose them. **rev 5**: `streams_incrementally` (bool) — whether this runtime delivers real incremental `assistant` text as a turn streams, vs. only ever a complete message at a step/turn boundary (see §9). **rev 12**: `access` (`"scoped"` \| `"full"`) — which mode this turn ran in (§3.1) |
| `status` | `v, phase ("initializing"\|"ready"), mcp_servers? ([{name,status}])` | rev 12, capability `agent-exec-settings`. Only with `--settings` non-`none` (claude runtime): `initializing` right after `start`, `ready` (with `mcp_servers`) from the SDK's own `system/init` message. Absent entirely for `--settings none` and every non-claude runtime. |
| `session` | `v, session_id` | Runner's session/thread/conversation id; pass back via `--resume` |
| `assistant` | `v, text` | Incremental assistant text (may be multi-line; callers append) |
| `tool_call` | `v, id, name, args` | Only with `--tools stdio` — caller must execute and reply (§4) |
| `tool_result` | `v, id, ok, result` | Echo of the applied result (post `canUseTool` gating) |
| `tool_activity` | `v, id, phase ("start"\|"end"), name, input?, parent_tool_use_id?, ok?, output?, output_truncated?, denied?, cancelled?, duration_ms?` | **rev 12** (#357, capability `agent-exec-tool-activity`). NATIVE tool calls only (Bash, Edit, Write, Read, …) — a bridged `--tools stdio` call keeps its `tool_call`/`tool_result` frames instead. `id` is the SDK's own tool_use id (or a locally-minted one for a start-only runtime, see below), correlating a `"start"` with its `"end"`. `"start"`: `input` is the tool's raw input as the model sent it (`Edit`/`MultiEdit` carry `old_string`/`new_string`, `Write` carries `file_path`/`content`); `parent_tool_use_id` is non-null when the call was made inside a `Task`/`Agent` subagent's own turn, for nesting. `"end"`: `ok` (bool), `output` (the tool_result content flattened to text), `duration_ms`; a call denied under scoped mode's default-deny `canUseTool` ends with `ok:false, denied:true` instead of running; a turn cut short by `--timeout` or a `cancel` frame closes every still-open id with `ok:false, cancelled:true` before `done`. Every `input`/`output` string field is capped at 16 KiB with a sibling `<field>_truncated:true` when cut, and the whole event stays well under 64 KiB regardless of how many fields a call's own input has. Fidelity varies by runtime (§9, `agent scan --json`'s `tool_activity_fidelity`): `claude` is `"full"` (a real id, matched end); a runtime whose runner only yields a lightweight `{type:'tool_use', text: toolName}` liveness signal (no id) maps it to a `"start"`-only event with no matching `"end"` (`input: null`, `parent_tool_use_id: null`); a runtime with no tool signal at all emits none |
| `usage` | `v, input_tokens, output_tokens, cost_usd` | Per-round delta (cumulative→delta conversion handled inside monomind) |
| `result` | `v, subtype ("success"\|"error"), is_error, text, stop_reason, input_tokens, output_tokens, cost_usd` | Aggregate final result; **rev 7**: `text` is the complete final assistant text — the joined `assistant` texts for a `streams_incrementally` runtime, the last `assistant` message otherwise (omitted only if the turn produced none); `stop_reason`: `end_turn` \| `max_turns` \| `tool_round_cap` \| `cancelled` \| `timeout`. **rev 4**: `tool_round_cap` is detected best-effort — it matches the runner's tool-round-cap assistant note; a fence runner that stops without the note yields `end_turn` |
| `error` | `v, code, message, fatal (bool)` | Codes in §3.4. `fatal:true` = auth/quota class — callers must not retry |
| `done` | `v, exit_code, background_pids?` | Terminal event. Always emitted exactly once, even on error. **rev 13**, capability `agent-exec-background-pids`: `background_pids` (only for `--access full`, only after a NORMAL `end_turn` — never on `cancel`/`--timeout`/`--budget-usd`, which already kill the whole tree, §3) lists pids the turn's process-tree tracker (`orgrt/process-tree.ts`'s `trackDescendants`: the inherited `MONOMIND_EXEC_TREE` env marker plus continuous sampling) found still alive at that moment. A process whose `MONOMIND_EXEC_TREE` holds any other value (empty included) has left the turn's tree and is neither listed nor killed on `cancel`/`--timeout`/`--budget-usd` — monomind's own session-hook daemons (the dashboard, the helper self-heal, monograph refresh) set it empty, so they are never reported (#366) — e.g. a `sleep 600 &` the turn started and left running on purpose, including one reparented after its launching shell exited. A survivor that cleared its own environment and whose launching chain exited between samples can go unreported (residual v1 limitation, §3's rev 13 note). Omitted (not an empty array) when access is `scoped`, or on a platform where discovery isn't supported (win32, v1) |

Exit codes: `0` success (result.subtype=success) · `1` agent/runner error · `2` usage/protocol
error (bad flags, unknown runtime, missing binary) · `124` `--timeout` expired · `130` cancelled
(SIGINT/SIGTERM, or caller `cancel` frame).

Malformed caller input (§4): monomind emits `error {code:"bad-frame", fatal:false}` and
continues; the pending `tool_call` is failed with `ERROR: bad tool_result frame` fed back to the
agent.

### 3.3 Example

```
$ monomind agent exec --runtime codex --prompt "summarize ./README"
{"v":1,"type":"start","runtime":"codex","cwd":"/app","pid":4212,"child_pid":4220}
{"v":1,"type":"session","session_id":"th_9f2a"}
{"v":1,"type":"assistant","text":"The README covers"}
{"v":1,"type":"assistant","text":" three install paths…"}
{"v":1,"type":"usage","input_tokens":1842,"output_tokens":96,"cost_usd":0.0041}
{"v":1,"type":"result","subtype":"success","is_error":false,"stop_reason":"end_turn","text":"…","input_tokens":1842,"output_tokens":96,"cost_usd":0.0041}
{"v":1,"type":"done","exit_code":0}
```

### 3.4 Error codes

| `code` | `fatal` | Meaning / caller action |
|---|---|---|
| `auth` | true | Runtime not logged in / key invalid — surface the runtime's login command; do not retry |
| `quota` | true | Rate limit / billing exhausted — do not retry |
| `missing-binary` | true | Agent CLI not installed (exit 2; see `agent scan`) |
| `no-runner` | true | rev 3. `--runtime <id>` did not resolve to a concrete `AgentRunner` (distinct from `missing-binary`: the id itself has no runner implementation, vs. a known runner's binary being absent) |
| `budget` | true | rev 3. `--budget-usd` cap exceeded mid-turn — do not retry without raising the cap |
| `runner-error` | false | Runner/turn failure; retry is caller's choice |
| `timeout` | false | `--timeout` or `--tool-timeout` fired |
| `cancelled` | false | Caller cancel frame or signal |
| `bad-frame` | false | Malformed caller stdin frame; turn continues |
| `unsafe` | true | rev 12. `--access full` refused: root (uid 0), or a missing/nonexistent/non-directory `--cwd` |
| `unsupported` | true | rev 12. `--access full` requested on a runtime whose `RunnerSpec.supportsFullAccess` is false (see `agent scan --json`'s `full_access`, §6) |

Callers must treat unknown codes as `fatal:false`.

## 4. Caller-side tools (`--tools stdio`)

Two definition styles, identical wire frames:

### 4.1 Defined tools (`--tools-file`, preferred)

The caller passes a JSON file: `[{"name","description","schema"}]` where `schema` is JSON
Schema. monomind converts these to `OrgToolDef`s whose handlers forward invocations to the
caller over stdio frames:

- **Native runners** (e.g. `claude`, SDK-based): tools are registered natively with real
  argument validation and `canUseTool`-style gating — no prompt hacking.
- **Fence runners** (non-native-tool CLIs): monomind renders the definitions into the standard
  **fence protocol** section (`orgrt/tool-fence.ts`) appended to the system prompt, and parses
  ` ```tool_call ` fences from assistant output.

### 4.2 Caller-described tools (no `--tools-file`)

The caller's `--system-file` describes its tools in any form; monomind appends the fence
protocol section and parses fences. **rev 4 mechanism**: the caller still declares the tool
NAMES via `--tool-names a,b,c` — monomind cannot execute a fence for a tool it has no handler
for, so the names create schema-less bridged tools (permissive validation, described in the
caller's own system prompt). `--tools-file` and `--tool-names` are mutually exclusive.

### 4.3 Wire frames

```
monomind stdout →  {"v":1,"type":"tool_call","id":"tc_1","name":"create_nodes","args":{…}}
caller  stdin  →  {"v":1,"type":"tool_result","id":"tc_1","ok":true,"result":{"text":"created 2 nodes"}}
```

Rules:
- One JSON object per line on caller stdin; `id` MUST match the pending `tool_call`.
- `result.text` (string) is what the agent sees; `ok:false` result text should describe the error.
- `--tool-timeout` expiry fails the call (`ERROR: tool timeout`) — the turn continues.
- Max 10 tool rounds per turn for fence runners (`MAX_TOOL_ROUNDS`, `tool-fence.ts`), then one
  wrap-up round in which the capped calls come back as "round cap reached" tool results; native
  runners are bounded by `--max-turns` instead. Hitting either cap yields
  `result.stop_reason="tool_round_cap"` / `"max_turns"` (machine-readable, §3.2).
- Caller may send `{"v":1,"type":"cancel"}` on stdin at any time to request cancellation
  (`--tools stdio` is enough; no tools need to be declared)
  (best-effort; monomind SIGTERMs the agent child, emits `error {code:"cancelled"}` + `done`,
  exit 130). A `cancel` does not need a pending `tool_call`.
- **stdin EOF**: if the caller closes stdin while `tool_call`s are pending, each pending call is
  failed with `ERROR: caller closed stdin` and the turn continues with tools disabled (no
  further `tool_call` frames are emitted). EOF with nothing pending is a no-op.

## 5. `monomind agent exec` versioning

- Event/flag additions within `v:1` are non-breaking; callers must ignore unknown event types and
  unknown fields.
- Breaking changes ⇒ `v:2` + new capability string `agent-exec-v2`. Old behavior is retained for
  one minor release, selectable via `--protocol 1` (§3.1).

## 6. `monomind agent scan --json`

```
$ monomind agent scan --json
{"v":1,"agents":[
  {"id":"claude","installed":true,"binary":"/usr/local/bin/claude","version":"1.0.58","install_hint":"","streams_incrementally":true,"full_access":true,"tool_activity_fidelity":"full"},
  {"id":"codex","installed":false,"binary":null,"version":null,
   "install_hint":"npm install -g @openai/codex && codex login","streams_incrementally":false,"full_access":false,"tool_activity_fidelity":"start-only"},
  …
]}
```

One entry per known runner (set grows with monomind releases). Honors `<NAME>_CLI_BIN`
overrides. Binary probes run in parallel with a 5s per-binary timeout so a hung `--version`
probe cannot stall the scan. Exit 0 always (detection, not a test). **rev 5**: `streams_incrementally`
is static per-runtime metadata (`RunnerSpec.streamsIncrementally`, §9) — unlike `installed`/`version`,
it never depends on probing the binary, so it's always present even when `installed:false`. **rev 12**: `full_access` is likewise static per-runtime metadata (`RunnerSpec.supportsFullAccess`) — whether `agent exec --access full` (§3.1) is implemented for this runtime; only `claude` is `true` today. **rev 12**
(#357): `tool_activity_fidelity` (`"full"|"start-only"|"none"`) is the same kind of static metadata
(`RunnerSpec.toolActivityFidelity`) for the §3.2 `tool_activity` event — see §9.

`agent scan --installed --json` = installed-only view (the name `agent list` is reserved by the
pre-existing swarm command, §1). `agent test <id>` = one smoke turn via `agent exec`
(**rev 4**: it emits the same NDJSON event stream; success = a `result` event with
`subtype:"success"`; auth problems surface as `error {code:"auth", fatal:true}` — so `test`
doubles as the auth smoke check).

Auth status is deliberately NOT probed by `scan` (login checks are too heterogeneous); auth
failures surface at exec time as `error {code:"auth", fatal:true}` with the runtime's login
hint in `message` (§3.4).

**rev 9**: each entry also has `install` and `login_hint`:

```
"install":{"kind":"npm","packages":["@anthropic-ai/claude-code"]},"login_hint":"claude login"
"install":{"kind":"script","url":"https://antigravity.google/cli/install.sh","shell":"bash"},"login_hint":null
"install":{"kind":"manual"},"login_hint":null
```

`install` is derived from `install_hint` and only takes the two shapes a caller can run without a
shell: `npm install -g <packages>` (each a plain package spec whose version, if any, is a tag or an
exact, `^` or `~` version — no ranges or wildcards) and `curl -fsSL <url> | bash|sh`, where `<url>`
is a plain https URL (host, then a path of letters, digits and `._~/-`; no credentials, query or
shell syntax). Anything else — prose, a plain `npm install`, extra shell syntax — is `manual`, and
the caller shows `install_hint` to a person instead.

`login_hint` is display text for a person (`claude login`, `kimi (interactive first run)`); a
caller shows it and never executes it.

**rev 11** (capability `agent-scan-read-only`, issue #337): `agent scan` writes nothing and, by
default, runs no runtime that is not known to be side-effect free. Each entry has
`version_source`, which says where `version` came from:

| `version_source` | Meaning |
|---|---|
| `"package.json"` | the `version` of the npm package whose `bin` is the resolved binary |
| `"install-path"` | the version directory of a mise/asdf install (`…/installs/<tool>/<version>/…`) |
| `"exec"` | the first line of `<binary> --version` (`version` is `null` if it printed nothing or timed out) |
| `"not-probed"` | the binary was not run and its install files name no version; `version` is `null` |
| `null` | not installed |

The binary is run only when its install files name no version and either the runtime is on the
allow-list of runtimes whose `--version` was measured to write nothing (`claude`, `antigravity`,
`pi`, `pi-rpc` — `SIDE_EFFECT_FREE_VERSION` in `orgrt/version-probe.ts`, with the measurements) or
the caller passes `--probe`. A run gets a new scratch directory as its cwd, `HOME`, XDG dirs,
`TMPDIR`, `CODEX_HOME`, `GROK_HOME` and `HERMES_HOME`, with `DISABLE_AUTOUPDATER=1`,
`NO_UPDATE_NOTIFIER=1` and mise auto-install off; the directory is deleted when the probe ends.
`--probe` can still use the network (grok downloads its native binary into the scratch HOME before
printing its version), so a caller on a timer should not pass it. A mise shim run under a scratch
HOME usually cannot find its tool and reports `version: null`.

## 7. Org observe contracts

### 7.1 Conventions

- `monomind org <cmd> --json` emits a single JSON object (or array) on stdout; human output
  suppressed; diagnostics on stderr only. **rev 4**: the flag is the CLI's **global
  `--format json`** (choice of the global `text|json|table` option), not a per-command `--json`
  (that name is already input-only on `org inbox`). Output is **compact single-line** JSON —
  NDJSON-safe for line-oriented callers. `agent scan` is the one exception: it carries its own
  `--json` boolean (§6) and also accepts the global `--format json`.
- Envelope for lists: `{"v":1,"org":"<name>","items":[…]}`; singletons are bare objects with `v`
  (`org status <name>` is a singleton; bare `org status` is a list envelope).
- Timestamps: org state files carry epoch millis; `BusEvent.ts` is epoch millis (see
  `orgrt/types.ts`). Unknown fields must be ignored by callers.
- **Project resolution**: orgs are project-local (`.monomind/orgs/`). Commands resolve the
  project by walking up from the process cwd; callers that manage multiple projects (mono-agent)
  MUST spawn each org command with the project root as cwd. Exit codes for org commands: `0`
  success, `1` runtime/state error (e.g. org not found), `2` usage error.

### 7.2 Commands (Phase 0 set)

Existing commands gaining `--json` output: `org status`, `org logs [--tail N]`, `org report`,
`org costs`, `org inbox`, `org flow`, `org questions`, `org gates`, `org decisions`,
`org memory`, plus action results for `org answer/approve/deny/gate-approve/gate-reject`
(return the updated entity as JSON).

`org list` (all orgs in the project) already exists (`commands/org-manage.ts → listAction`) — it only gains
`--json` output here, same as the other commands above (rev 3). **The only genuinely new
command** added for this protocol is `org events` (§7.3).

Shapes mirror the underlying state files (`runtime.json`, `history.jsonl`, `questions.json`,
`gates.json`, `decisions` traces) — see `orgrt/types.ts` for field definitions. Snapshotted in
monomind's `--json` contract tests.

**Idle deadline** (capability `org-idle-deadline`): for a `running` org, `org status --json` adds
`idle_stop_at` (ISO-8601 or `null`), `idle_stop_in_seconds` (`null` with it) and `idle_hold`.
`idle_stop_at` is when the idle watchdog stops the run if nothing happens before then (the
earliest stop; the watchdog checks every min(idle/2, 30 s)). When it is `null`, `idle_hold` says
why: `disabled` (`idle_minutes: 0`), `restarting`, `pending-gate`, `pending-question`,
`pending-approval`, `endpoint-reply-due`, `task-blocked`, or `unknown` (no record from this run
yet, e.g. a daemon older than the capability).

**Full-access role visibility** (capability `org-role-full-access`, issue #365): `org status
--json` gains `roles_access`, an array of `{role, access, access_state, reason?}` — one entry per
role that declares `policy.access: "full"` in the org's config, omitted entirely for an org with
none. It is computed from the config and the grant, so it is present whether or not the org has
run (`status: "never run"` included, #367). `access` is what the role runs (or would run) with
(`"scoped"` or `"full"`);
`access_state` is `"active"`, `"suspended"` (no valid human acknowledgement, or the role's config
changed since the grant), or `"unattended-blocked"` (a scheduled/daemon run without
`run_config.allow_unattended_full_access`); `reason` is a human-readable explanation, present
whenever `access_state !== "active"`. See `doc/concepts/org-runtime.md`'s "Full access" section
and `monomind org role set-access --help`.

### 7.3 `monomind org events --ndjson [--follow] [--since]`

Live tail of `bus.jsonl`: one `BusEvent` JSON object per line (shape per `orgrt/types.ts:340`),
optionally following (`--follow`) like `tail -f`. `--since <eventId|iso>` replays from a cursor
(an event id replays everything strictly after it; an ISO-8601 timestamp filters older events).
This is the UI's live-stream source for org activity. **rev 4**: NDJSON is this command's only
output mode — the `--ndjson` flag is accepted for spec symmetry. `org logs --format json` refuses
`--follow` and points here.

### 7.4 Read-only state access

Callers may read `<projectRoot>/.monomind/orgs/<name>/runtime.json` and run `bus.jsonl` directly
(read-only) for high-frequency UI needs. **Never write these files.** All mutations go through
`org` commands (`--json` action results).

## 8. Testing requirements (monomind-side, Phase 0 gate)

1. Fake-runner round-trip: scripted NDJSON runner exercises every event type + stdio tool loop,
   in both §4.1 (tools-file, native-path fake) and §4.2 (fence) modes (extend the
   `orgrt/test-loop.ts` fake-SDK pattern).
2. `--json` snapshot tests for §7.2 commands, including the new `org list` and `org events`.
3. Handshake test (`--version --json` shape + capability gating).
4. Golden NDJSON transcripts published at `doc/agent-exec-protocol/fixtures/*.ndjson` (success,
   tool-loop, fatal auth, timeout, cancel, bad-frame, tool-activity, full-access,
   full-access-background) so callers can build contract tests without running monomind;
   mono-agent's Phase 1 gate consumes these.
5. Two real runners smoke-tested (whatever is installed in CI/dev).

### 8.4 Status (rev 4)

Items 1–4 are implemented: `src/__tests__/agent-exec.test.ts` (fake-runner round-trips in both
tool modes plus §3.2's `tool_activity` events, #357), `src/__tests__/runner-registry.test.ts`
(scan + handshake + `tool_activity_fidelity`), `src/__tests__/agent-runner.test.ts`
(`ClaudeAgentRunner`'s own `tool_use`/`tool_result` shapes), `src/__tests__/tool-activity.test.ts`
(the event builder's size caps, denial, and cancel-close logic in isolation),
`src/__tests__/org-json-contracts.test.ts` (§7.2/§7.3 snapshots), and the fixtures above
(validated by `src/__tests__/agent-exec-fixtures.test.ts`). Item 5 is a manual/CI gate —
run `monomind agent test <id>` for two installed runtimes before release.

## 9. Adding a new `AgentRunner`

Every runner ends up wrapping a different vendor CLI or SDK, each with its own idea of whether
(and how) it can report a turn's text as it's generated rather than only once it's complete. This
section is the checklist for deciding that honestly and wiring it in consistently — added in rev 5
after an audit found most runners silently buffered to a step/turn boundary even when their own
protocol already supported better.

1. **Determine whether the wire format has real per-token/per-chunk deltas.** Check the CLI/SDK's
   own docs or type definitions first. If those are ambiguous or silent, confirm empirically
   against the live binary — this codebase's convention (several runner headers already do this)
   is to note "confirmed live, vX.Y.Z" once checked, so a future reader knows it was actually
   observed, not assumed. A whole-message wire format (one complete item/event per turn, no delta
   field anywhere) is a hard limitation — nothing to fix, see step 3.
2. **If yes — wire it using the decouple-and-diff pattern**, not by trying to unify streaming and
   the runner's own bookkeeping into one code path:
   - Keep whatever full/authoritative text the rest of the runner needs (tool-call fence parsing,
     the final result) completely unchanged, computed exactly as before.
   - Separately track how much of that text has already been shown to the caller.
   - On each new chunk, compute what's newly safe to reveal and yield only that increment.
   - At the turn's true completion, diff the authoritative full text against what's already been
     shown and yield only the remainder (normally empty — already fully streamed). This is what
     makes the design self-correcting instead of needing every edge case handled up front: any gap
     between the fast incremental path and the slow authoritative one resolves itself here.
   - Reference implementations: `antigravity-runner.ts`'s `computeSafeChunk`/`emitVisible`/
     `flushText` (needs fence-boundary awareness — a `` ```tool_call `` fence must never appear,
     complete or partial, in visible text) and `agent-runner.ts`'s `ClaudeAgentRunner` (content-
     block-index awareness instead of fence-boundary awareness — no fence concern there, since
     Claude's content blocks are already cleanly delimited).
   - **Gate it — every `AgentRunner` has two consumers, not one, whether or not that's obvious
     yet.** Any runner selectable via role/org `runtime: '<id>'` is driven by BOTH `agent-exec.ts`
     (wants incremental text) AND `session.ts`, the org runtime (wants exactly one `assistant`
     AgentMessage per step/round — it feeds the full text into `StateDetector`'s regex
     pattern-matching and emits one org chat-bus event per step). This is not a "check if it
     applies" step — it applies to every subprocess runner unconditionally, since `session.ts`'s
     consumption is runner-agnostic. Skipping this gate was a real bug caught at rev 5: the first
     pass only gated `claude`, and the identical risk went unnoticed in `antigravity`/`qwen-rpc`/
     `opencode` until traced through explicitly and retrofitted onto all of them. Gate behind
     `AgentRunArgs.extras` (already a "provider-specific escape hatch, other runners ignore it") —
     `agent-exec.ts` sets `extras.includePartialMessages: true` unconditionally for every runtime
     (§3.1); `session.ts` never sets `extras` in production (only its own test seam does). The
     runner reads `args.extras?.includePartialMessages === true` once at the top of `run()` and
     gates every incremental yield behind it; the reconciliation diff at turn-end needs no separate
     branch — with the flag off, the high-water mark never advances, so it naturally degrades to
     "reveal the whole text," byte-for-byte the pre-streaming behavior.
   - Set `streamsIncrementally: true` in `runner-registry.ts`'s `RunnerSpec`.
3. **If no — set `streamsIncrementally: false`** and make sure the runner still yields each
   complete message the instant it lands, with zero added buffering — waiting for a step boundary
   or the whole turn to finish when the message was already complete earlier is its own bug,
   independent of whether real streaming is possible (this was true of `qwen-rpc-runner.ts` at rev
   5 — see its `RunnerSpec` comment). Callers use the flag to set the user's expectations honestly
   (§3.2/§6) rather than a live UI implying a turn is stuck when it was never going to show partial
   output.

**`tool_activity_fidelity`** (rev 12, #357, `runner-registry.ts`'s `RunnerSpec.toolActivityFidelity`,
mirrored on `agent scan --json` entries — §3.2, §6): a second, independent honesty field, orthogonal
to `streamsIncrementally` above — a runtime can stream real incremental text and still have no way
to report tool activity, or vice versa. Set it by checking what the runner's own `AgentMessage`
stream already yields for a tool call (`orgrt/*-runner.ts`), not by adding new runner code for this
feature alone:
- `"full"` — the runner yields a real tool_use id, name, and input, AND later a matching
  `tool_result` for the same id (today: `claude` only, via `ClaudeAgentRunner`'s own
  `'tool_use'`/`'tool_result'` AgentMessages). `orgrt/tool-activity.ts`'s `ToolActivityTracker`
  turns this into a matched start/end pair.
- `"start-only"` — the runner only yields a lightweight `{type:'tool_use', text: toolName}`
  liveness signal, with no id to correlate an end with (`codex`, `kimicode`, `antigravity`, `grok`,
  `qwen`, `crush`, `copilot`, `pi` today). `ToolActivityTracker` maps this to a `tool_activity`
  `"start"` under a locally-minted id, with no matching `"end"` — do not invent one; a fabricated
  `ok`/`duration_ms` a caller can't verify is worse than omitting it.
- `"none"` — the runner's `AgentMessage` stream carries no tool signal a caller could act on at all,
  whether because it never yields `'tool_use'` (`opencode`, `vercel`, `qwen-rpc`, `pi-rpc` today) or
  because what it yields isn't really per-call information (`hermes`'s own `'tool_use'` is a single
  fixed `"turn started"` placeholder ping per turn, not a tool name — mapping it through the
  `"start-only"` path would fabricate a misleading tool_activity event, so it is `"none"` despite
  matching the AgentMessage shape). `ToolActivityTracker` emits nothing for a `"none"` runtime.

## 10. `monomind doctor --json` (capability `doctor-json`, rev 9; `doctor-read-only`, `doctor-offline`, rev 10)

```
$ monomind doctor --json            # all checks for the cwd's project; changes no file
$ monomind doctor --json --offline  # …and uses no network
$ monomind doctor -c helpers --fix --json
{"v":1,"cwd":"/path/to/project","read_only":false,"offline":false,"success":true,"error":null,
 "summary":{"passed":20,"warnings":3,"failed":0,"info":4,"skipped":0},
 "results":[
  {"component":"helpers","name":"Helper Files","status":"warn","message":"48 stale helper(s): …",
   "fix":"monomind init upgrade","fix_safety":"auto","fix_flag":"--fix","skipped_reason":null},
  {"component":"claude","name":"Claude Code CLI","status":"pass","message":"v2.1.281",
   "fix":null,"fix_safety":null,"fix_flag":null,"skipped_reason":null},
  …],
 "fixes":[{"component":"helpers","outcome":"applied"}]}
```

- stdout holds exactly this one document; everything a check or fix prints (including the
  subprocesses a fix runs, and `-v` debug lines) goes to stderr.
  Exit code as without `--json` (1 when a check failed).
- `component` is the `-c` name that runs the check again on its own; one component can yield
  several results (same `component`, different `name`). `status` is `pass|warn|fail|info|skipped`;
  a `skipped` result did not run, and `skipped_reason` (`read-only` or `offline`, null otherwise)
  says why.
- `fix` is the hint text. `fix_safety` says how it is applied: `auto` — local and repeatable,
  applied by `--fix`; `confirm` — installs software or runs network or `sudo` commands (the Claude
  Code CLI by `--install`, the monoes tools by `--fix`), so the caller asks a person first;
  `manual` — a person follows the hint (`fix_flag` null). `fix_flag` names the flag that applies an
  `auto` or `confirm` fix. Safety is per result: one component can have an `auto` warning and a
  `manual` one (e.g. `helpers`: stale copies are `auto`, hooks left over from a rename `manual`).
- `error` is null, or why no checks ran (`unknown component "<name>"` for a bad `-c`).
- `fixes` lists what `--fix`/`--install` attempted in this run (`applied|failed`); results then
  show the re-checked state.
- Checks run against the process cwd, so a caller runs it with cwd = the project to check.

### 10.1 Read-only and offline (capabilities `doctor-read-only`, `doctor-offline`, rev 10)

- **Read-only** (`read_only: true`) is the default under `--json` unless `--fix` or `--install` is
  given, since a fix is a write. `--read-only` asks for it without `--json`, and `--no-read-only`
  turns it off. `--read-only` with `--fix` or `--install` is refused (`error`, exit 1).
  A read-only run changes no file in the project or `$HOME`: no startup registry refresh or
  update check, the agent registry is built in memory only, the monograph db is read without
  touching SQLite's `-shm`/`-wal` files, and `npm` runs with a throwaway cache in the system temp
  dir, removed afterwards (npm writes its cache dir on every command, even `npm root -g`).
  Read-only is about files, not the network: the version check still asks the npm registry.
  Two checks are skipped (`skipped_reason: "read-only"`) because they cannot run without
  writing: `kg` (opening the memory database writes to it) and `-c pick` (rebuilds stale
  indexes). `-c mcp` is skipped too, because it starts the MCP server, which runs its own
  startup.
- **Offline** (`offline: true`, `--offline`) skips every check that uses the network, with
  `skipped_reason: "offline"`: `version` (asks the npm registry), `-c monoes-tools` (GitHub
  releases), `-c jev`/`-c decision` (probe providers) and `-c mcp` (may download the server with
  `npx`). The full run's `mcp` and `jev` rows are config-only and still run. The startup update
  check is skipped as well. `--offline` with `--install` is refused; `--offline --fix` applies only
  local fixes.
- Callers that need these guarantees check for the capability first: an older monomind rejects or
  ignores the flags, and writes under `--json`.

## 11. `monomind init --json` (capability `init-json`, rev 12)

Headless, idempotent workspace init for a coder session (mono-agent's "Coder mode" epic,
monoes/monomind#364, sub-issue #358). Turns an arbitrary folder — a fresh scratch directory or an
existing, user-owned repo — into a ready-to-use monomind/Claude Code workspace with no terminal
prompts and, under `--if-missing`, a guarantee that nothing the user already has gets touched.

```
$ monomind init --project /path/to/workspace --if-missing --json --yes --no-watch --no-install
{"root":"/path/to/workspace","created":["CLAUDE.md",".claude/settings.json",".mcp.json"],
 "skipped":[],"claude_project_registered":false,"duration_ms":842}
```

### 11.1 Flags (all usable with or without `--json`)

- `--project <dir>` — initialize `<dir>` instead of the process cwd, equivalent to
  `cd <dir> && monomind init`. The directory must already exist; a missing one is an error
  (`exitCode 1`, and under `--json` an `{"success":false,"error":"Directory does not exist: …"}`
  document on stdout instead of the success shape above).
- `--if-missing` — create only files that do not already exist. Never modifies an existing
  `CLAUDE.md`, `AGENTS.md`, `.claude/settings.json`, `.mcp.json`, or any other file init would
  otherwise merge into (settings.json's hook/env/permission backfill, CLAUDE.md's managed block,
  skills/commands/agents copies, …) — every one of those is reported in `skipped` instead.
  Idempotent: running it again against the same directory produces `"created":[]`. Also acts as
  consent to run against an already-initialized directory — normally `init` without `--force`
  refuses that (`"Already initialized. Use --force or --yes to reinitialize."`) unless `--yes` is
  also given; `--if-missing` alone is enough.
- `--json` — print exactly one JSON document on stdout (schema below) and suppress all
  human-readable output (no spinner, no boxes, no prompts — a caller with `--json` is always
  treated as non-interactive). Every other init flag (`--minimal`/`--full`/`--target`/`--platform`/
  `--skip-claude`/`--only-claude`/`--pin`/`--no-memory`/…) behaves identically whether or not
  `--json` is also passed — they share one option-resolution path
  (`src/init/resolve-options.ts`).
- `--no-graph` — skip the Monograph code-graph build, the slowest step of a full init. A coder
  workspace wants to be ready in a few seconds; build the graph lazily on first real use instead
  (`monograph_build`, or a plain `monomind monograph build` later).
- `--register-claude-project` — best-effort, model-free registration; see §11.3.

### 11.2 JSON result

Success: `{root, created, skipped, claude_project_registered, duration_ms}`.

- `root` — the resolved absolute target directory (`--project`, or the cwd).
- `created` — every directory and file this run actually wrote (init's `created.directories` and
  `created.files`, flattened). Every file `--if-missing` guards (CLAUDE.md, AGENTS.md,
  `.claude/settings.json`, `.mcp.json`, the skills/commands/agents/helpers it copies) is
  guaranteed absent from `created` on a re-run that finds them already present — that is the
  literal safety contract. A handful of purely informational bookkeeping entries this init system
  reports on every successful run regardless of `--if-missing` (re-indexing the agent/skill
  registries, a "second brain" doc re-scan) can still appear even when nothing on disk actually
  changed; they are not files a caller should treat as newly written.
- `skipped` — every path left alone because it already existed (via `--if-missing`, or init's
  ordinary non-`--force` skip-if-present behavior for CLAUDE.md/.mcp.json/AGENTS.md/etc.).
- `claude_project_registered` — `true` when `~/.claude/projects/<slug>/` exists for `root` at the
  end of this run (see §11.3 for exactly what that means and doesn't mean). **Always computed by
  checking the filesystem after the run**, never assumed — a plain `init` (no
  `--register-claude-project`, no Claude turn ever run in this directory) truthfully reports
  `false`.
- `duration_ms` — wall time for this invocation, measured start to finish of the command's own
  action (not the whole process).

Failure: `{"success":false,"error":"<message>","duration_ms":<n>}` on stdout (same stream, same
"exactly one document" rule), `exitCode 1`.

### 11.3 Headless trust: does a Claude turn need a throwaway call first?

mono-agent's current profile init (`internal/monomind/profile_init.go`) runs
`monomind init --yes --no-watch --no-install` and then a throwaway `claude -p "monomind
initialized"` in the same directory, solely so `~/.claude/projects/<slug>/` exists (mono-agent's
dashboard lists sessions from that directory).

Investigated empirically (live `@anthropic-ai/claude-agent-sdk` `query()` calls, real
credentials, scratch `HOME`s — no test doubles, since the question is about a closed-source CLI
binary's filesystem side effects): a single `query({ cwd, ... })` call — under **both** agent-exec's
current locked-down options (`settingSources: []`) and coder mode's planned "normal setup"
options (`settingSources: ['user','project','local']`, issue #356) — creates
`~/.claude/projects/<slug>/<sessionId>.jsonl` as a side effect of completing one real turn, with
`<slug>` = the absolute cwd with every path separator replaced by `-`. **The throwaway
registration call is therefore unnecessary**: a coder session's first real turn (which runs
through `monomind agent exec` regardless) registers the directory on its own — mono-agent's own
dashboard-listing need is met with zero extra model calls once #355/#356 land.

The same calls, in both option shapes, left `~/.claude.json`'s `projects[<path>]` map completely
empty (`hasTrustDialogAccepted` and friends). That bookkeeping belongs exclusively to the
interactive CLI's onboarding/trust-dialog flow; it is not reachable through the SDK, headlessly,
under any options tried. If a caller's idea of "trust" specifically means that flag, it cannot be
set without a model call and this issue does not attempt to fake it.

`--register-claude-project` implements the one piece that **is** model-free and honest: it
`mkdir -p`s `~/.claude/projects/<slug>/` (empty, no session file) when it does not already exist,
so a listing that only checks directory existence sees the workspace immediately, without waiting
for or forcing a real turn. It never writes to `~/.claude.json`. `claude_project_registered` in
the JSON result reflects the filesystem truthfully either way — it is `true` exactly when that
directory exists, regardless of how it got there (a prior real session, a prior
`--register-claude-project` call, or this run's own).

## 12. `monomind agent models --json` (capability `agent-models`, rev 14)

`monomind agent models --runtime <id> --json` prints the models the runtime itself offers, so a
caller does not keep a hand-written list that goes stale (issue #369). It spawns the runtime but
never sends a prompt, so it costs no model call; it is separate from `agent scan` (§6), which
stays read-only.

```json
{"v":1,"runtime":"claude","supported":true,"models":[
  {"id":"default","resolved_id":"claude-opus-5-5","label":"Default (recommended)",
   "description":"Opus 5.5 · Best for everyday, complex tasks","default":true,
   "effort_levels":["low","medium","high","xhigh","max"]},
  {"id":"sonnet","resolved_id":"claude-sonnet-5","label":"Sonnet","effort_levels":["low","medium","high"]}
]}
```

| Field | Meaning |
|---|---|
| `id` | What to pass as the runtime's model option (`agent exec --model`, a role's `model`) |
| `resolved_id` | The concrete model an alias resolves to today (claude only; omitted when equal to `id`) |
| `label`, `description` | Display text from the runtime |
| `default` | `true` on the runtime's own default choice (claude's `default` entry) |
| `effort_levels` | Supported reasoning-effort values, when the runtime reports them |

Sources: `claude` — the Agent SDK's `query().supportedModels()`, the list Claude Code's `/model`
picker shows for the signed-in account (it varies by account and plan); `codex` —
`codex debug models`, only entries with `visibility: "list"`; `antigravity` — `agy models`;
`opencode` — `opencode models`. Every other runtime has no listing command:
`"supported": false, "models": []`, exit 0 — pass a model id its CLI accepts.

Errors keep the same shape with `models: []` and an `error: {code, message}`: `unknown-runtime`
(exit 2), `missing-binary` or `list-failed` (the command failed or timed out after 30s; exit 1).
