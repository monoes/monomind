# Agent Exec Protocol — v1 (rev 4)

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
- **Stability**: Versioned. Frames and events carry `"v": 1`. Breaking changes bump `v` and are
  announced via the capability handshake (§2).
- **Purpose**: Expose monomind's `AgentRunner` engine (13 local agent CLI runners) and org
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
| `start` | `v, runtime, model?, cwd, resume?, pid, child_pid?` | `pid` = the monomind process; `child_pid` = the agent-CLI subprocess when the runner spawns one (omitted for in-process runners). **rev 4**: v1 always omits `child_pid` — the `AgentRunner` interface does not surface child pids; add it if/when runners expose them |
| `session` | `v, session_id` | Runner's session/thread/conversation id; pass back via `--resume` |
| `assistant` | `v, text` | Incremental assistant text (may be multi-line; callers append) |
| `tool_call` | `v, id, name, args` | Only with `--tools stdio` — caller must execute and reply (§4) |
| `tool_result` | `v, id, ok, result` | Echo of the applied result (post `canUseTool` gating) |
| `usage` | `v, input_tokens, output_tokens, cost_usd` | Per-round delta (cumulative→delta conversion handled inside monomind) |
| `result` | `v, subtype ("success"\|"error"), is_error, text, stop_reason, input_tokens, output_tokens, cost_usd` | Aggregate final result; `stop_reason`: `end_turn` \| `max_turns` \| `tool_round_cap` \| `cancelled` \| `timeout`. **rev 4**: `tool_round_cap` is detected best-effort — it matches the runner's tool-round-cap assistant note; a fence runner that stops without the note yields `end_turn` |
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
  {"id":"claude","installed":true,"binary":"/usr/local/bin/claude","version":"1.0.58","install_hint":""},
  {"id":"codex","installed":false,"binary":null,"version":null,
   "install_hint":"npm install -g @openai/codex && codex login"},
  …
]}
```

One entry per known runner (set grows with monomind releases). Honors `<NAME>_CLI_BIN`
overrides. Binary probes run in parallel with a 5s per-binary timeout so a hung `--version`
probe cannot stall the scan. Exit 0 always (detection, not a test).

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
