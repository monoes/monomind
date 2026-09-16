# Agent Exec Protocol — v1 (rev 7)

- **Status**: Implemented (Phase 0 of the mono-agent delegation plan — see
  `mono-agent:docs/plans/local-agent-monomind-delegation.md`)
- **Revision history**:
  - rev 1 (2026-08-24): initial draft.
  - rev 2 (2026-08-25): review fixes — `agent list` collision resolved (§6), dual-mode tool
    definitions via `--tools-file` (§4), `--timeout` added so exit 124 is defined (§3.1),
    `pid`/`child_pid` disambiguation, stdout purity mandated (§3.2), error-code taxonomy (§3.4),
    stdin EOF semantics (§4), `--protocol` added to flags (§3.1), concrete `--max-turns` default,
    machine-readable `stop_reason` (§3.2), org project resolution rule (§7.1), `org list` /
    `org events` marked as new commands (§7), golden transcript fixtures (§8).
  - rev 3 (2026-08-25): **correction** — `org list` was NOT new; it already existed
    (`commands/org.ts:1354`, human-output only, already project-cwd-scoped per §7.1) and only
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

`agent exec`, `agent scan`, and `agent test` join the **existing** `monomind agent` namespace
(swarm lifecycle: `spawn/list/status/stop/metrics/pool/health`). The name `agent list` is taken
by swarm management and is NOT reused by this protocol — the installed-only view is
`agent scan --installed` (§6).

## 2. Capability handshake

```
$ monomind --version --json
{"version":"2.10.0","min_caller":"1.0.0","capabilities":["agent-exec","agent-scan","org-json-v1"]}
```

Callers MUST handshake before use and fail with an actionable message (install/upgrade hint)
when a required capability is absent. `min_caller` is advisory. New capabilities are additive;
removals or semantic changes bump the capability string (e.g. `org-json-v2`) or frame `v`.

## 3. `monomind agent exec`

Runs one agent turn through the resolved runner. Process model: monomind spawns the agent CLI as
its child (directly, or via the runner's SDK); the caller spawns monomind. Callers SHOULD place
monomind in its own process group so a group-kill reaps monomind **and** the agent-CLI
grandchild.

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
| `--budget-usd <n>` | | rev 3. Optional spend cap for this turn, enforced via the same per-role budget mechanism orgrt already uses internally. On breach: SIGTERM the agent child, emit `error {code:"budget", fatal:true}` + `done`, exit 1. Bare `agent exec` has no default cap — callers driving cost-sensitive flows (e.g. a chat UI, not an org role) should set this explicitly. **rev 4 granularity**: on a single-shot exec the cap is checked when the turn's `result` message arrives (the AgentRunner interface surfaces usage at result granularity) — the overspend is reported as the terminal outcome (`error budget` + exit 1, **no success `result` event`) so callers stop, but a single turn's own spend cannot be interrupted mid-flight. Mid-turn enforcement arrives with M2 (`agent_ask` in orgrt, where the mailbox-close mechanism applies). |

Exactly one of `--prompt` / `--prompt-file`. Unknown flags → exit 2 with JSON error on stderr.

There is no output-mode flag: NDJSON events on stdout are the command's only output mode.

Implementation note: `AgentRunArgs.prompt` is an `AsyncIterable` (mailbox stream) and
`AgentRunArgs.tools` are in-process `OrgToolDef` handlers — `agent exec` adapts the one-shot
prompt into a single-message stream and bridges tool handler invocations to §4 frames.

### 3.2 Output: NDJSON events (stdout, one JSON object per line)

All events carry `"v": 1`. Order per turn: `start → [session] → assistant* → [tool_call →
tool_result]* → [usage]* → result → done`. On failure: `start → … → error → done`.

| Event | Fields | Notes |
|---|---|---|
| `start` | `v, runtime, model?, cwd, resume?, pid, child_pid?, streams_incrementally` | `pid` = the monomind process; `child_pid` = the agent-CLI subprocess when the runner spawns one (omitted for in-process runners). **rev 4**: v1 always omits `child_pid` — the `AgentRunner` interface does not surface child pids; add it if/when runners expose them. **rev 5**: `streams_incrementally` (bool) — whether this runtime delivers real incremental `assistant` text as a turn streams, vs. only ever a complete message at a step/turn boundary (see §9) |
| `session` | `v, session_id` | Runner's session/thread/conversation id; pass back via `--resume` |
| `assistant` | `v, text` | Incremental assistant text (may be multi-line; callers append) |
| `tool_call` | `v, id, name, args` | Only with `--tools stdio` — caller must execute and reply (§4) |
| `tool_result` | `v, id, ok, result` | Echo of the applied result (post `canUseTool` gating) |
| `usage` | `v, input_tokens, output_tokens, cost_usd` | Per-round delta (cumulative→delta conversion handled inside monomind) |
| `result` | `v, subtype ("success"\|"error"), is_error, text, stop_reason, input_tokens, output_tokens, cost_usd` | Aggregate final result; **rev 7**: `text` is the complete final assistant text — the joined `assistant` texts for a `streams_incrementally` runtime, the last `assistant` message otherwise (omitted only if the turn produced none); `stop_reason`: `end_turn` \| `max_turns` \| `tool_round_cap` \| `cancelled` \| `timeout`. **rev 4**: `tool_round_cap` is detected best-effort — it matches the runner's tool-round-cap assistant note; a fence runner that stops without the note yields `end_turn` |
| `error` | `v, code, message, fatal (bool)` | Codes in §3.4. `fatal:true` = auth/quota class — callers must not retry |
| `done` | `v, exit_code` | Terminal event. Always emitted exactly once, even on error |

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
- Max 10 tool rounds per turn for fence runners (`MAX_TOOL_ROUNDS`, `tool-fence.ts`); native
  runners are bounded by `--max-turns` instead. Hitting either cap yields
  `result.stop_reason="tool_round_cap"` / `"max_turns"` (machine-readable, §3.2).
- Caller may send `{"v":1,"type":"cancel"}` on stdin at any time to request cancellation
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
  {"id":"claude","installed":true,"binary":"/usr/local/bin/claude","version":"1.0.58","install_hint":"","streams_incrementally":true},
  {"id":"codex","installed":false,"binary":null,"version":null,
   "install_hint":"npm install -g @openai/codex && codex login","streams_incrementally":false},
  …
]}
```

One entry per known runner (set grows with monomind releases). Honors `<NAME>_CLI_BIN`
overrides. Binary probes run in parallel with a 5s per-binary timeout so a hung `--version`
probe cannot stall the scan. Exit 0 always (detection, not a test). **rev 5**: `streams_incrementally`
is static per-runtime metadata (`RunnerSpec.streamsIncrementally`, §9) — unlike `installed`/`version`,
it never depends on probing the binary, so it's always present even when `installed:false`.

`agent scan --installed --json` = installed-only view (the name `agent list` is reserved by the
pre-existing swarm command, §1). `agent test <id>` = one smoke turn via `agent exec`
(**rev 4**: it emits the same NDJSON event stream; success = a `result` event with
`subtype:"success"`; auth problems surface as `error {code:"auth", fatal:true}` — so `test`
doubles as the auth smoke check).

Auth status is deliberately NOT probed by `scan` (login checks are too heterogeneous); auth
failures surface at exec time as `error {code:"auth", fatal:true}` with the runtime's login
hint in `message` (§3.4).

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

`org list` (all orgs in the project) already exists (`commands/org.ts:1354`) — it only gains
`--json` output here, same as the other commands above (rev 3). **The only genuinely new
command** added for this protocol is `org events` (§7.3).

Shapes mirror the underlying state files (`runtime.json`, `history.jsonl`, `questions.json`,
`gates.json`, `decisions` traces) — see `orgrt/types.ts` for field definitions. Snapshotted in
monomind's `--json` contract tests.

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
   tool-loop, fatal auth, timeout, cancel, bad-frame) so callers can build contract tests
   without running monomind; mono-agent's Phase 1 gate consumes these.
5. Two real runners smoke-tested (whatever is installed in CI/dev).

### 8.4 Status (rev 4)

Items 1–4 are implemented: `src/__tests__/agent-exec.test.ts` (29 engine tests, fake-runner
round-trips in both tool modes), `src/__tests__/runner-registry.test.ts` (scan + handshake),
`src/__tests__/org-json-contracts.test.ts` (§7.2/§7.3 snapshots), and the six fixtures above
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
