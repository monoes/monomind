# Agent Exec Protocol — v1 (rev 29)

- **Status**: Implemented (Phase 0 of the mono-agent delegation plan — see
  `mono-agent:docs/plans/local-agent-monomind-delegation.md`)
- **Security**: see [`doc/concepts/coder-mode-security.md`](concepts/coder-mode-security.md) for
  the Coder mode threat model, the `--access full` guardrails (root refusal, no transitive
  escalation, env hygiene, audit log), what callers own, and residual risks (issue #360).
- **Revision history**:
  - rev 29 (2026-09-30): **`org sign` capabilities, and `org sign` rejects unknown options** — new
    capabilities `org-sign-check`, `org-sign-expect-hash` and `org-sign-review-json` (§7.2). They
    announce `org sign`'s machine-facing flags so a caller can handshake before relying on one:
    `org-sign-check` — `org sign <org>|--all --check [--format json]` and `--project <dir>`
    (issue #561); `org-sign-expect-hash` — `org sign --expect-hash <hex>` (`<org>=<hex>` per org
    with `--all`) and the `hash` in `--check --format json`; `org-sign-review-json` —
    `org sign <org> --format json` prints the review as one JSON object and never signs. From this
    revision `org sign` exits 2 on any option it does not know and signs nothing; before it, an
    unknown option was ignored, so a build without `--expect-hash` signed with exit 0. A caller
    that passes `--expect-hash` checks for `org-sign-expect-hash` first. Other commands' flag
    handling is unchanged. Full contract: `doc/commands/org.md` (`sign`).
  - rev 28 (2026-09-30): **unknown cost is `null`, never `0`** (issue #533) — new capability
    `agent-exec-cost-null`. `usage.cost_usd` and `result.cost_usd` (§3.2) are `null` when the
    runtime reported no cost for the turn (`reports_cost: false` in §6, e.g. codex, kimicode,
    hermes, vercel); before this revision they were `0`, indistinguishable from a free turn. A
    `null` cost never counts toward `--budget-usd`. `agent test --json`'s `cost_usd` (§13) is
    `null` when the runtime reported none and monomind has no price for the model (it was `0`
    when no tokens were reported); a turn that never started still reports `0`. Org surfaces
    follow: a `usage` bus event carries `cost_usd: null`, and `org report --json`'s
    `total_cost_usd`, its per-role `roles[].costUsd`, and `org costs --json`'s
    `items[].cost_usd` / `totals.cost_usd` are `null` when no usage event of that scope
    reported a cost, otherwise the sum of the reported costs — a lower bound when some usage
    had no cost, which `org report --json`'s `cost_complete` and `org costs --json`'s
    `totals.cost_complete` (`false`) say. Callers that summed the field
    must treat `null` as "unknown", not `0`. **Same rev** (issue #534), capability
    `agent-models-alias-of`: `agent models --json` (§12) keeps every entry, and one that
    resolves to the same model as an earlier entry carries `alias_of: <that entry's id>` (claude
    `opus` → `"alias_of":"default"`); the earlier, canonical entry lists every id in `aliases`. A
    caller that tests each model once skips `alias_of` entries; a lookup by id still finds them.
    Neither alias's resolution changed.
  - rev 27 (2026-09-30): **a missing API key is `auth`** (issue #532) — no new capability. §3.4's
    `auth` also covers a credential that was never set: an error whose message says "missing API
    key", "no API key found/configured" (pi, and the pi-rpc runner's `pi auth check` pre-check)
    or "no inference provider configured" / "no API keys or providers found" (hermes) is now
    `error {code:"auth", fatal:true}` on every runtime; it was `runner-error`. Text a runner
    attaches but did not write itself (a CLI's stdout, the model's final words — hermes, cline)
    follows a `[output below is not classified]` line in `message` and never decides the code.
    Additive only. Also (issue #531): with hermes 0.19.0, which has no `--query-file`, the hermes
    runner passes the whole prompt on the command line (`hermes chat --query=<prompt>`), so
    while a turn runs other local users can read it in `ps` or `/proc/<pid>/cmdline`; builds
    with `--query-file` still get it in a private temp file.
  - rev 26 (2026-09-29): **more `--sandbox` modes, and `--sandbox-fallback`** (issue #482) — new
    capabilities `agent-exec-sandbox-restricted` and `agent-exec-sandbox-fallback`. Without
    `--sandbox` nothing changes: every runtime's argv and `start` are as in rev 25. **New mode
    `restricted`** (§3.1): the CLI's own approval rules apply and every call they would ask about
    is refused (nobody can answer a headless turn). It is not a file-system boundary: what it
    covers is the CLI's rule set, including the user's own allow rules. **New modes per runtime**,
    each checked against the installed CLI and a live turn that tried a write and a shell command:
    copilot `restricted` (no `--allow-all-tools`), `read-only` (`--deny-tool=write
    --deny-tool=shell`; deny rules beat every allow rule) and `workspace-write`
    (`--allow-tool=write --deny-tool=shell` without `--allow-all-paths`: edits only under the
    cwd, `--add-dir` and the temp dir, a symlink out of the cwd refused too, no shell);
    antigravity `restricted` (no `--dangerously-skip-permissions`: shell and file writes are
    auto-denied, the temp dir excepted, and the turn then ends without a reply); opencode
    `restricted` (`OPENCODE_PERMISSION` sets edit/bash/task/external_directory to `ask` and
    monomind rejects every ask; an agent's own `permission` block in the user's or project's
    opencode.json still overrides it, so it is not `read-only`; refused with an attached
    `OPENCODE_URL` server, whose rules monomind cannot set); pi and pi-rpc `read-only` (`--tools
    read,grep,find,ls`, the rev 21 read mode); claude `read-only` and `workspace-write` with
    `--access scoped|read` only, `native_sandbox: "monomind"` (monomind's gate runs no native tool
    that is not allow-listed, so no native Write/Edit/NotebookEdit runs and Bash runs only the
    caller's `--allow-bash-prefix` commands; a caller tool named like a native tool no longer lets
    that tool through). claude `--access full` keeps only `full`. Strictness, tightest first:
    `read-only` > `restricted` > `workspace-write` > `full`. **`--sandbox-fallback
    fail|strictest|run`** (§3.1) says what a mode the runtime lacks does: `fail` (default) is the
    rev 23 `error {code:"unsupported", fatal:true}`; `strictest` runs the closest supported mode
    that is at least as strict as the request, or, when every supported mode is looser, the
    strictest there is; `run` runs the runtime default (`full`). **`start`** gains
    `sandbox_requested` and `sandbox_applied` whenever `--sandbox` is given (§3.2); when they
    differ (a fallback, or an org git level below `push` capping codex/grok/dsh at
    `workspace-write`), a `status {phase:"notice", message}` follows `start`. `native_sandbox`
    gains the value `"restricted"`; pi's `--access read` now reports `"read-only"` (it was
    `"none"`). **`agent scan --json`** entries gain `sandbox_mode_reports` (§6). **`agent test
    --json`** takes `--sandbox-fallback` and its result gains `sandbox_applied` (§13).
  - rev 25 (2026-09-29): **`agent test --json` takes `--sandbox` and `--env`**
    (issue #474) — new capability `agent-test-sandbox`. `monomind agent test <id> --json` (§13)
    accepts `--sandbox read-only|workspace-write|full` and repeatable `--env KEY=V` with the same
    meaning and validation as `agent exec` (§3.1). The result gains `native_sandbox`: what the
    vendor CLI really ran with, copied from the turn's `start` event (§3.2), or `null` when the
    turn never started. A mode the runtime lacks gives `status: "error"`,
    `error.code: "unsupported"`. Access stays `scoped`; `--sandbox` and `--env` can tighten the
    turn but never loosen it (an org git level below `push` still caps codex/grok at
    `workspace-write`). Additive only.
  - rev 24 (2026-09-29): **subagent events on every runtime** (issue #387, remaining part) — no
    new capability; `agent-exec-subagent-events` now covers every runtime, not only claude. On a
    runtime other than claude, a native tool call whose `tool_activity(start)` has `kind:"task"`
    is followed by a synthesized `subagent` `started` event, and its `tool_activity(end)` by a
    `finished` event (§3.2.1). Both use the call's `tool_activity` id as `id` and `tool_use_id`.
    These events are synthesized from `tool_activity`, so they carry less than claude's: no
    `progress` phase, no `usage`, no `last_tool`; `finished.status` is `completed`, `failed`,
    `denied` or `stopped` (cancel/timeout), and `summary` is the first 500 characters of the
    call's output. Runtimes whose runner sets `kind:"task"` itself: opencode (`task`), cline
    (`spawn_agent`, `team_*`) and dsh (`subagent`, `subagent_fork`); on others the shared name
    table (`orgrt/tool-kind.ts`) gives `task` to `Task`, `Agent`, `spawn_subagent`,
    `invoke_subagent`, `browser_subagent`, `spawn_agent` and `subagent`. A start-only
    `tool_activity` (no real id) gets no `subagent` event. claude is unchanged: it keeps its
    SDK-based events and gets no synthesized ones. New golden fixture `subagent-synth.ndjson`.
  - rev 23 (2026-09-29): **truthful native sandbox, and `--sandbox`** (issue #396) — new
    capability `agent-exec-sandbox`. The default does not change: without the new flag every
    runtime starts exactly as in rev 22, and a non-org turn still runs most vendor CLIs without
    their own sandbox (codex `danger-full-access`, grok profile `off`) and with approvals off
    (copilot `--allow-all-tools`, qwen `--yolo`, antigravity `--dangerously-skip-permissions`, …).
    What changes is that this is now reported: `start` gains `native_sandbox` and `approvals`
    (§3.2), and each `agent scan --json` entry gains the default `native_sandbox`/`approvals` plus
    `sandbox_modes` (§6). `access` keeps its meaning (the monomind-side tool mode); for a vendor
    CLI, `scoped` never meant its own tools were restricted — read `native_sandbox`/`approvals`
    for that. New flag `--sandbox read-only|workspace-write|full` (§3.1) picks the CLI's own
    sandbox where one exists: codex `--sandbox read-only|workspace-write` (network on), grok
    profiles `read-only|workspace`, dsh `DSH_PERMISSION_MODE`. `full` is accepted by every
    runtime and means today's default (no native sandbox added; dsh stays `workspace-write`).
    Any other mode on a runtime whose `sandbox_modes` lacks it is `error {code:"unsupported",
    fatal:true}`, exit 2, before the turn starts. Interaction: an org role's git level below
    `push` (`MONOMIND_GIT_LEVEL` in `--env` or in monomind's own environment) keeps codex/grok at
    `workspace-write` and the flag can only tighten that, never loosen it; `--access read` always
    runs codex `read-only` whatever `--sandbox` says, and `--access read --sandbox full` is a
    usage error (exit 2); `--access full --sandbox read-only|workspace-write` gives full access
    to the native tools inside that sandbox (codex drops `--dangerously-bypass-approvals-and-
    sandbox` for `--sandbox <mode>`, grok keeps `--always-approve` and adds the profile, dsh uses
    the mode instead of `danger-full-access`). Additive only.
  - rev 22 (2026-09-29): **caller tools with full access** (issue #389) — new capability
    `agent-exec-full-access-tools`. `--access full --tools stdio --tools-file …` is supported and
    tested on every runtime whose `agent scan --json` entry has `caller_tools_with_full_access:
    true` (today: every `full_access: true` runtime). Caller tools sit next to the native tools
    (claude: the in-process `org` MCP server; the other runtimes: the fence protocol) and use the
    same `tool_call`/`tool_result` frames and `--tool-timeout` as scoped mode (§3.1, §4.3). A
    runtime that cannot take caller tools in the requested mode answers `error
    {code:"unsupported", fatal:true}` instead of running without them. **Parallel calls**: the
    calls of one assistant message are all sent as `tool_call` frames before monomind waits for
    any result, and results may come back in any order (§4.3). claude marks caller tools
    `readOnlyHint`, which is what makes Claude Code run MCP calls concurrently; fence runtimes
    start a round's calls together. Scan entries gain `caller_tools` and
    `caller_tools_with_full_access` (§6). `--allow-bash-prefix` is still a usage error with
    `--access full`. Additive only.
  - rev 21 (2026-09-29): **read access** (issue #388) — new capability `agent-exec-access-read`
    and `--access read` (§3.1): a turn that can read the project and the web but not edit files,
    run arbitrary commands or start subagents. Allowed: native read tools (`Read`, `Grep`,
    `Glob`, `LS`), `WebSearch`, `WebFetch`, `TodoWrite`, `Skill`, `ToolSearch` and caller
    (stdio) tools. Shell: only commands starting with an allowlisted prefix — `git
    status|diff|log|show|blame`, `ls`, `cat`, `head`, `tail`, `wc`, `rg`, `grep`, `find`
    (plus any `--allow-bash-prefix` entries) — as one literal invocation (no pipes, redirects,
    `;`, `&&`, `||`, backticks, `$(...)` or subshells), with no argument that makes the command
    run or write something (`find -exec|-execdir|-ok|-okdir|-delete|-fprint*|-fls`, `rg --pre`,
    `git --output|--ext-diff`). Denied: `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, general
    `Bash`, `Task`/`Agent`, and MCP tools loaded from the user's settings. `--settings` works
    with it. claude enforces it itself (the `canUseTool` gate and the PreToolUse hook; a denied
    call's `tool_activity` end has `denied:true`); codex runs `codex exec --sandbox read-only`
    (whatever the role's git level; never `danger-full-access`) and pi/pi-rpc run `--tools
    read,grep,find,ls` — both the CLI's own read-only mode, so their shell rules are the CLI's
    (codex: read-only filesystem, no network; pi: no shell tool). Every other runtime answers
    `error {code:"unsupported", fatal:true}` (§3.4), opencode included: its permission config
    cannot express deny-by-default (built-in keys are decoded ahead of `"*"` and rules are
    last-match-wins). `agent scan --json` entries gain `access_modes` (§6). `read` has no audit
    line, no process-group spawn and no `background_pids` (those stay full-only). Additive only.
  - rev 20 (2026-09-29): **coder mode, wave 2** — three new runtime ids and pi parity. The
    runtimes need no new capability: a caller discovers them through `agent scan --json` (§6),
    whose entry set grows.
    - `cline` (Cline CLI; `--json` for a fresh session, ACP `session/load` for resume; kills the
      hub daemon a turn starts; `init_target: "cline"`). Scoped cline allows file edits
      inside the project (`--cwd`, not `.git`) and refuses every other tool call that needs
      approval (commands, edits outside the project, subagents, MCP tools), and never waits for
      an answer: the refused call's `tool_activity` ends `ok:false,
      denied:true` and the turn continues.
    - `aider` (Aider through a Python shim run with aider's own interpreter, plain-CLI fallback
      when aider cannot be imported; `init_target: "aider"`; no MCP).
    - `dsh` (DeepSeek Harness developer preview, `dsh --profile headless --json`; free models
      via `--model <route>/<model>` on its pi-ai adapter: OpenRouter `:free` models with
      `OPENROUTER_API_KEY`, NVIDIA's catalog with `NVIDIA_API_KEY`; OpenCode Zen's free tier
      refuses non-OpenCode clients; `reports_cost: false`).
    All three report `full_access: true`, `tool_activity_fidelity: "full"`, `resume`, `effort`
    and `max_turns` (emulated where the CLI has no cap: counted steps, then a kill or abort,
    overshooting by at most one step). `pi` now streams (`streams_incrementally: true`), enforces
    `max_turns`, and resumes by a runner-chosen `--session-id`; `pi-rpc` gains full access,
    tool events, resume, effort, `max_turns` and cost. `--effort` maps to pi/pi-rpc and cline
    `--thinking`, aider's reasoning effort / thinking tokens, and dsh's generated profile patch
    (clamped to the levels the model supports). `monomind init --target` accepts `cline`
    (`.clinerules/monomind.md`; MCP is user-scope in cline, so init names `cline mcp install
    monomind --yes -- npx -y monomind@latest mcp start` instead of editing `~/.cline`) and `aider`
    (`CONVENTIONS.md` plus `read: [CONVENTIONS.md]` merged into `.aider.conf.yml`) and `agents`
    (`AGENTS.md` only — no Claude files, no `.monomind/` state; an existing `AGENTS.md` is kept);
    none of the three is part of `--target all`. `init_target: "agents"` for the runtimes that
    read `AGENTS.md` natively: pi, pi-rpc, dsh, grok, copilot, qwen, qwen-rpc and crush.
    `agent models --runtime dsh` (§12) returns dsh's curated list with `curated: true`.
    **Rate limits** (capability `agent-exec-rate-limit-retry`): a transient provider rate limit
    (HTTP 429, "too many requests", a per-minute cap) is no longer `quota`: `agent exec` retries
    the turn, 3 attempts in all, after ~2s then ~4s (±20% jitter) or the provider's Retry-After
    hint (each wait capped at 30s, all of them inside `--timeout`), emitting `status
    {phase:"notice", message:"Rate limited (429) by <model or runtime>; retrying in Ns (attempt
    2/3)"}` before each retry; the failed attempt's `error`/`done` are not emitted, so the turn
    still has one `start` and one `done`. A retry starts over only when the failed attempts ran
    no tool; after a tool ran it resumes the bound session with a short "continue where you left
    off" prompt on a runtime with `resume`, and otherwise does not retry. A runtime whose CLI
    already retried the 429 itself (pi's auto-retry, aider's backoff, codex's retry limit) is not
    retried again. Giving up ends the turn with `error {code:"rate-limited", fatal:true}` —
    "Rate limited by <x> (429) after 3 attempts. Free models are rate-limited; try again later
    or pick another model." — and exit 1. Exhausted quota, credits, billing or a daily cap stays
    `quota` and is never retried. `agent test --json` (§13) reports `status: "rate_limited"`.
    Additive only.
  - rev 19 (2026-09-29): **coder mode on every runtime** — new capability
    `agent-exec-full-access-any`. `--access full` is accepted for every runtime whose
    `agent scan --json` entry has `full_access: true` — claude, codex, opencode, antigravity,
    kimicode, grok, qwen, copilot, crush, pi (not vercel, hermes, qwen-rpc, pi-rpc); the same
    guards (root refusal, explicit existing `--cwd`) apply to all of them. Every full-access
    runner spawns its CLI as a process-group leader (`orgrt/process-group-spawn.ts`), so
    `cancel`/`--timeout`/`--budget-usd` kill the whole tree and `done.background_pids` and the
    audit line cover every runtime. `--settings` on a non-claude runtime stops isolating the
    CLI's own config (the source list is all-or-nothing there) and emits `status
    {phase:"notice", message}` naming what the CLI loads. `--effort` (rev 16, §3.1) now also
    maps onto opencode (model variant), antigravity (`--effort`), grok and copilot
    (`--reasoning-effort`) and pi (`--thinking`); a runtime whose scan entry has
    `effort: false` ignores it with a `status` notice. `agent scan --json` entries gain
    `resume`, `effort`, `max_turns`, `reports_cost`, `init_target` (§6);
    codex, opencode, antigravity, kimicode, grok, qwen, copilot and pi report
    `tool_activity_fidelity: "full"`; crush (plain-text output, no tool events) reports `"none"`.
    `tool_activity` starts gain `kind` and ends gain `exit_code` (§3.2). Additive only.
  - rev 18 (2026-09-29): **per-model test results** (issue #390) — new capability
    `agent-test-json`: `monomind agent test <id> [--model M] [--timeout 60s] --json` (§13) sends
    one "Reply with the single word: ok" turn and prints one result object with a `status`
    (`ok`, `ok_unexpected`, `auth`, `quota`, `model_unavailable`, `timeout`, `missing_binary`,
    `error`), latency, tokens and cost. `model_unavailable` classifies the runtimes'
    "unknown model / not available on your plan" errors, which `agent exec` reports as
    `runner-error`. Without `--json`, `agent test` is unchanged (the NDJSON event stream, §6).
  - rev 17 (2026-09-29): **subagent lifecycle events** (issue #387) — new capability
    `agent-exec-subagent-events` and new `subagent` event (§3.2.1), claude runtime only: a native
    `Task`/`Agent` subagent reports `started → progress* → finished`, joined to the call's
    `tool_activity` id by `tool_use_id`. A subagent's own text is now an `assistant` event with
    `parent_tool_use_id` and is no longer part of `result.text`; before this revision it was
    emitted as main-agent text and joined into `result.text`. New golden fixture
    `subagent.ndjson`. Other runtimes are unchanged.
  - rev 16 (2026-09-29): **reasoning effort** — new capability `agent-exec-effort` and flag
    `--effort off|low|medium|high|xhigh|max` (§3.1). claude maps it onto the Agent SDK's `effort`
    option (`off` disables thinking); codex gets `-c model_reasoning_effort=<level>` (`off` →
    `none`). Other runtimes ignore it. An unknown level is rejected before the turn starts. Additive only.
  - rev 15 (2026-09-29): **per-profile web captures** — new capability
    `knowledge-profile-captures`. A capture envelope whose `meta.json` names a `profile` ingests
    into `profile:<id>` even when its URL has a query string (earlier builds failed every chunk
    with `all chunk stores failed`); the other documents in an envelope (`transcript.md`,
    `summary.md`) are indexed as their own documents and no longer supersede `readable.md`; and
    `doc search`, `doc cite`, `doc related`, `doc lookup` and `doc list` with
    `--scope profile:<id>` all read that profile's store. The behaviour shipped in 2.18.3,
    which does not advertise the capability yet; callers that ingest more than `readable.md`
    from an envelope check for version >= 2.18.3 or this capability. Additive only.
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
| Runtime/model smoke test | `monomind agent test <id> [--model M] --json` (§13) |

`agent exec`, `agent scan`, and `agent test` join the **existing** `monomind agent` namespace
(swarm lifecycle: `spawn/list/status/stop/metrics/pool/health`). The name `agent list` is taken
by swarm management and is NOT reused by this protocol — the installed-only view is
`agent scan --installed` (§6).

## 2. Capability handshake

```
$ monomind --version --json
{"v":1,"version":"<x.y.z>","min_caller":"1.0.0","capabilities":["agent-exec","agent-exec-full-access","agent-exec-settings","agent-exec-tool-activity","agent-exec-background-pids","agent-exec-full-access-any","agent-exec-effort","agent-scan","agent-scan-read-only","agent-models","agent-test-json","org-json-v1","org-tool-providers","org-decision-attribution","org-endpoint-roles","org-federation","org-idle-deadline","org-role-full-access","doctor-json","doctor-read-only","doctor-offline","init-json","knowledge-profile-captures","agent-exec-subagent-events","agent-exec-rate-limit-retry","agent-exec-access-read","agent-exec-full-access-tools","agent-exec-sandbox","agent-test-sandbox","agent-exec-sandbox-restricted","agent-exec-sandbox-fallback","agent-exec-cost-null","agent-models-alias-of","org-sign-check","org-sign-expect-hash","org-sign-review-json"]}
```

Callers MUST handshake before use and fail with an actionable message (install/upgrade hint)
when a required capability is absent. `min_caller` is advisory. New capabilities are additive;
removals or semantic changes bump the capability string (e.g. `org-json-v2`) or frame `v`. A field
that becomes nullable is a semantic change: it is announced by a new capability string, so a
caller that sums or compares the field checks for it first — e.g. `agent-exec-cost-null` (rev 28):
`cost_usd` may be `null` (unknown) on `agent exec`, `agent test` and the org surfaces.

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
| `--tool-timeout <dur>` | | Max wait for a caller `tool_result` frame (default `120s`), per call, in every access mode (rev 22: `--access full` included). monomind sets no upper limit; the effective maximum is the turn's `--timeout` (none by default). On claude, Claude Code's own MCP call timeout also applies (`MCP_TOOL_TIMEOUT`, settable with `--env`); a 130s call under `--tool-timeout 180s --access full` was verified end to end on Claude Code 2.1.226. Fence runtimes run the call between model rounds, so the vendor CLI does not time it out. On expiry the call gets `ERROR: tool timeout` and the turn continues (§4.3) |
| `--model <id>` | | Model override |
| `--effort <level>` | | rev 16, capability `agent-exec-effort`. Reasoning effort: `off`, `low`, `medium`, `high`, `xhigh` or `max`. claude: the Agent SDK's `effort` option (`off` → thinking disabled). codex: `-c model_reasoning_effort=<level>` (`off` → `none`). Any other value is rejected before the turn starts (usage error, exit 2, no events). **rev 19**: opencode → the model's matching variant; antigravity → `--effort`; grok, copilot → `--reasoning-effort`; pi, pi-rpc → `--thinking`. **rev 20**: cline → `--thinking` (fresh turns only; a resumed ACP turn runs without thinking), aider → the model's reasoning effort or thinking tokens (a `status` notice when the model has neither), dsh → its generated profile patch (each runner clamps levels its CLI lacks). A runtime whose scan entry has `effort: false` ignores it and emits `status {phase:"notice"}` saying so (rev 19) |
| `--cwd <path>` | | Working dir for the agent (default: cwd) |
| `--resume <sessionId>` | | Resume a prior session/thread/conversation |
| `--max-turns <n>` | | Cap agent turns (default `25`; the orgrt default is effectively unlimited and is NOT inherited here) |
| `--timeout <dur>` | | Overall wall-clock timeout for the whole exec (default: none). On expiry monomind SIGTERMs the agent child, emits `error {code:"timeout"}` + `done`, exits `124` |
| `--env KEY=V` | | Extra env for the agent process (repeatable) |
| `--protocol <v>` | | Protocol version pin (`1`); reserved for the v2 transition window (§5) |
| `--access <mode>` | | rev 12. `scoped` (default), `read` (rev 21) or `full`. `full` gives the turn unrestricted native tool access. claude: `canUseTool` allows everything (still observed via `coverEveryToolCall`), and `permissionMode: "bypassPermissions"` + the SDK's required `allowDangerouslySkipPermissions: true` opt-in are set. **rev 19**: any runtime with `full_access: true` in `agent scan --json` (§6) — the runner runs its CLI's own no-approval, no-sandbox mode (codex `--dangerously-bypass-approvals-and-sandbox`, opencode permission `allow`, the others' yolo flags) in its own process group. Rejects `--allow-bash-prefix` (usage error, exit 2). Requires an explicit, existing, directory `--cwd` and refuses root (uid 0) — both `error {code:"unsafe", fatal:true}` (§3.4). A runtime without full-access support (see `agent scan --json`'s `full_access`, §6) yields `error {code:"unsupported", fatal:true}`. **rev 21**, capability `agent-exec-access-read`: `read` = read files, search, web, `TodoWrite`, caller tools and an allowlist of read-only shell commands; no edits, general shell or subagents (the full rules are in the rev 21 history entry). `--allow-bash-prefix` adds prefixes to the read-only list under the same rules; `--settings` works with it; no `--cwd` requirement. Only runtimes whose `access_modes` (§6) lists `read` accept it (claude, codex, pi, pi-rpc); the others yield `error {code:"unsupported", fatal:true}` |
| `--sandbox <mode>` | | rev 23, capability `agent-exec-sandbox`. The vendor CLI's own sandbox: `read-only`, `workspace-write` or `full`. Without it nothing changes (the rev 22 default). `full` = today's default on every runtime (no native sandbox added; it never loosens a runtime whose default is tighter, e.g. dsh). `read-only`/`workspace-write` only where `agent scan --json`'s `sandbox_modes` lists them: codex (`--sandbox read-only`; `--sandbox workspace-write -c sandbox_workspace_write.network_access=true`), grok (`--sandbox read-only`; `--sandbox workspace`), dsh (`DSH_PERMISSION_MODE`); elsewhere `error {code:"unsupported", fatal:true}`, exit 2. An org role's git level below `push` (`MONOMIND_GIT_LEVEL`, from `--env` or monomind's own environment) caps codex/grok at `workspace-write`: the flag may tighten but never loosen it. `--access read` always runs codex `read-only`; `--access read --sandbox full` is a usage error (exit 2). With `--access full`, `read-only`/`workspace-write` keep the native tools fully approved but inside that sandbox. The mode the CLI really got is `start.native_sandbox` (§3.2) **rev 26**, capability `agent-exec-sandbox-restricted`: also `restricted` — the CLI's own approval rules, every call they would ask about refused (a rule set, not a file-system boundary; strictness: `read-only` > `restricted` > `workspace-write` > `full`). New per runtime: copilot `restricted` (no `--allow-all-tools`), `read-only` (`--deny-tool=write --deny-tool=shell`) and `workspace-write` (`--allow-tool=write --deny-tool=shell`, no `--allow-all-paths`: edits under the cwd, `--add-dir` and the temp dir only, no shell); antigravity `restricted` (no `--dangerously-skip-permissions`); opencode `restricted` (edit/bash/task/external_directory `ask`, every ask rejected; not with an attached `OPENCODE_URL` server); pi/pi-rpc `read-only` (`--tools read,grep,find,ls`); claude `read-only`/`workspace-write` with `--access scoped\|read` only (`native_sandbox: "monomind"`: no native write tool runs, Bash only for `--allow-bash-prefix` commands). With `--access full`, copilot `read-only` is `--allow-all` plus the deny rules and `workspace-write` is `--allow-all-tools --allow-all-urls --deny-tool=shell`; `restricted` ignores `--access full`. `start.sandbox_requested`/`sandbox_applied` report what was asked for and what ran |
| `--sandbox-fallback <mode>` | | rev 26, capability `agent-exec-sandbox-fallback`. What a `--sandbox` mode the runtime lacks does: `fail` (default) — `error {code:"unsupported", fatal:true}`, exit 2, as in rev 23; `strictest` — the closest mode in the runtime's `sandbox_modes` that is at least as strict as the request, or, when every listed mode is looser, the strictest listed one; `run` — the runtime default (`full`). With `strictest`/`run` the turn runs and a `status {phase:"notice"}` right after `start` names both modes; `start.sandbox_applied` is the mode that ran. Any other value is a usage error (exit 2). Without `--sandbox` it does nothing. So a caller can send one `--sandbox` value to every runtime: `--sandbox workspace-write --sandbox-fallback strictest` runs codex, grok, dsh, copilot and claude (scoped) in `workspace-write`, antigravity and opencode in `restricted`, pi in `read-only`, and claude `--access full` and the rest at their default, each fallback with its notice |
| `--settings <sources>` | | rev 12, capability `agent-exec-settings`. Coder mode: `none` (default) or a CSV of `user,project,local`. Non-`none` on claude loads the SDK's own settings discovery — CLAUDE.md, skills, hooks, and project/user MCP servers — appends the caller's system prompt to Claude Code's own preset instead of replacing it, and merges the `org` MCP server only when `--tools stdio` gave this turn caller tools. `--settings bogus` → exit 2. See §3.2's `status` event and the `agent-exec-settings` capability note in §2. **rev 19**: on any other runtime, non-`none` means "do not isolate the CLI's own config" (its user config, project instruction files and MCP servers load as in the user's own terminal; the source subset is all-or-nothing) and a `status {phase:"notice"}` right after `start` names what that runtime loads. |
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
| `start` | `v, runtime, model?, cwd, resume?, pid, child_pid?, access, native_sandbox, approvals, sandbox_requested?, sandbox_applied?, streams_incrementally` | `pid` = the monomind process; `child_pid` = the agent-CLI subprocess when the runner spawns one (omitted for in-process runners). **rev 4**: v1 always omits `child_pid` — the `AgentRunner` interface does not surface child pids; add it if/when runners expose them. **rev 5**: `streams_incrementally` (bool) — whether this runtime delivers real incremental `assistant` text as a turn streams, vs. only ever a complete message at a step/turn boundary (see §9). **rev 12**: `access` (`"scoped"` \| `"full"`; rev 21: or `"read"`) — which mode this turn ran in (§3.1). **rev 23** (capability `agent-exec-sandbox`): what the vendor CLI really runs with this turn. `native_sandbox`: `"read-only"` / `"workspace-write"` (the CLI's own sandbox, in that mode), `"full"` (the runtime has a native sandbox and it is off, e.g. codex `danger-full-access`, grok profile `off`), `"none"` (the runtime has no native sandbox monomind drives; the CLI has the user's own file-system rights), or `"monomind"` (claude only, `scoped`/`read`: no vendor sandbox, monomind enforces the access mode itself through `canUseTool` and the PreToolUse gate; claude `--access full` is `"full"`). `approvals`: `"off"` (native tool calls run without asking), `"on"` (the CLI's own approval rules apply and a call that would ask is refused — opencode and cline in scoped mode, dsh except `danger-full-access`, hermes) or `"n/a"` (claude outside full access, where monomind decides each call; vercel, which has no native tools). `access: "scoped"` on a vendor CLI limits monomind's caller-tool wiring only — use these two fields for what the CLI itself can do **rev 26** (capabilities `agent-exec-sandbox-restricted`, `agent-exec-sandbox-fallback`): `native_sandbox` may also be `"restricted"` (the CLI's own approval rules, asks refused; copilot, antigravity, opencode — `approvals` is `"on"`), and copilot's `read-only`/`workspace-write` come from its deny/allow rules rather than an OS sandbox (`approvals: "on"`). With `--sandbox`, `sandbox_requested` is the mode asked for and `sandbox_applied` the mode the runner got (after `--sandbox-fallback` and an org role's level cap); both are omitted without `--sandbox`. claude `scoped`/`read` with `--sandbox read-only\|workspace-write` reports `"monomind"`/`"n/a"` and `sandbox_applied` the mode |
| `status` | `v, phase ("initializing"\|"ready"\|"notice"), mcp_servers? ([{name,status}]), message?` | rev 12, capability `agent-exec-settings`. Only with `--settings` non-`none` (claude runtime): `initializing` right after `start`, `ready` (with `mcp_servers`) from the SDK's own `system/init` message. **rev 19**: `phase:"notice"` with a human-readable `message`, right after `start`, on a non-claude runtime — what `--settings` makes it load (e.g. `"codex: user config (~/.codex/config.toml, incl. its MCP servers) + project AGENTS.md"`), or `"<runtime>: --effort <level> ignored …"`. A notice never has a `ready` to follow it; the startup watchdog stays claude-only. **rev 26**: a notice right after `start`, on any runtime, when `sandbox_applied` differs from `sandbox_requested` (e.g. `"antigravity: --sandbox workspace-write is not supported (agent scan --json sandbox_modes: restricted, full); --sandbox-fallback strictest; running with --sandbox restricted"`); it comes before the `--settings`/`--effort` notices. |
| `session` | `v, session_id` | Runner's session/thread/conversation id; pass back via `--resume` |
| `assistant` | `v, text` | Incremental assistant text (may be multi-line; callers append) |
| `tool_call` | `v, id, name, args` | Only with `--tools stdio` — caller must execute and reply (§4) |
| `tool_result` | `v, id, ok, result` | Echo of the applied result (post `canUseTool` gating) |
| `tool_activity` | `v, id, phase ("start"\|"end"), name, kind?, input?, parent_tool_use_id?, ok?, output?, output_truncated?, denied?, cancelled?, duration_ms?, exit_code?` | **rev 12** (#357, capability `agent-exec-tool-activity`). NATIVE tool calls only (Bash, Edit, Write, Read, …) — a bridged `--tools stdio` call keeps its `tool_call`/`tool_result` frames instead. `id` is the SDK's own tool_use id (or a locally-minted one for a start-only runtime, see below), correlating a `"start"` with its `"end"`. `"start"`: `input` is the tool's raw input as the model sent it (`Edit`/`MultiEdit` carry `old_string`/`new_string`, `Write` carries `file_path`/`content`); `parent_tool_use_id` is non-null when the call was made inside a `Task`/`Agent` subagent's own turn, for nesting. `"end"`: `ok` (bool), `output` (the tool_result content flattened to text), `duration_ms`; a call denied under scoped mode's default-deny `canUseTool` ends with `ok:false, denied:true` instead of running; a turn cut short by `--timeout` or a `cancel` frame closes every still-open id with `ok:false, cancelled:true` before `done`. Every `input`/`output` string field is capped at 16 KiB with a sibling `<field>_truncated:true` when cut, and the whole event stays well under 64 KiB regardless of how many fields a call's own input has. **rev 19**: every `"start"` carries `kind` — `shell\|edit\|write\|read\|search\|web\|mcp\|task\|todo\|patch\|other` — from the runner when it knows it, else from the tool name (`orgrt/tool-kind.ts`: Claude's `Bash`→shell, `Edit`/`MultiEdit`/`NotebookEdit`→edit, `Write`→write, `Read`→read, `Glob`/`Grep`→search, `WebFetch`/`WebSearch`→web, `mcp__*`→mcp, `Task`/`Agent`→task, `TodoWrite`→todo, plus vendor names such as `exec_command`/`command_execution`→shell, `apply_patch`/`file_change`→patch, `read_file`→read, `mcp_tool_call`→mcp). `name` stays the runtime's own. Claude keeps its native `input`; other runtimes' runners translate theirs to canonical keys per kind — shell `{command, description?, cwd?}`, edit `{file_path, old_string, new_string}`, write `{file_path, content}`, read `{file_path}`, search `{pattern, path?}`, patch `{files:[{file_path, action:"add"\|"update"\|"delete", diff?}]}`, mcp `{server, tool, arguments}`, web `{url?, query?}`, other: raw. An `"end"` carries `exit_code` when the runtime reported one (shell calls). Fidelity varies by runtime (§9, `agent scan --json`'s `tool_activity_fidelity`): `"full"` (claude, codex, opencode, antigravity, kimicode, grok, qwen, copilot, pi) is a real id with a matched end; a runtime whose runner only yields a lightweight `{type:'tool_use', text: toolName}` liveness signal (no id) maps it to a `"start"`-only event with no matching `"end"` (`input: null`, `parent_tool_use_id: null`); a runtime with no tool signal at all emits none |
| `usage` | `v, input_tokens, output_tokens, cost_usd` | Per-round delta (cumulative→delta conversion handled inside monomind). **rev 28** (capability `agent-exec-cost-null`): `cost_usd` is `null` when the runtime reported no cost for the round — unknown, not `$0` |
| `result` | `v, subtype ("success"\|"error"), is_error, text, stop_reason, input_tokens, output_tokens, cost_usd` | Aggregate final result; **rev 28**: `cost_usd` is the sum of the rounds' reported costs, or `null` when no round reported one (see `reports_cost`, §6); **rev 7**: `text` is the complete final assistant text — the joined `assistant` texts for a `streams_incrementally` runtime, the last `assistant` message otherwise (omitted only if the turn produced none); `stop_reason`: `end_turn` \| `max_turns` \| `tool_round_cap` \| `cancelled` \| `timeout`. **rev 4**: `tool_round_cap` is detected best-effort — it matches the runner's tool-round-cap assistant note; a fence runner that stops without the note yields `end_turn` |
| `error` | `v, code, message, fatal (bool)` | Codes in §3.4. `fatal:true` = auth/quota class — callers must not retry |
| `done` | `v, exit_code, background_pids?` | Terminal event. Always emitted exactly once, even on error. **rev 13**, capability `agent-exec-background-pids`: `background_pids` (only for `--access full`, only after a NORMAL `end_turn` — never on `cancel`/`--timeout`/`--budget-usd`, which already kill the whole tree, §3) lists pids the turn's process-tree tracker (`orgrt/process-tree.ts`'s `trackDescendants`: the inherited `MONOMIND_EXEC_TREE` env marker plus continuous sampling) found still alive at that moment. A process whose `MONOMIND_EXEC_TREE` holds any other value (empty included) has left the turn's tree and is neither listed nor killed on `cancel`/`--timeout`/`--budget-usd` — monomind's own session-hook daemons (the dashboard, the helper self-heal, monograph refresh) set it empty, so they are never reported (#366) — e.g. a `sleep 600 &` the turn started and left running on purpose, including one reparented after its launching shell exited. A survivor that cleared its own environment and whose launching chain exited between samples can go unreported (residual v1 limitation, §3's rev 13 note). Omitted (not an empty array) when access is `scoped`, or on a platform where discovery isn't supported (win32, v1). **rev 19**: every full-access runtime, not only claude (§3.1) |

Exit codes: `0` success (result.subtype=success) · `1` agent/runner error · `2` usage/protocol
error (bad flags, unknown runtime, missing binary) · `124` `--timeout` expired · `130` cancelled
(SIGINT/SIGTERM, or caller `cancel` frame).

Malformed caller input (§4): monomind emits `error {code:"bad-frame", fatal:false}` and
continues; the pending `tool_call` is failed with `ERROR: bad tool_result frame` fed back to the
agent.

### 3.2.1 `subagent` events (capability `agent-exec-subagent-events`, rev 17; every runtime since rev 24)

**claude** (rev 17): when the agent delegates to a native subagent (the `Task`/`Agent` tool),
monomind forwards the Agent SDK's task lifecycle as `subagent` events:

| Field | Phases | Meaning |
|---|---|---|
| `phase` | all | `"started"`, `"progress"` (zero or more), then `"finished"` |
| `id` | all | The subagent's task id; the same across its phases |
| `tool_use_id` | all | The id of the `Task`/`Agent` call that started it — equal to that call's `tool_activity` id, so a caller can join the two |
| `subagent_type`, `description`, `prompt` | started | As the model passed them to the tool (each omitted when absent) |
| `summary` | progress, finished | Latest progress summary; on `finished`, the result summary |
| `last_tool` | progress | Name of the subagent's most recent tool call |
| `status` | finished | `"completed"` \| `"failed"` \| `"stopped"` |
| `usage` | progress, finished | `{total_tokens, tool_uses, duration_ms}`, cumulative for that subagent, as the SDK reports it (no input/output split and no cost; cost stays on the turn's `usage` and `result` events) |

Order: `started` comes after the `Task`/`Agent` call's `tool_activity(start)` and before any of
the subagent's own tool calls; `finished` comes before the call's `tool_activity(end)`. A task
the SDK marks as housekeeping (`skip_transcript`) or that has no tool call to join to produces
no events.

A subagent's own text arrives as `assistant {v, text, parent_tool_use_id}`, where
`parent_tool_use_id` is the subagent's `tool_use_id`. It is sent as one complete message per
subagent model turn, not incrementally, and it is **not** part of `result.text`, which holds only
the main agent's text. Callers that do not route by `parent_tool_use_id` should drop `assistant`
events that carry it. The subagent's tool calls already carry `parent_tool_use_id` on their
`tool_activity(start)` events (rev 12). Without this capability (older monomind), a subagent's
text was emitted as main-agent `assistant` text and joined into `result.text`.

Example (`doc/agent-exec-protocol/fixtures/subagent.ndjson`, abridged):

```
{"v":1,"type":"tool_activity","id":"toolu_task","phase":"start","name":"Task","input":{"subagent_type":"Explore","description":"Find config loader","prompt":"…"},"parent_tool_use_id":null}
{"v":1,"type":"subagent","phase":"started","id":"task_1","tool_use_id":"toolu_task","subagent_type":"Explore","description":"Find config loader","prompt":"…"}
{"v":1,"type":"assistant","text":"Searching for loadConfig.","parent_tool_use_id":"toolu_task"}
{"v":1,"type":"subagent","phase":"progress","id":"task_1","tool_use_id":"toolu_task","summary":"Found loadConfig in src/config.ts","last_tool":"Grep","usage":{"total_tokens":4210,"tool_uses":1,"duration_ms":2310}}
{"v":1,"type":"subagent","phase":"finished","id":"task_1","tool_use_id":"toolu_task","status":"completed","summary":"Config is loaded by loadConfig() in src/config.ts.","usage":{"total_tokens":5120,"tool_uses":1,"duration_ms":3050}}
{"v":1,"type":"tool_activity","id":"toolu_task","phase":"end","name":"Task","ok":true,"output":"…","output_truncated":false,"duration_ms":3120}
```

**Other runtimes** (rev 24): the runtime reports no subagent lifecycle, so monomind synthesizes
`subagent` events from a task-kind tool call, at lower fidelity:

- `started` comes right after a `tool_activity(start)` with `kind:"task"`, and `finished` right
  after that call's `tool_activity(end)`. `id` and `tool_use_id` are both the call's
  `tool_activity` id (there is no separate task id).
- `started` carries `subagent_type`, `description` and `prompt` only when the tool input has
  them: `subagent_type`, `description` and `prompt` keys as-is (opencode's `task`, dsh's
  `subagent`), or a `task` key as `prompt` (cline's `spawn_agent`/`team_*`).
- `finished.status` is `"completed"` when the call ended `ok`, `"failed"` when it errored,
  `"denied"` when it was refused (`denied:true`), and `"stopped"` when a cancel or timeout closed
  it. `summary` is the call's output cut to 500 characters, omitted when empty.
- There is no `progress` phase and no `usage` or `last_tool`, and nothing ties the subagent's
  own tool calls or text to it: vendor runners send `parent_tool_use_id: null`.
- Only calls with a real id qualify: a start-only `tool_activity` (§3.2) gets no `subagent`
  event, since no end could close it.

Runtimes whose runner marks a call `kind:"task"`: opencode (`task`), cline (`spawn_agent`,
`team_*`) and dsh (`subagent`, `subagent_fork`). Any other runtime's call gets `task` from the
shared name table (`orgrt/tool-kind.ts`) when named `Task`, `Agent`, `spawn_subagent`,
`invoke_subagent`, `browser_subagent`, `spawn_agent` or `subagent`. claude never gets
synthesized events, so it never reports a subagent twice.

Example (`doc/agent-exec-protocol/fixtures/subagent-synth.ndjson`, abridged):

```
{"v":1,"type":"tool_activity","id":"call_task","phase":"start","name":"task","kind":"task","input":{"description":"Find config loader","prompt":"Find where the app loads its config file.","subagent_type":"explore"},"parent_tool_use_id":null}
{"v":1,"type":"subagent","phase":"started","id":"call_task","tool_use_id":"call_task","subagent_type":"explore","description":"Find config loader","prompt":"Find where the app loads its config file."}
{"v":1,"type":"tool_activity","id":"call_task","phase":"end","name":"task","ok":true,"output":"Config is loaded by loadConfig() in src/config.ts.","output_truncated":false}
{"v":1,"type":"subagent","phase":"finished","id":"call_task","tool_use_id":"call_task","status":"completed","summary":"Config is loaded by loadConfig() in src/config.ts."}
```

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
| `auth` | true | Runtime not logged in / key missing or invalid (rev 27: "missing API key", "no API key found", hermes "no inference provider configured") — surface the runtime's login command; do not retry |
| `quota` | true | Quota, credits, billing or a daily cap exhausted — do not retry. Before rev 20 this also covered transient rate limits |
| `rate-limited` | true | rev 20. A transient provider rate limit (429) that `agent exec` already retried (up to 3 attempts, rev 20 entry) or could not retry safely; the message says which. Try again later or pick another model |
| `missing-binary` | true | Agent CLI not installed (exit 2; see `agent scan`) |
| `no-runner` | true | rev 3. `--runtime <id>` did not resolve to a concrete `AgentRunner` (distinct from `missing-binary`: the id itself has no runner implementation, vs. a known runner's binary being absent) |
| `budget` | true | rev 3. `--budget-usd` cap exceeded mid-turn — do not retry without raising the cap |
| `runner-error` | false | Runner/turn failure; retry is caller's choice |
| `timeout` | false | `--timeout` or `--tool-timeout` fired |
| `cancelled` | false | Caller cancel frame or signal |
| `bad-frame` | false | Malformed caller stdin frame; turn continues |
| `unsafe` | true | rev 12. `--access full` refused: root (uid 0), or a missing/nonexistent/non-directory `--cwd` |
| `unsupported` | true | rev 12. `--access full` requested on a runtime whose `RunnerSpec.supportsFullAccess` is false (see `agent scan --json`'s `full_access`, §6). rev 21: `--access read` on a runtime whose `access_modes` lacks `read`. rev 22: caller tools on a runtime whose `caller_tools` (or, with `--access full`, `caller_tools_with_full_access`) is false. rev 23: `--sandbox read-only\|workspace-write` on a runtime whose `sandbox_modes` lacks it. rev 26: also `restricted`, and claude `read-only\|workspace-write` with `--access full`; only under `--sandbox-fallback fail` (the default) |

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
- **Parallel calls (rev 22)**: when one assistant message makes several caller tool calls,
  monomind emits every one of their `tool_call` frames before it waits for any `tool_result`, so a
  caller can run them concurrently. Guarantees: sending the other calls of a message never waits on
  the caller's answer to one of them (a caller that holds its answers sees all of that message's
  `tool_call` frames first; one that answers at once may see an echo interleaved); fence runtimes
  emit the frames in the order the model wrote them, on claude the order is Claude Code's dispatch
  order — match by `id`, never by position; the caller may answer in any order, and each `tool_result` is
  matched to its call by `id` alone; monomind echoes each `tool_result` frame when that call
  settles (so echoes follow the caller's answer order, not the call order); the model gets each
  result attached to the call it answers. Each call has its own `--tool-timeout`. Calls in
  different assistant messages stay sequential (the next message comes after the model has seen
  the previous results). claude: Claude Code runs the MCP calls of one message concurrently
  because caller tools are marked `readOnlyHint` (read-only native tools in the same message may
  run alongside them; a native call Claude Code does not treat as concurrency-safe, such as `Edit`,
  runs on its own and splits the batch); fence runtimes start every call of a round together. A round
  that mixes caller tools with other fence tools runs in order (only relevant to org roles).
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
  {"id":"claude","installed":true,"binary":"/usr/local/bin/claude","version":"1.0.58","install_hint":"","streams_incrementally":true,"full_access":true,
   "access_modes":["scoped","read","full"],"caller_tools":true,"caller_tools_with_full_access":true,
   "native_sandbox":"monomind","approvals":"n/a","sandbox_modes":["read-only","workspace-write","full"],
   "sandbox_mode_reports":{"read-only":{"native_sandbox":"monomind","approvals":"n/a"},"workspace-write":{"native_sandbox":"monomind","approvals":"n/a"},"full":{"native_sandbox":"monomind","approvals":"n/a"}},
   "tool_activity_fidelity":"full","resume":true,"effort":true,"max_turns":true,"reports_cost":true,"init_target":"claude"},
  {"id":"codex","installed":false,"binary":null,"version":null,
   "install_hint":"npm install -g @openai/codex && codex login","streams_incrementally":false,"full_access":true,
   "access_modes":["scoped","read","full"],"caller_tools":true,"caller_tools_with_full_access":true,
   "native_sandbox":"full","approvals":"off","sandbox_modes":["read-only","workspace-write","full"],
   "sandbox_mode_reports":{"read-only":{"native_sandbox":"read-only","approvals":"off"},"workspace-write":{"native_sandbox":"workspace-write","approvals":"off"},"full":{"native_sandbox":"full","approvals":"off"}},
   "tool_activity_fidelity":"full","resume":true,"effort":true,"max_turns":false,"reports_cost":false,"init_target":"codex"},
  …
]}
```

One entry per known runner (set grows with monomind releases). Honors `<NAME>_CLI_BIN`
overrides. Binary probes run in parallel with a 5s per-binary timeout so a hung `--version`
probe cannot stall the scan. Exit 0 always (detection, not a test). **rev 5**: `streams_incrementally`
is static per-runtime metadata (`RunnerSpec.streamsIncrementally`, §9) — unlike `installed`/`version`,
it never depends on probing the binary, so it's always present even when `installed:false`. **rev 12**: `full_access` is likewise static per-runtime metadata (`RunnerSpec.supportsFullAccess`) — whether `agent exec --access full` (§3.1) is implemented for this runtime (**rev 19**: every coding runtime; `false` for vercel, hermes, qwen-rpc, pi-rpc; **rev 20**:
pi-rpc, cline, aider and dsh are `true`). **rev 12**
(#357): `tool_activity_fidelity` (`"full"|"start-only"|"none"`) is the same kind of static metadata
(`RunnerSpec.toolActivityFidelity`) for the §3.2 `tool_activity` event — see §9. **rev 19**:
five more static fields (`orgrt/runner-features.ts`), each saying what monomind's runner does
today, not what the vendor CLI could do: `resume` (honors `--resume` and reports a session id to
pass back), `effort` (maps `--effort`), `max_turns` (enforces `--max-turns` on the runtime's own
loop), `reports_cost` (`result.cost_usd` is a real figure — a runtime without it reports
`cost_usd: null` since rev 28 and never trips `--budget-usd`), and `init_target` (the `monomind init --target` value that writes this
runtime's setup files: `claude`, `codex`, `opencode`, `kimicode`, `antigravity`, and since
rev 20 `cline`, `aider`, and `agents` (AGENTS.md only) for pi, pi-rpc, dsh, grok, copilot,
qwen, qwen-rpc and crush; `null` for vercel and hermes). **rev 20**:
entries for `cline`, `aider` and `dsh`; `full_access` is `true` for every runtime except vercel,
hermes and qwen-rpc. **rev 21** (capability `agent-exec-access-read`): `access_modes` lists the
`--access` values (§3.1) the runtime accepts, always starting with `"scoped"`; `"read"` only where
a read-only mode is enforced by monomind or the CLI itself (`claude`, `codex`, `pi`, `pi-rpc` —
`orgrt/runner-access.ts`), `"full"` exactly when `full_access` is `true`.
**rev 22** (capability `agent-exec-full-access-tools`): `caller_tools` — `--tools stdio` caller
tools (§4) reach the model on this runtime (every runtime today); `caller_tools_with_full_access`
— they also do with `--access full` (`caller_tools && full_access`). When it is `false`,
`--access full` with caller tools is `error {code:"unsupported", fatal:true}`, never a turn
without them.
**rev 23** (capability `agent-exec-sandbox`): `native_sandbox` and `approvals` — the values a
default turn's `start` event reports (scoped access, no `--sandbox`, no org git level; §3.2 has
the vocabulary) — and `sandbox_modes`, the `--sandbox` values the runtime accepts, always
including `"full"`. `read-only`/`workspace-write` only where the vendor CLI has that mode and it
was checked (`orgrt/runner-sandbox.ts`): codex and grok (`--help` of the installed CLI; codex's
modes exercised with `codex sandbox`, grok's profiles resolve and start its bwrap/Landlock
sandbox) and dsh (its `DSH_PERMISSION_MODE`). Defaults: claude `monomind`/`n/a`; codex and grok
`full`/`off`; dsh `workspace-write`/`on`; opencode, cline, hermes `none`/`on`; vercel
`none`/`n/a`; antigravity, kimicode, qwen, qwen-rpc, crush, copilot, pi, pi-rpc, aider
`none`/`off`. Not listed as sandboxed on purpose: antigravity's `--sandbox` is an unspecified
boolean "terminal restrictions" switch, qwen's is a container sandbox this build has not
verified, and the others have no file-system sandbox flag.
**rev 26** (capabilities `agent-exec-sandbox-restricted`, `agent-exec-sandbox-fallback`):
`sandbox_modes` gains `restricted` for copilot, antigravity and opencode, `read-only` and
`workspace-write` for copilot and claude (claude's are for `--access scoped|read` only), and
`read-only` for pi and pi-rpc — each checked against the installed CLI and a live turn that
tried a file write and a shell command (§3.1 has the flags). `sandbox_mode_reports` maps every
listed mode to the `native_sandbox`/`approvals` a scoped turn in that mode reports (`full` is the
default report). Still `full` only: qwen, qwen-rpc, kimicode, cline and aider (not verified: no
installed CLI to check), crush, hermes, vercel, and claude with `--access full` (monomind does
not wire the Agent SDK's own sandbox into `agent exec`: it covers Bash only, while Write/Edit run
in-process, so it would not confine writes to the cwd by itself). antigravity's `--sandbox`
switch still is not used: it failed to start here and the model retried with the sandbox
bypassed.

`agent scan --installed --json` = installed-only view (the name `agent list` is reserved by the
pre-existing swarm command, §1). `agent test <id>` = one smoke turn via `agent exec`
and emits the same NDJSON event stream (with `--json`, rev 18: one result object instead — see
§13); success = a `result` event with
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

**Org signing** (capabilities `org-sign-check`, `org-sign-expect-hash`, `org-sign-review-json`,
rev 29): `org sign <org>|--all --check [--format json] [--project <dir>]` reports each org's
signature state without prompting, signing or writing (exit 0 all signed, 1 otherwise, 2 not
found or usage error); `org sign --expect-hash <hex>` signs only when the org's signable hash is
`<hex>`, else exits 1 and writes nothing; `org sign <org> --format json` without `--yes` prints
`{org, state, hash, review, reviewText}` and never signs. `org sign` exits 2 on an unknown option
and signs nothing. Shapes and exit codes: `doc/commands/org.md` (`sign`).

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
   full-access-background, subagent, subagent-synth) so callers can build contract tests without running monomind;
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
  `tool_result` for the same id (`claude`, via `ClaudeAgentRunner`'s own
  `'tool_use'`/`'tool_result'` AgentMessages; rev 19: `codex`, `opencode`, `antigravity`,
  `kimicode`, `grok`, `qwen`, `copilot`, `pi` from their CLIs' own tool start/complete events;
  rev 20: `pi-rpc`, `cline`, `aider` (through its shim), `dsh`). `orgrt/tool-activity.ts`'s `ToolActivityTracker`
  turns this into a matched start/end pair.
- `"start-only"` — the runner only yields a lightweight `{type:'tool_use', text: toolName}`
  liveness signal, with no id to correlate an end with (no runtime today). `ToolActivityTracker` maps this to a `tool_activity`
  `"start"` under a locally-minted id, with no matching `"end"` — do not invent one; a fabricated
  `ok`/`duration_ms` a caller can't verify is worse than omitting it.
- `"none"` — the runner's `AgentMessage` stream carries no tool signal a caller could act on at all,
  whether because it never yields `'tool_use'` (`vercel`, `qwen-rpc` today; `crush`
  yields only label-free liveness pings) or
  because what it yields isn't really per-call information (`hermes`'s own `'tool_use'` is a single
  fixed `"turn started"` placeholder ping per turn, not a tool name — mapping it through the
  `"start-only"` path would fabricate a misleading tool_activity event, so it is `"none"` despite
  matching the AgentMessage shape). `ToolActivityTracker` emits nothing for a `"none"` runtime.

**`full_access`** (rev 19, `RunnerSpec.supportsFullAccess`): set it only once the runner, for
`args.access === 'full'`, (a) runs its CLI's own no-approval, no-sandbox mode, (b) spawns the CLI
through `orgrt/process-group-spawn.ts`'s `spawnRunnerProcess(command, argv, spawnOptions, args)`
and drives its kill ladder through the returned `target` (`killOnAbort(args.signal,
proc.target, …)`, the turn timeout too) and calls `proc.stop()` in its `finally` — that is what
gives `cancel` a whole-tree kill and `done` its `background_pids` — and (c) yields `tool_use` with
`kind` and canonical `input` keys (§3.2) where the CLI reports tool calls. `agent-exec-no-
transitive-escalation.test.ts` pins the full-access set; widening it is a security decision
recorded in `doc/concepts/coder-mode-security.md`.

**`read` in `access_modes`** (rev 21, `RunnerSpec.readAccess`, `orgrt/runner-access.ts`): set it
only when `args.access === 'read'` turns on a read-only mode the CLI itself enforces (a sandbox or
tool allowlist checked against the installed CLI's `--help` or a real run, never prompt text), and
the runner passes it regardless of `MONOMIND_GIT_LEVEL`. The same escalation test pins this set.

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
 "skipped":[],"claude_project_registered":false,
 "platforms":{"source":"detected","selected":["claude"],"detected":[{"id":"claude","via":["claude on PATH"]}]},
 "duration_ms":842}
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
  treated as non-interactive; it never offers to install the Claude Code CLI). Every other init flag (`--minimal`/`--full`/`--target`/`--platforms`/`--all-platforms`/
  `--skip-claude`/`--only-claude`/`--pin`/`--no-memory`/…) behaves identically whether or not
  `--json` is also passed — they share one option-resolution path
  (`src/init/resolve-options.ts`).
- `--no-graph` — skip the Monograph code-graph build, the slowest step of a full init. A coder
  workspace wants to be ready in a few seconds; build the graph lazily on first real use instead
  (`monograph_build`, or a plain `monomind monograph build` later).
- `--register-claude-project` — best-effort, model-free registration; see §11.3.

### 11.2 JSON result

Success: `{root, created, skipped, claude_project_registered, platforms, duration_ms}`.

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
- `platforms` — which coding platforms this run wrote and why (#420): `source` is `detected`
  (no platform flag; installed CLIs/config dirs plus the platforms `root` already has),
  `fallback` (nothing detected, so Claude Code alone) or `explicit` (`--platforms`, `--target`,
  `--all-platforms`, …); `selected` is the platform ids written; `detected` lists each detected
  platform as `{id, via}`, where `via` names what found it (`claude on PATH`, `~/.codex`,
  `already in this project`). Empty for `explicit`.
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
   "aliases":["default","opus"],"effort_levels":["low","medium","high","xhigh","max"]},
  {"id":"sonnet","resolved_id":"claude-sonnet-5","label":"Sonnet","effort_levels":["low","medium","high"]},
  {"id":"opus","resolved_id":"claude-opus-5-5","label":"Opus","alias_of":"default",
   "effort_levels":["low","medium","high","xhigh","max"]}
]}
```

| Field | Meaning |
|---|---|
| `id` | What to pass as the runtime's model option (`agent exec --model`, a role's `model`) |
| `resolved_id` | The concrete model an alias resolves to today (claude only; omitted when equal to `id`) |
| `aliases` | rev 28, capability `agent-models-alias-of`. On the canonical (first) entry for a model: every id that resolves to it, `id` first (e.g. `["default","opus"]`); omitted when only one does |
| `alias_of` | rev 28, capability `agent-models-alias-of`. On a later entry that resolves to the same model: the canonical entry's `id` (claude `opus` → `"default"`). The entry stays in the list, so a lookup by `id` works; a caller that runs each model once (`agent test` per model) skips entries with `alias_of` |
| `label`, `description` | Display text from the runtime |
| `default` | `true` on the runtime's own default choice (claude's `default` entry) |
| `effort_levels` | Supported reasoning-effort values, when the runtime reports them |

Sources: `claude` — the Agent SDK's `query().supportedModels()`, the list Claude Code's `/model`
picker shows for the signed-in account (it varies by account and plan); `codex` —
`codex debug models`, only entries with `visibility: "list"`; `antigravity` — `agy models`;
`opencode` — `opencode models`. **rev 20**: `dsh` has no listing command either, so the result is
the runner's own curated list (`orgrt/dsh-runner-models.ts`) with `"curated": true` — DeepSeek's
own routes plus free OpenRouter/NVIDIA models, each with `effort_levels`, `free` and `key_env`
(the variable its key comes from); any other `<route>/<model>` still works as free text. Every
other runtime has no listing command:
`"supported": false, "models": []`, exit 0 — pass a model id its CLI accepts.

Errors keep the same shape with `models: []` and an `error: {code, message}`: `unknown-runtime`
(exit 2), `missing-binary` or `list-failed` (the command failed or timed out after 30s; exit 1).

## 13. `monomind agent test --json` (capability `agent-test-json`, rev 18)

`monomind agent test <id> [--model M] [--timeout 60s] [--sandbox MODE] [--sandbox-fallback F] [--env KEY=V]... --json` checks that one runtime and model
actually answer (issue #390). It runs one turn through the `agent exec` engine with the prompt
`Reply with the single word: ok`, max turns 3 (a model may run one of its CLI's own tools before it answers, #564), no caller tools, `scoped` access and a fresh
temporary cwd that is removed afterwards, then prints a single JSON object on stdout:

```json
{"v":1,"runtime":"codex","model":"gpt-5.5","status":"ok","reply":"ok",
 "latency_first_ms":812,"latency_ms":1430,"input_tokens":12,"output_tokens":1,
 "cost_usd":0.0001,"cost_estimated":false,"runtime_version":"0.52.0",
 "native_sandbox":"workspace-write","sandbox_applied":"workspace-write","error":null}
```

| Field | Meaning |
|---|---|
| `model` | The `--model` given, or `null` for the runtime's default |
| `status` | See below |
| `reply` | The turn's final text, or `null` |
| `latency_first_ms` | Time to the first `assistant` text; `null` when none arrived |
| `latency_ms` | Time for the whole turn |
| `cost_usd` | The runtime's reported cost; when it reports none, an estimate from monomind's pricing table; `null` when neither exists (rev 28: also when no tokens were reported; `0` only when the runtime reported `0` for no tokens, or the turn never started) |
| `cost_estimated` | `true` when `cost_usd` is the pricing-table estimate |
| `runtime_version` | From the runtime's install metadata, as `agent scan` reads it (§6); `null` when unknown |
| `native_sandbox` | rev 25, capability `agent-test-sandbox`. The vendor CLI's sandbox for this turn, from the `start` event's `native_sandbox` (§3.2): `read-only`, `workspace-write`, `full`, `none` or `monomind`. `null` when the turn never started (missing binary, unsupported `--sandbox`) |
| `sandbox_applied` | rev 26, capability `agent-exec-sandbox-fallback`. The `--sandbox` mode the turn ran in, after `--sandbox-fallback` (the `start` event's `sandbox_applied`); `null` without `--sandbox` or when the turn never started |
| `error` | `null`, or `{code, message, login_hint?}` for a failed status. `login_hint` comes with `auth` |

| `status` | Meaning | Exit |
|---|---|---|
| `ok` | The reply is `ok` (trimmed, any case, trailing punctuation allowed) | 0 |
| `ok_unexpected` | The turn succeeded but replied with other text | 0 |
| `auth` | Not logged in or the key was rejected | 1 |
| `quota` | Usage limit, quota or billing | 1 |
| `rate_limited` | rev 20. A transient provider rate limit (429) after `agent exec`'s retries (`error.code: "rate-limited"`) | 1 |
| `model_unavailable` | The runtime does not know the model, or the account's plan does not include it (`error.code: "model-unavailable"`) | 1 |
| `timeout` | `--timeout` (default 60s) fired | 124 |
| `missing_binary` | The runtime's CLI is not installed | 1 |
| `error` | Anything else; `error.code` keeps the §3.4 code (`runner-error`, `no-runner`, …) | 1 |

**`--sandbox` and `--env`** (rev 25, capability `agent-test-sandbox`, issue
#474) work as in `agent exec` (§3.1): `--sandbox read-only|workspace-write|full` picks the vendor
CLI's own sandbox where `agent scan --json` lists the mode in `sandbox_modes`, and `--env KEY=V`
(repeatable) adds to the agent process's environment. The turn's access stays `scoped` whatever
they say. The sandbox can only be tightened: a `MONOMIND_GIT_LEVEL` below `push` (from `--env`
or monomind's own environment) caps codex/grok at `workspace-write` even with `--sandbox full`,
and `MONOMIND_GIT_LEVEL=push` does not loosen `--sandbox read-only`. A mode the runtime lacks
(e.g. `--sandbox workspace-write` on pi) gives `status: "error"` with `error.code:
"unsupported"` and `native_sandbox: null`, exit 1; no turn runs. An unknown mode or a malformed
`--env` entry is a usage error (exit 2, no JSON). Check `native_sandbox` for what the CLI really
got:

```json
{"v":1,"runtime":"pi","model":null,"status":"error","reply":null,"latency_first_ms":null,
 "latency_ms":3,"input_tokens":0,"output_tokens":0,"cost_usd":0,"cost_estimated":false,
 "runtime_version":"0.87.1","native_sandbox":null,"sandbox_applied":null,
 "error":{"code":"unsupported","message":"--sandbox workspace-write is not supported by runtime \"pi\" (agent scan --json sandbox_modes: read-only, full)"}}
```

**`--sandbox-fallback fail|strictest|run`** (rev 26, capability `agent-exec-sandbox-fallback`,
issue #482) works as in `agent exec` (§3.1): with `strictest` or `run` a mode the runtime lacks
is replaced instead of failing, and `sandbox_applied` says what ran — e.g. `agent test pi
--sandbox workspace-write --sandbox-fallback strictest --json` runs pi `read-only` and reports
`"native_sandbox":"read-only","sandbox_applied":"read-only"`.

A missing runtime id is a usage error (exit 2, no JSON). `model_unavailable` matches the wording
each runtime uses for a bad model — Claude Code's "issue with the selected model", copilot's
"from --model flag is not available", pi's and crush's "model … not found", agy's "not
recognized as a known model", OpenAI's "does not exist", Gemini's `models/… is not found` and
plan gates — even when the provider answered 403. The classifier is
`orgrt/agent-error-classify.ts`. Without `--json` the command prints one line, such as
`codex/gpt-5.5: ok — "ok" in 1430ms, first 812ms, 12→1 tokens, $0.0001`.

Claude runtime selection diagnostics (#595): the Claude entry in `agent scan
--json` and `agent models --runtime claude --json` include `claude_code` with
`used` (the accepted binary's real path or `bundled`), `version`, and `skipped`
entries (`path`, optional `version`, `reason`). Skipped versions come from
installation metadata when available; rejected binaries are never executed to
obtain them. `doctor -c claude-runtime --json` reports the same selection without
installing the SDK. Human scan/models commands report a skipped newer native
install once per process, even when the SDK is already installed.
