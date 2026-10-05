# `monomind org` — Command Reference

> **<!-- doc-count:org-subcommands -->39<!-- /doc-count:org-subcommands --> subcommands** for starting, stopping, monitoring, and managing autonomous agent
> organizations. All commands target a named org config in `.monomind/orgs/<name>.json`.

---

## Subcommand Index

| Subcommand | Purpose |
|---|---|
| [`run`](#run) | Start org foreground daemon |
| [`stop`](#stop) | Stop a running org |
| [`pause`](#pause) | Pause org (suspend message delivery) |
| [`resume`](#resume) | Resume a paused org |
| [`reload`](#reload) | Hot-reload an org definition without stopping sessions |
| [`status`](#status) | Show org runtime status |
| [`serve`](#serve) | Long-running daemon for multiple/scheduled orgs |
| [`supervisor`](#supervisor) | Generate launchd/systemd unit for persistent serve |
| [`test-loop`](#test-loop) | Run org test loop |
| [`logs`](#logs) | Stream or filter bus.jsonl event log |
| [`events`](#events) | Tail a run's bus events as raw NDJSON (machine surface) |
| [`watch`](#watch) | Live-tail one role's assistant chat text |
| [`report`](#report) | Summarize a run (cost, tokens, assets, crashes) |
| [`memory`](#memory) | Cross-run knowledge-graph memory |
| [`skills`](#org-skills--the-org-skill-library) | Browse, search, read and import Org-library skills |
| [`costs`](#costs) | Per-role cost tracking |
| [`inbox`](#inbox) | Deliver an inbound cross-org message (live or queued) |
| [`flow`](#flow) | Export Mermaid message flow diagram |
| [`questions`](#questions) | List pending ask_human questions (`questions dismiss` closes one without an answer) |
| [`approvals`](#approvals) | List pending tool/action approval requests |
| [`answer`](#answer) | Deliver answer to an ask_human question |
| [`approve`](#approve) | Approve a pending tool/action approval |
| [`deny`](#deny) | Deny a pending tool/action approval |
| [`gates`](#gates) | List decision gates from an org's agents |
| [`gate-approve`](#gate-approve) | Approve a pending decision gate |
| [`gate-reject`](#gate-reject) | Reject a pending decision gate |
| [`replay`](#replay) | Time-travel debug from a run ID |
| [`resume-from`](#resume-from) | Resume live execution from a persisted checkpoint |
| [`branch`](#branch) | Snapshot a run's event log for replay |
| [`decisions`](#decisions) | Show rifft-style decision traces |
| [`create`](#create) | Scaffold org from template |
| [`validate`](#validate) | Validate org config(s) against schema |
| [`migrate`](#migrate) | Convert a legacy-format org config file to the current format |
| [`list`](#list) | List all org configs |
| [`delete`](#delete) | Delete org and all artifacts |
| [`mark-complete`](#mark-complete) | Clear stale running/crashed runtime record |
| [`role set-access`](#role-set-access) | Human-only grant/revoke of `policy.access: "full"` for one role |
| [`sign`](#sign) | Review an org definition's authority and sign it as the operator |
| [`approve-paths`](#approve-paths) | List, or approve, protected paths the runtime would quarantine as possible plants |

---

## `run`

Start an org in the **foreground**. If a live `org serve` daemon is detected (via heartbeat),
the task is sent as a runfile to the daemon instead of competing with it.

```bash
monomind org run <name> [--task "..."] [--resume] [--no-cross-process] [--dry-run] [--budget-usd <n>] [--yes] [--auto-approve <tools>]
```

| Flag | Purpose |
|---|---|
| `--task "..."` | Override the org's `goal` for this run |
| `--resume` | Resume from the org's persisted checkpoint instead of starting fresh |
| `--cross-process` | Register with broker for cross-daemon `org_send` delivery (default on; `--no-cross-process` disables) |
| `--dry-run` | Validate config and print plan without starting |
| `--budget-usd <n>` | Abort before any session starts if the upfront cost estimate exceeds `n` USD |
| `--yes`, `-y` | Skip the interactive cost-estimate confirmation (only asked on a TTY). It does not approve tool calls |
| `--auto-approve <tools>` | Comma-separated tools every role may call without human approval for this run only, e.g. `org_complete` for an unattended one-shot `--task` run. Adds to each role's `policy.autoApproveTools`; other gated tools still wait. A name no role gates (not `Bash`, `WebFetch`, `WebSearch`, `org_complete` or a role's `approvalTools`) is refused, so a typo can't leave the run waiting. Also refused when an `org serve` daemon owns the project |

The org's definition must carry a valid operator signature (see [`sign`](#sign)). An org that has
never been signed gets a one-time review-and-sign prompt on a TTY; otherwise `run` exits 1 with the
`monomind org sign <name>` hint, before handing anything to a serve daemon.

While the run is up, each tool call that is waiting on approval is printed with the
`monomind org approve <org> <role> <tool>` and `monomind org deny …` commands that resolve it.

Before starting, `run` prints a per-role cost estimate (rates from a built-in table,
overridable in `~/.monomind/rates.json`). With `--budget-usd` set too low:

```text
Estimate $1.80 exceeds --budget-usd $0.0001. Aborting before any tokens are spent.
```

When the run ends — `org_complete`, `org stop`, Ctrl-C/SIGTERM, the idle watchdog, a budget, or a crash — the last line it prints names the outcome (`complete`, `stopped`, `budget` or `error`, with the cause in parentheses), the wall time and the total cost, e.g. `org release run run-… ended — outcome: complete (achieved), wall time 1h57m12s, cost $63.63`, so a detached run's log always has an ending. `org serve` keeps its own `[org serve] shutting down: …` line; each run it hosts is summarized in `history.jsonl`.

**Source:** [`commands/org-run.ts → runAction`](packages/@monomind/cli/src/commands/org-run.ts#runAction)

---

## `stop`

Write a stopfile to `.monomind/orgs/<name>/stop`. The daemon picks it up within 2s.
Validates that `runtime.json` PID is alive before writing the stopfile.

```bash
monomind org stop <name>
```

**Source:** [`commands/org-lifecycle.ts → stopAction`](packages/@monomind/cli/src/commands/org-lifecycle.ts#stopAction)

---

## `pause`

Write a pause sentinel to `.monomind/orgs/<name>/pause`, suspending message delivery.

```bash
monomind org pause <name>
```

---

## `resume`

Clear the pause sentinel, resuming message delivery.

```bash
monomind org resume <name>
```

---

## `reload`

Hot-reload a running org's definition from disk without stopping any in-flight agent sessions.
Applies changes to `goal`, `run_config`, and `schedule`, and to these fields of existing roles:
`tool_providers`, `endpoint`, `kind`, `policy`, `budget_usd` and `budget_tokens`. New roles are
added as pending (lazy-spawnable on first message), removed roles are **not** killed — they finish
their current work and are simply never re-spawned.

A new `budget_usd` / `budget_tokens` applies to the role's total spend so far, which is kept. A role
whose session was closed because it spent its own budget reopens when the reload raises the budget
above that spend: its session resumes and the tasks held for it are dispatched again. A raise that
still leaves it at or over the cap keeps it closed. Raising `run_config.budget_tokens` above the
run's total spend reopens the roles the org-wide ceiling closed, and the ceiling stays enforced at
the new value. A changed `run_config.budget_tokens` or role `budget_tokens` also recomputes the even
split for live roles without their own `budget_tokens`. See
[Budget-closed assignees](../concepts/org-runtime.md#budget-closed-assignees).

A definition whose operator signature does not verify (see [`sign`](#sign)) is not applied at all:
the running org keeps its last verified definition, `reload` prints the `org sign` hint, and the
daemon logs `reload refused` and emits a `hot-reload-refused` audit event. Goal and prompt edits are
not signed and reload as before.

```bash
monomind org reload <name>
```

**Source:** [`commands/org-lifecycle.ts → reloadAction`](packages/@monomind/cli/src/commands/org-lifecycle.ts#reloadAction) (subcommand entry), [`orgrt/org-reload.ts → reloadOrgDef`](packages/@monomind/cli/src/orgrt/org-reload.ts#reloadOrgDef) (`reloadOrgDef()`)

---

## `status`

Read `runtime.json` for each org and display a live summary.

```bash
monomind org status [<name>]
```

Shows: elapsed time, events, messages, tool calls, roles, tokens used, cost in USD.
Detects stale PIDs (process no longer alive).

**Source:** [`commands/org-lifecycle.ts → statusAction`](packages/@monomind/cli/src/commands/org-lifecycle.ts#statusAction)

---

## `serve`

Long-running daemon that hosts **all scheduled orgs** and responds to runfiles/stopfiles.

```bash
monomind org serve [--no-cross-process]
```

| Flag | Purpose |
|---|---|
| `--cross-process` | Register hosted orgs with the broker for cross-daemon delivery (default on; `--no-cross-process` disables) |

- Polls stopfiles every 2 seconds (`pollStopfiles()`).
- Polls runfiles every 2 seconds (`pollRunfiles()`).
- Writes heartbeat to `serve-heartbeat.json` every 30 seconds.
- Runs `OrgScheduler` for orgs with a `schedule` field.

**Source:** [`commands/org-serve.ts → serveAction`](packages/@monomind/cli/src/commands/org-serve.ts#serveAction)

---

## `supervisor`

Emit a launchd plist (macOS) or systemd unit (Linux) for persistent `org serve`.

```bash
monomind org supervisor [--format launchd|systemd] [--install]
```

| Flag | Purpose |
|---|---|
| `--format launchd\|systemd` | Unit type (default: `launchd` on macOS, `systemd` otherwise); any other value errors |
| `--install` | Write the unit into the per-user location (`~/Library/LaunchAgents/` or `~/.config/systemd/user/`) |

Generates a per-project slug from a SHA256 hash of the current working directory.

**Source:** [`commands/org-serve.ts → supervisorAction`](packages/@monomind/cli/src/commands/org-serve.ts#supervisorAction)

---

## `test-loop`

Run the org's test loop (delegates to `orgrt/test-loop.ts::runTestLoop()`).

```bash
monomind org test-loop [--times <n>] [--scenario <file>]
```

| Flag | Purpose |
|---|---|
| `--times <n>`, `-n` | Iterations (default 5) |
| `--scenario <file>` | Run a declarative scenario file (`.monomind/scenarios/<file>`) instead of the built-in fixture — structural dry-run only |

Prints a summary such as `org e2e: 1/1 passed`; exits non-zero if any iteration fails.

**Source:** [`commands/org-manage.ts → testLoopAction`](packages/@monomind/cli/src/commands/org-manage.ts#testLoopAction)

---

## `logs`

Follow or filter the org's `bus.jsonl` event stream.

```bash
monomind org logs <name> [options]
```

| Flag | Purpose |
|---|---|
| `--run <run-id>` | Filter to a specific run |
| `--role <id>` | Filter to a specific role |
| `--filter-tool <name>` | Show only tool events for this tool |
| `--filter-role <id>` | Show only events from this role |
| `--tools-only` | Show only `tool` type events |
| `--audit-filter` | Show only `audit` events |
| `--follow` | Follow live (like `tail -f`) |

---

## `events`

Tail a run's `bus.jsonl` as NDJSON — one raw bus event per line on stdout, no
formatting. This is the machine streaming surface for scripts and other tools
(agent-exec-protocol §7.3); `logs` is the human one.

```bash
monomind org events <name> [--run <run-id>] [--follow] [--since <event-id|iso-8601>]
```

| Flag | Purpose |
|---|---|
| `--run <run-id>` | Run to read (default: latest) |
| `--follow`, `-f` | Keep tailing (polls every 500 ms) until Ctrl-C / SIGTERM |
| `--since <cursor>` | Replay cursor. An event id (`run-…`) prints only events after that id — nothing if the id is not in the log. An ISO-8601 timestamp drops events older than it. Any other value is ignored |
| `--ndjson` | Accepted for spec symmetry; NDJSON is the only output mode |

```bash
monomind org events growth --follow
monomind org events growth --since run-20260925-a-1 | jq -r .type
```

Output (one JSON object per line):

```text
{"id":"run-20260925-a-2","ts":"2026-09-25T10:05:00.000Z","type":"tool","from":"coder","tool":"Bash"}
```

Exits 1 with `no runs found for org <name>` when the org has no runs. A partially
written last line is retried on the next poll; corrupt interior lines are skipped.

**Source:** [`commands/org-observe-logs.ts → eventsAction`](packages/@monomind/cli/src/commands/org-observe-logs.ts#eventsAction)

---

## `watch`

Live-tail one role's assistant chat text (any runtime) — a filtered, friendlier `logs --follow`.

```bash
monomind org watch <name> <role> [options]
```

| Flag | Purpose |
|---|---|
| `--run <run-id>` | Run id (default: latest) |
| `--follow=false` | Print current output once and exit instead of live-tailing |
| `--verbose` | Also interleave status events (restart/crash/state-change) into the transcript |
| `--stats` | Print a running token/cost line as usage events arrive |

**Source:** [`commands/org-observe-logs.ts → watchAction`](packages/@monomind/cli/src/commands/org-observe-logs.ts#watchAction)

---

## `report`

Summarize a run's outcome, token usage, cost, assets, and crashes.

```bash
monomind org report <name> [options]
```

| Flag | Purpose |
|---|---|
| `--run <run-id>` | Report on a specific run |
| `--all` | Report across all runs |
| `--by-role` | Break down by role |
| `--audit` | Include audit events |
| `--tool` | Include tool summary |
| `--format json\|table` | Output format |

Each role's line shows its total tokens, split into input+output and cache tokens, and — when the org config is readable — how much of its token budget it has used. That percentage is computed on the basis `budget_tokens` is enforced on: input+output by default, or the full billable total (cache included) when `run_config.budget_tokens_basis` is `"billable"`. A role is marked `near limit` at 80% and `EXHAUSTED` at 100% of that basis.

---

## `memory`

Cross-run knowledge-graph memory for an org.

```bash
monomind org memory <name> <subcommand>
```

| Subcommand | Purpose |
|---|---|
| `stats` (default) | Node/edge/rule counts, per-namespace entry counts |
| `search <query>` | Semantic search of cross-run memory |
| `rules` | List up to 50 stored "when X do Y" rules |
| `rollback <run-ref>` | Undo all memory written by a specific run |

**Source:** [`commands/org-memory-command.ts → memorySubcommand`](packages/@monomind/cli/src/commands/org-memory-command.ts#memorySubcommand)

---

## `org skills` — the Org skill library

List, search, read and import the skills org roles are fed by name (`skills`, `skill_pool`). The library is the project's `.monomind/org-skills`, then `~/.monomind/org-skills`, then the bundled set, then active catalog skills; the first match by name wins. How to write one, and where each root lives, is on [Agents & Skills](../concepts/agents-and-skills.md#4-adding-an-org-skill).

```bash
monomind org skills [list] [--tag <tag>]                     # every skill, with tags and description
monomind org skills search "<text>" [--tag <tag>] [--limit 10]
monomind org skills show <name>                              # frontmatter, license, source, body
monomind org skills import <owner/repo | git-url | path> [--global | --into <dir>] [--only a,b] [--tags x,y] [--overwrite]
```

| Verb | Behavior |
|---|---|
| `list` (default) | Every skill across the roots, sorted by name; `--tag` filters |
| `search` | Keyword-ranks name, tags and description (a name or tag hit weighs more); when a Jev decision model is configured it re-ranks the shortlist and each hit shows its probability |
| `show` | One skill: description, tags, `tools`, license, source and origin, reference files and the full body. The same content as the `org_skill_show` MCP tool |
| `import` | Copies a repository's skills into `.monomind/org-skills` (`--global`: `~/.monomind/org-skills`; `--into`: any directory). Only MIT and Apache-2.0 skills are imported; others are listed as skipped |

`--format json` prints JSON for every verb. `monomind org validate` fails on a `skills` or `skill_pool` entry that names no skill, or a `tag:` selector that matches none.

**Source:** [`commands/org-skills.ts → orgSkillsAction`](packages/@monomind/cli/src/commands/org-skills.ts#orgSkillsAction), [`orgrt/skill-library.ts`](packages/@monomind/cli/src/orgrt/skill-library.ts#listSkills)

---

## `costs`

Per-role cost tracking from `runtime.json`.

```bash
monomind org costs <name> [--run <run-id>]
```

---

## `inbox`

Deliver an inbound cross-org message to an org — the entrypoint that cross-org/SSH
delivery (`orgrt/remote.ts`) shells out to on the target machine.

```bash
monomind org inbox <name> --json '{"from":"sales:boss","subject":"...","body":"..."}' [--to <role>]
```

- **`from`** is the qualified sender (`"<org>:<role>"`); **`--to`** defaults to the org's
  coordinator role (`reports_to: null`). `--from`/`--subject`/`--body` flags are accepted
  as an alternative to `--json`.
- **Live delivery** via the hosting daemon's `/api/xdeliver` when the org is registered
  with the broker (running under `org run`/`org serve` on this machine).
- **Queued to `inbox.jsonl`** otherwise — drained into the target role's mailbox when
  the org next starts, with the same semantics as a queued human answer.

---

## `flow`

Export a Mermaid flowchart of the message flow between roles for a run.

```bash
monomind org flow <name> [--run <run-id>]
```

---

## `questions`

List pending `ask_human` questions for a running or stopped org.

```bash
monomind org questions <name> [--all] [--format json]
```

| Flag | Purpose |
|---|---|
| `--all` | Include answered questions (shown with `✓` and the answer) and dismissed ones (`✗` and the reason) |
| `--format json` | Print `{v, org, items}` |

Questions are stored in `<org>/questions.json`. Each entry has a `questionId`, `role`,
`question`, `ts` and `answer` (null while pending; answered entries add `answeredAt`
and `resolvedBy`). A dismissed entry keeps `answer: null` and adds
`state: "dismissed"`, `dismissedAt`, `dismissReason` (when given) and `resolvedBy`.

```text
❓ [q-1] 2026-09-21 14:13Z  coder: ship?
✓ [q-2] 2026-09-10 00:26Z  coder: old?
     ↳ no
✗ [q-3] 2026-09-09 08:02Z  boss: which region?
     ↳ dismissed: decided elsewhere
```

### `questions dismiss`

Close a pending question without an answer, for a question nobody will
answer or one that no longer matters.

```bash
monomind org questions dismiss <name> <question-id> [--reason "<text>"] [--by <resolver>] [--format json]
```

- Marks the question dismissed in `questions.json`. A dismissed question no longer
  holds the idle watchdog or `org_complete` (an open **blocking** question refuses
  every `org_complete` except `partial` with blocker `human`).
- The asking role gets a short note that no answer is coming, with the reason:
  **live** into its mailbox while the org runs, **queued** in `inbox.jsonl` while it
  is stopped (the org is not woken for it). A role that is no longer in the org
  definition gets no note.
- A running org records a `decision-resolved` audit event with `verdict: "dismissed"`,
  the `reason`, and `delivery` (`live`, `queued` or `skipped`, with a `note` saying why
  when skipped).
- `--format json` prints `{v, org, question_id, role, delivery, dismissed, resolvedBy}`.
- An unknown id, or a question that is already answered or dismissed, fails with a
  message and exit code 1.
- While a daemon runs the org, the dismissal goes only through it (with the operator
  credential): if that daemon refuses it, nothing is recorded. Only an unreachable
  daemon falls back to recording it in `questions.json`.
- The dashboard's Human Input view has a **Dismiss** button next to **Answer**
  (`POST /api/questions/dismiss`, same human-session auth as answering).

---

## `approvals`

List tool/action approval requests raised by an org's agents — the queue in
`<org>/approvals.json` that gates `Bash`, `WebFetch`, `WebSearch`, `org_complete` and
any tool in a role's `policy.approvalTools` (unless listed in `policy.autoApproveTools`). Separate from `questions` and `gates`:
resolving those grants nothing here. Resolve entries with [`approve`](#approve) /
[`deny`](#deny).

```bash
monomind org approvals <name> [--all] [--format json]
```

| Flag | Purpose |
|---|---|
| `--all` | Include resolved (approved/denied) entries; default shows pending only |
| `--format json` | Print `{v, org, items}`; each item carries `requestId`, `resolvedBy` and `input` (null when not recorded) |

Output (`❓` pending, `✓` approved, `✗` denied):

```text
❓ 2026-09-21 14:13Z  coder: Bash [apr-1]
✓ 2026-09-21 11:26Z  coder: WebFetch (by alice)

Approve with: monomind org approve growth <role> <action> [--request <id>] [--by <resolver>]
Deny with: monomind org deny growth <role> <action> [--request <id>] [--by <resolver>]
```

With nothing pending it prints `No pending approvals for org <name> (N resolved — use --all).`
or `No approval requests recorded for org <name>.`

**Source:** [`commands/org-observe-approvals.ts → approvalsAction`](packages/@monomind/cli/src/commands/org-observe-approvals.ts#approvalsAction)

---

## `answer`

Deliver a human answer to a pending `ask_human` question.

```bash
monomind org answer <name> <question-id> "<answer text>" [--by <resolver>]
```

- `--by` is recorded as `resolvedBy` (default `human`; 1-128 printable characters).
- **Live delivery** if the org is running.
- **Queued to disk** if the org is stopped (consumed on next start).
- If the daemon hosting this project's org refuses the answer (for example 403
  without the operator credential), nothing is recorded or queued and the command
  exits 1. Only an unreachable daemon falls back to the offline queue.
- If the asking role is no longer in the org definition, the answer is recorded
  (the question stops being pending) but not delivered or queued; a running org
  notes that in its `decision-resolved` audit event (`delivery: "skipped"`).
- A dismissed question cannot be answered (see [`questions dismiss`](#questions-dismiss)).

---

## `approve`

Approve a pending tool/action approval (see [`approvals`](#approvals)).

```bash
monomind org approve <name> <role> <action> [--request <apr-id>] [--by <resolver>]
```

- Resolves every pending entry for the `<role>`/`<action>` pair, or only the one
  named by `--request`. `--by` is recorded as `resolvedBy` (default `human`).
- **Live** through the hosting daemon when the org is running, otherwise written
  straight to `approvals.json`.
- If the daemon hosting this project's org refuses the decision (for example 403
  without the operator credential), nothing is written and the command exits 1.
  Only an unreachable daemon falls back to writing `approvals.json`. The same holds
  for `deny`, `gate-approve` and `gate-reject` (`gates.json`).

---

## `deny`

Deny a pending tool/action approval. Same arguments and delivery as [`approve`](#approve).

```bash
monomind org deny <name> <role> <action> [--request <apr-id>] [--by <resolver>]
```

---

## `gates`

List decision gates raised by an org's agents via the `org_gate` tool (hard-blocking
human-approval checkpoints). Add `--all` to include already-resolved gates.

```bash
monomind org gates <name> [--all]
```

**Source:** [`commands/org-observe-gates.ts → gatesAction`](packages/@monomind/cli/src/commands/org-observe-gates.ts#gatesAction)

---

## `gate-approve`

Approve a pending decision gate, unblocking the agent that raised it.

```bash
monomind org gate-approve <name> <gate-id> ["<resolution note>"] [--by <resolver>]
```

`--by` is recorded as `resolvedBy` (default `human`; 1-128 printable characters).

**Source:** [`commands/org-observe-gates.ts → gateResolveAction`](packages/@monomind/cli/src/commands/org-observe-gates.ts#gateResolveAction)

---

## `gate-reject`

Reject a pending decision gate.

```bash
monomind org gate-reject <name> <gate-id> ["<reason>"] [--by <resolver>]
```

`--by` is recorded as `resolvedBy` (default `human`).

**Source:** [`commands/org-observe-gates.ts → gateResolveAction`](packages/@monomind/cli/src/commands/org-observe-gates.ts#gateResolveAction)

---

## `replay`

Time-travel debugging — re-emit all bus events from a historical run.

```bash
monomind org replay <name> --run <run-id>
```

**Source:** [`commands/org.ts`](packages/@monomind/cli/src/commands/org.ts) (subcommand entry) → [`orgrt/daemon.ts → replayFrom`](packages/@monomind/cli/src/orgrt/daemon.ts#replayFrom) (`replayFrom()`, now a 2-line delegate) → [`orgrt/checkpoint-ops.ts → replayFrom`](packages/@monomind/cli/src/orgrt/checkpoint-ops.ts#replayFrom)

---

## `resume-from`

Resume live execution from the org's persisted checkpoint — restores mailbox/policy/session state, subject to TTL and checksum validation. Distinct from `replay`, which only re-emits a past run's bus events for debugging and does not restart agent execution.

```bash
monomind org resume-from <name>
```

---

## `branch`

Snapshot a run's event log (bus.jsonl) into a new run directory for replay. This
is a point-in-time snapshot, not an executable what-if scenario — it does not
fork or re-run agent execution.

```bash
monomind org branch <name> <run-id> <label> [--format json]
```

`<label>` does **not** name the new run: the run id is generated (`branch-<timestamp>-<rand>`),
and the label is a free-text note recorded alongside the source run in the snapshot's
`.branch-source` marker:

```json
{ "from": "run-20250130", "label": "before the outage", "branchedAt": "2025-01-30T09:31:00.000Z" }
```

To feed the new run to a later command, read the generated id from `--format json`
rather than parsing the human-readable line:

```bash
run=$(monomind org branch growth run-20250130 pre-outage --format json | jq -r .run)
monomind org replay growth "$run"
```

JSON shape: `{"v":1,"org":"<name>","run":"<generated id>","from":"<source run>","label":"<label>"}`.

**Source:** [`commands/org-observe.ts`](packages/@monomind/cli/src/commands/org-observe.ts) (`branchAction`) → [`orgrt/checkpoint-ops.ts`](packages/@monomind/cli/src/orgrt/checkpoint-ops.ts) (`branchCheckpoint()`)

---

## `decisions`

Show rifft-style decision traces for a run.

```bash
monomind org decisions <name> [--run <run-id>]
```

---

## `create`

Scaffold a new org config from a template.

```bash
monomind org create <name> --template <template> [--goal "..."] [--schedule 30m] [--force] [--yes]
```

| Flag | Purpose |
|---|---|
| `--template <t>` | Required. `content-team`, `dev-team`, `research-pod`, `kg-extraction` or `advisor-orchestrator` (omit it to print the list) |
| `--goal "..."` | Org goal (default: the template's placeholder) |
| `--schedule <interval>` | Daemon schedule, e.g. `30m` or `2h` |
| `--force` | Overwrite an existing org config (otherwise: `Org "<name>" already exists — pass --force to overwrite.`) |
| `--yes`, `-y` | Skip the per-role model confirmation prompt (asked only in an interactive terminal) |

Prints the roles, their models, the token budget and the config path, and signs the new org as the
operator (see [`sign`](#sign)). Inside an org role's process tree it writes the org unsigned and
says so.

---

## `validate`

Validate one or all org config files against the Zod schema.

```bash
monomind org validate [<name>]    # validates one or all orgs
```

---

## `migrate`

Convert a legacy-format org config file (one with `topology`/`board_id`/`communication`/`loop` fields) to the current format the runtime reads. `org run` also converts such files in memory with a deprecation warning; `migrate` rewrites the file so the warning goes away.

```bash
monomind org migrate <name>
```

Saves a backup as `<name>.v1.json` before overwriting.

**Source:** [`commands/org-manage.ts → migrateAction`](packages/@monomind/cli/src/commands/org-manage.ts#migrateAction)

---

## `list`

List all org configs with their role count, schedule, and current status.

```bash
monomind org list
```

Excludes artifact suffixes (`-state`, `-goals`, `-threads`, etc.) and `.v1.json` backups.

**Source:** [`commands/org-manage.ts → listAction`](packages/@monomind/cli/src/commands/org-manage.ts#listAction)

---

## `delete`

Delete an org config and all its runtime artifacts.

```bash
monomind org delete <name> [--yes] [--force]
```

| Flag | Purpose |
|---|---|
| `--yes` | Skip confirmation prompt |
| `--force` | Delete even if org is currently running |

**Source:** [`commands/org-manage.ts → deleteAction`](packages/@monomind/cli/src/commands/org-manage.ts#deleteAction)

---

## `mark-complete`

Clear a stale `running` or `crashed` record from `runtime.json` and POST to dashboard.

```bash
monomind org mark-complete <name>
```

Writes `{status:'stopped', closedBy:'mark-complete'}` to `runtime.json`.

**Source:** [`commands/org-manage.ts → markCompleteAction`](packages/@monomind/cli/src/commands/org-manage.ts#markCompleteAction)

---

## `role set-access`

Grant or revoke `policy.access: "full"` for one role (#365, Coder mode epic #364) — the **only**
place this repo writes that field together with a matching, SIGNED `access_ack`. See
`doc/concepts/org-runtime.md`'s "Full access" section for the full guardrail model (the signed
ack, the agent-context refusal, the unattended gate, and `org validate`'s taint checks).

```bash
monomind org role set-access <org> <role> full [--yes-i-understand]
monomind org role set-access <org> <role> scoped
```

| Flag | Purpose |
|---|---|
| `--yes-i-understand` | Skip the interactive confirmation for a `full` grant (required outside a TTY) |

**`full` refuses outright if it detects an agent context** — env `CLAUDECODE`,
`CLAUDE_CODE_ENTRYPOINT`, `MONOMIND_ORG_ROLE`, `MONOMIND_SDK_AGENT`, or `MONOMIND_AGENT_EXEC` (set
on `agent exec`'s runner child env) — with a "run this yourself in a terminal" message, exit
non-zero, checked BEFORE anything else and not overridable by `--yes-i-understand` or a TTY. This
is what stops a scoped chat/org from reaching a grant through an allowed `monomind org …` Bash
prefix. Outside an agent context, `full` refuses a role whose resolved runtime doesn't support full
access (`agent scan --json`'s `full_access` field — `claude` only today), then requires either an
interactive confirmation or `--yes-i-understand`.

Once confirmed, it creates (idempotently, mode `0600`) a machine-local signing key in the
operator-credential directory if one doesn't exist yet, then writes `policy.access: "full"` and
`policy.access_ack: {by:"human", at, hash, sig}` — `hash` covers the role's prompt/
responsibilities, runtime, model, provider, tool providers, `reports_to`, `review_input`,
`policy.settings`, and the org's `run_config.allow_unattended_full_access`/
`accept_full_access_taint`; `sig` is an HMAC of `hash` (plus org/role/at/by) under that key, so a
config-writing path that can merely recompute the public `hash` still cannot produce a grant the
runtime will honor. Editing any hash-covered field afterward suspends the grant
(`access_state: "suspended"`, visible in `org status`) until this command is run again. `scoped`
removes `policy.access`/`policy.access_ack`, needs no confirmation, and is exempt from the
agent-context check (a downgrade is always safe). Neither writes a live running org's session state
directly — run `monomind org validate <org>` to check for taint/scoped-field warnings, then
`monomind org reload <org>` (or restart it) to apply.

On an org whose definition verified before the edit, both modes re-sign it with that one change
(see [`sign`](#sign)); otherwise they say to run `monomind org sign <org>`.

**Source:** [`commands/org-subcommands-role.ts`](packages/@monomind/cli/src/commands/org-subcommands-role.ts)

---

## `sign`

Review an org definition's authority and sign it as the operator (#502). `org run`, `org serve`
(its runfile poll and its schedule, including a scheduled org's `prechecks`), `org reload` and
resume all refuse a definition whose signature does not verify:

```text
org growth: the definition has no operator signature — run `monomind org sign growth` as the operator after reviewing the change
```

```bash
monomind org sign <org> [--yes] [--project <dir>] [--expect-hash <hex>]
monomind org sign --all [--yes] [--project <dir>] [--expect-hash <org>=<hex> …]
monomind org sign <org> --format json [--project <dir>]    # review as JSON, never signs
monomind org sign <org> --check [--format json] [--project <dir>]
monomind org sign --all --check [--format json] [--project <dir>]
```

| Flag | Purpose |
|---|---|
| `--all` | Sign every org definition in the project (the one-time migration) |
| `--yes`, `-y` | Skip the per-org confirmation. Without a TTY and without it, `sign` prints the review and signs nothing |
| `--check` | Only report whether each org verifies. Never prompts, never signs, writes nothing (#558) |
| `--project <dir>` | Use `<dir>` as the project root instead of the current directory. It is resolved to its real path and must hold `.monomind/orgs` |
| `--expect-hash <hex>` | Sign only if the [signable hash](#the-signable-hash) about to be signed is `<hex>`; otherwise exit 1 and write nothing. With `--all`, repeat it as `<org>=<hex>`, once for every org |

**Unknown options:** `org sign` rejects any option it does not know. It prints
`org sign: unknown option --<name> — nothing signed.`, exits 2 and signs nothing, not even with
`--yes`. Monomind builds before this change silently ignored an option they did not know, such as
`--expect-hash`, and signed anyway.

**Checking what this monomind supports:** `monomind --version --json` lists these capabilities
(see [the Agent Exec Protocol](../agent-exec-protocol.md#2-capability-handshake)), so a tool can
check before relying on a flag:

| Capability | What it guarantees |
|---|---|
| `org-sign-check` | `--check` (text and `--format json`) and `--project <dir>` (#561) |
| `org-sign-expect-hash` | `--expect-hash`, the `hash` in `--check --format json`, and the exit 2 on an unknown option |
| `org-sign-review-json` | `org sign <org> --format json` prints the review as JSON and never signs |

**Checking without signing:** `--check` is for tools that rewrite org files themselves, such as
mono-agent. Such a tool verifies an org before its edit and, after writing, signs with `--yes`
only if the org verified before, so it re-signs only its own change. `--check` writes nothing:
not the signature directory, not the plant watch's first look, not the startup update check or
the project registry. It is read-only, so it also runs inside an org role. It prints one line
per org:

```text
release: signed
growth: changed
```

With `--format json` it prints one document:

```json
{"orgs":[{"org":"release","state":"signed","signedAt":"2026-09-30T12:00:00.000Z","hash":"a895d86c…"},
         {"org":"growth","state":"changed","signedAt":"2026-09-01T08:00:00.000Z","hash":"2bb0a6ad…","message":"org growth: the definition changed since the operator signed it …"}]}
```

| `state` | Meaning |
|---|---|
| `signed` | The signature verifies and the definition is unchanged |
| `changed` | The signature verifies, but the definition changed since it was signed |
| `unsigned` | No signature on this machine for this project |
| `invalid-signature` | A signature file is there but does not verify (wrong or missing key, unsafe file) |
| `forbidden-key` | The definition holds a `__proto__`, `constructor` or `prototype` key |
| `invalid` | The file is not valid JSON or not a valid org definition |
| `not-found` | There is no `.monomind/orgs/<org>.json` |

`signedAt` is the time of the verified signature (`signed` and `changed` only). `hash` is the
org's current [signable hash](#the-signable-hash), computed from the same read of the files as
the state; it is there for `signed`, `changed`, `unsigned` and `invalid-signature`, the states
`org sign` can sign from. `message` is
present on every state but `signed`. For the signature states (`changed`, `unsigned`,
`invalid-signature`, `forbidden-key`) it is the same text `run` and `reload` print; `not-found`
(`org not found: <org>`) and `invalid` (unreadable JSON, or "invalid definition — run
`monomind org validate <org>`") have their own wording. The exit code is 0 when every org checked
is `signed`, 1 otherwise, and 2 when an org is `not-found` or on a usage error (no org name, an
invalid name, or a bad `--project`; with `--format json` the error is printed as
`{"error":"…"}`).

`--all --check` in a project with no org definitions is not a pass: it prints `{"orgs":[]}` with
`--format json` (nothing on stdout otherwise), a `no org definitions in …` note on stderr, and
exits 2.

Inside a role's sandbox the operator directory is hidden or unreadable, so `--check` there sees
no usable signature or key and reports `unsigned` or `invalid-signature` for an org the operator
did sign. It never reports `signed` for an org that does not verify, so a caller can trust a
`signed`; for a definitive answer, run the check outside the role.

**Signing only what you wrote (`--expect-hash`):** a tool that checks an org, writes it and
then runs `org sign <org> --yes` leaves a window: a role could edit the org JSON or one of its
`instructions_file`s after the tool's check and before monomind reads the files, and that edit
would be signed. With `--expect-hash <hex>`, the tool passes the hash of the content it wrote
(computed as below, or taken from `--check --format json`). monomind reads the org file and each
instructions file once, computes the hash from those bytes, and signs those same bytes only if
the hash equals `<hex>` (case does not matter). Otherwise it prints
`org <org>: not signed — the definition changed: expected <hex>, actual <hash>`, exits 1 and
writes nothing to the operator directory. It works with `--yes` and `--project`. With `--all`,
pass `--expect-hash <org>=<hex>` once for every org in the project. A missing, repeated or
unknown org, or a malformed value, is a usage error (exit 2). If any org does not match, none is
signed.

**The review as JSON (signing what the user saw):** `org sign <org> --format json` without
`--yes` prints the review with the hash of exactly the content it reviewed. It reads the org file
and each instructions file once, the same single read that `--expect-hash` uses. It never
prompts and never signs, including on a TTY, and exits 0:

```json
{"org":"growth","state":"changed","hash":"<hex>",
 "review":{"authority":["  lead: runtime claude · git read · access scoped", "…"],
           "unconfinedRoles":[{"id":"ops","why":"…"}],
           "nonBundledSkills":["deploy (project, /repo/.monomind/skills/deploy)"],
           "approvalCandidates":["/repo/.claude/settings.json"],
           "firstLookConfigs":[],
           "diff":["  ~ definition.roles: … → …"]},
 "reviewText":"\norg growth (changed):\n  lead: runtime claude · …"}
```

`state` is `signed`, `changed`, `unsigned`, `invalid-signature` or `forbidden-key`. `review`
holds what the text review shows:
- `authority`: the per-role and org-level settings lines;
- `unconfinedRoles`: the roles that run with no OS confinement here, which the text review also
  lists as a warning;
- `nonBundledSkills`: org skills from the project or user library;
- `approvalCandidates`: the protected paths that would be quarantined;
- `firstLookConfigs`: the Claude configs monomind's first look will trust;
- `diff`: one line per change since the last signature, or `null` when this machine has no
  earlier signature.

`reviewText` is the text review, line for line, without colour. After the user approves, sign
with `org sign <org> --yes --expect-hash <hash>`. If a role changed the org file or an
instructions file after the review, the hashes differ and nothing is signed, so a signature is
always of what the user saw. A missing org prints `{"org","error"}` and exits 2, an unreadable or
invalid one exits 1, and `--all` is a usage error (exit 2).

**`--project`:** the signature binds the project's real path, so signing with
`--project <dir>` (also through a symlink) makes the same signature as running `org sign` inside
`<dir>`. The refusal inside a role's process tree (below) still applies when signing.

For each org it prints everything that decides what a role may run, reach or be granted: each
role's runtime, git level and access, `adapter_config`, `provider`, `endpoint`,
`instructions_file`, `skills`/`skill_pool`, budgets, every `policy` scope (`fileWrite`,
`fileRead`, tools, `webAllow`, `sandbox` with `allowWrite` and `allowedDomains`), and each tool
provider's command, arguments and env variable names (never values); then the org's runtime,
schedule, workspace, each precheck command, the full-access knobs, `federation`, `fence` and
`loadouts`. It names every role that would run with neither the SDK sandbox nor the bubblewrap
mask on this machine ("can read the operator key and sign anything"), and shows what changed
since the last signature (a copy of the signed projection is kept beside it). Then it asks
before signing.

**What is signed:** every field of `.monomind/orgs/<org>.json` as written, except the org's `goal`
and `status` and each role's `title`, `responsibilities` and `ui`. So each role's whole `policy`,
the role list, runtimes, `adapter_config`, `provider`, `tool_providers`, budgets, `endpoint`,
`instructions_file`, `skills` and `skill_pool`, the org's `run_config`, `schedule`, `runtime`,
`fence`, `federation` and `loadouts` are covered, and so is any field added later. A goal or
responsibilities edit needs no new signature. A definition with a `__proto__`, `constructor` or
`prototype` key is refused.

**The key and the signature:** an HMAC-SHA256 under the same machine-local key as
[`role set-access`](#role-set-access)'s full-access grants, created on first use in the
operator-credential directory (`~/.monomind/orgrt-operator/`, or `MONOMIND_ORGRT_OPERATOR_DIR`).
The signature is kept there too, in `org-signatures/<project id>/<org>.json`, not in the org file:
roles can neither read nor write that directory, a tracked org file is not changed, and a
signature does not carry over to another checkout or machine. The key and signature files must be
the operator's own, mode 0600 and not symlinks; a key replaced after a daemon loaded it is refused
until that daemon restarts. Each checkout (and each worktree
you run an org from) is signed separately.

**Who may sign:** `sign` refuses inside an org role's or `agent exec`'s process tree
(`MONOMIND_ORG_ROLE`, `MONOMIND_SDK_AGENT`, `MONOMIND_AGENT_EXEC`, `MONOMIND_CLINE_TURN`,
`MONOMIND_AIDER`). Unlike `role set-access … full`, it runs from your own Claude Code session.
`/mastermind:createorg` runs `org sign` without `--yes`, shows you the review and asks you to sign
in your own terminal. `org create` signs the org it writes.

**Why a role cannot sign, and what it sees (#643):** the operator directory is hidden from every
role sandbox on purpose, for reads and writes alike, because whoever can read the key can sign.
This is the rule, not a missing grant, and no role tier (QA included) is given access to it.
Where the sandbox mounts an empty tmpfs over the directory, a write there would appear to succeed
and then vanish with the command, so `sign` checks first: when the directory is hidden or
unreadable it refuses before writing anything, with `the operator-credential directory (…) is
protected from org roles … only the operator signs org definitions`. `org run` in a role, whose
org has no signature visible to it, prints the same explanation after its usual `org sign` hint.
A role that needs a live org (a QA drill, say) runs one the operator signed beforehand;
`org sign <org> --check` shows whether it is.

**Migration.** Orgs made before this release have no signature. `org run` on a TTY shows the
full review and offers a one-time sign for such an org, and signs the instructions files it
read for that review. A changed or unverifiable signature, or any run without
a TTY (`org serve`, a detached `org run`, the mastermind skills), is refused with the message
above. Run `monomind org sign --all` once per checkout, including for the shipped
`.monomind/orgs/*.json` and `config/orgs/release.json`, whose signatures are per machine and never
committed.

### The signable hash

The hash `--expect-hash` compares, `--check` reports and the signature records is:

1. **Parse** `.monomind/orgs/<org>.json` as JSON. A repeated key keeps its last value.
2. **Project** it: drop the top-level `goal` and `status`. If `roles` is an array, drop
   `title`, `responsibilities` and `ui` from each role object in it. Keep everything else,
   including fields monomind does not know.
3. **Digest the instructions files.** For each role in `roles` whose `instructions_file` is a
   string, add the entry `role:<id>`. For each entry `<name>` of the `loadouts` object whose
   `instructions_file` is a string, add `loadout:<name>`. The path is resolved against the
   project root. The value is `sha256:` followed by the lowercase hex SHA-256 of the file's
   content. monomind reads the file as UTF-8 and hashes that text as UTF-8, which for a valid
   UTF-8 file is the SHA-256 of its bytes. A file monomind refuses to read (outside the project,
   a symlink to a protected path, a hard link, missing) is recorded as `unreadable: <reason>`
   instead. A tool can't rebuild that reason, so take the `hash` from `--check` for such an org.
4. **Digest the blueprints.** For each role in `roles` whose `blueprint` is a string, add the
   entry `<blueprint>` (the name itself, once per name however many roles use it). The value is
   `sha256:` followed by the lowercase hex SHA-256 of the bytes of that blueprint's
   `blueprint.json`, the one a role would get its `skills` and `skill_pool` from at start. That
   file is found like this:
   - In the project's `.monomind/catalog/state.json` (it must parse and match its schema, where a
     name is `[a-z0-9][a-z0-9-]{0,63}`), take the entry in `entries` with `id`
     `blueprint:<name>`, `status` `"active"` and `"org"` in its `targets` array.
   - Its package directory is `.monomind/catalog/packages/<name>/<sha12>/`, where `<sha12>` is the
     first 12 characters of the entry's `sha256`. After resolving symlinks it must still lie inside
     `.monomind/catalog/packages/`, and must not itself be a symlink.
   - The package must still have the entry's `sha256`, the lowercase hex SHA-256 of this byte
     stream: list every regular file under the directory, recursing into subdirectories (other
     entry types add nothing; any symlink anywhere fails the package), as its path relative to the
     package directory with `/` between components. Sort the paths by UTF-16 code units. For each
     path, feed the UTF-8 path's byte length as a big-endian u32, the path's UTF-8 bytes, the
     file's byte length as a big-endian u64, then the file's bytes.
   - Its `blueprint.json` must parse as JSON (it need not be a valid blueprint; the digest is of
     the bytes either way).

   If any of this fails (no such entry, the package is missing, escapes the store, holds a symlink,
   has another digest, or its `blueprint.json` is missing or not JSON), the value is exactly the
   string `unavailable: not active for org on this machine`. Such an org can be signed, but `org
   run` refuses it until the blueprint is active again, and then its hash changes.
5. **Combine.** With no digests of either kind, the value to hash is the projection itself.
   Otherwise it is an object with `definition` (the projection), plus `instructions` (the
   instructions-file digests) if there is at least one, plus `blueprints` (the blueprint digests)
   if there is at least one: `{"blueprints": {<name>: <digest>}, "definition": <projection>,
   "instructions": {<key>: <digest>}}`, keys in the order of step 6. An org that names no
   blueprint hashes exactly as it did before blueprints were signed.
6. **Canonical JSON.** Order the keys of every object, at every depth, in two groups:
   - **Array-index keys come first, in ascending numeric order.** A key is an array index when
     it is the canonical decimal form of an integer from 0 to 4294967294 (2^32 − 2): only the
     digits `0`–`9`, no sign, no leading zero except the key `0` itself, and a value no greater
     than 4294967294. So `0`, `9`, `10` and `4294967294` are index keys; `01`, `-1`, `+1`, `1.0`,
     `1e3`, ` 1` and `4294967295` are not.
   - **Every other key follows, sorted by UTF-16 code units.** That is the byte order of the UTF-8
     keys unless a key holds a character above U+FFFF.

   For example, keys `b`, `10`, `9`, `a` give `{"9":1,"10":1,"a":1,"b":1}`, and keys `b`, `01`,
   `4294967295`, `4294967294`, `a`, `10` give
   `{"10":1,"4294967294":1,"01":1,"4294967295":1,"a":1,"b":1}`. (monomind sorts all keys by UTF-16
   code units and `JSON.stringify` then writes the array-index keys first, as every JavaScript
   object does. The order is kept as is, because existing signatures depend on it.) In Go,
   don't marshal a `map`, because `encoding/json` sorts map keys by bytes. Write each object
   yourself instead: split its keys with
   `isIndex(k) = k == "0" || (k[0] >= '1' && k[0] <= '9' && allDigits(k) && len(k) <= 10 && parseUint(k) <= 4294967294)`,
   sort the index keys by `parseUint` and the rest by their UTF-16 encoding
   (`utf16.Encode([]rune(k))`, compared element by element), and write the index keys and then
   the rest.

   Keep array order. Serialize with no whitespace, as ECMAScript `JSON.stringify` does:
   - Strings escape `"` and `\` as `\"` and `\\`, and use `\b` `\f` `\n` `\r` `\t` for those
     control characters. Any other character below U+0020 is `\u00xx` with lowercase hex. A
     lone surrogate is `\udxxx`. Every other character, including `<`, `>`, `&`, U+2028 and
     U+2029, is written as-is in UTF-8. Go's `encoding/json` escapes these last five, so turn
     off `SetEscapeHTML` and write U+2028/U+2029 raw.
   - Numbers are IEEE-754 doubles printed as ECMAScript `Number.prototype.toString` prints
     them: `1.0` → `1`, `1e2` → `100`, `1.5e-7` → `1.5e-7`, and `-0` → `0`. Go's
     `encoding/json` prints a `float64` the same way except `-0`, which it writes as `-0`.
   - `true`, `false` and `null` are literal.
7. **Hash:** the lowercase hex SHA-256 of that UTF-8 string, 64 characters.

For example, this org, with `boss.md` holding `Be the boss.\n`:

```json
{"name":"fx","goal":"ship it","roles":[
  {"id":"boss","type":"boss","reports_to":null,"title":"CEO","instructions_file":"boss.md"},
  {"reports_to":"boss","id":"dev","responsibilities":["code"],"policy":{"git":"read"}}]}
```

has the canonical JSON

```json
{"definition":{"name":"fx","roles":[{"id":"boss","instructions_file":"boss.md","reports_to":null,"type":"boss"},{"id":"dev","policy":{"git":"read"},"reports_to":"boss"}]},"instructions":{"role:boss":"sha256:272f6cf685a554faa4bc04a7890d434994aefcf98e9bfdfd339de87234e512cc"}}
```

and the hash `a895d86cd63d1374360add64ce590de7591895b523e53512f5a2d9257ddf7125`. Without the
`instructions_file`, the canonical JSON is the bare projection
`{"name":"fx","roles":[{"id":"boss","reports_to":null,"type":"boss"},{"id":"dev","policy":{"git":"read"},"reports_to":"boss"}]}`,
with the hash `2bb0a6ad90aa73e34b175333c401695c88079fb8faee131a43e27030689f247c`. A test pins
both (`org-sign-expect-hash.test.ts`), so the algorithm can't change silently.

With a blueprint: this org, whose active `org` blueprint `sec` has the `blueprint.json` bytes
`{"name":"sec","description":"Reviews code","skills":["audit"]}` (no trailing newline),

```json
{"name":"fx","goal":"ship it","roles":[
  {"id":"boss","type":"boss","reports_to":null,"title":"CEO","blueprint":"sec"}]}
```

has the canonical JSON

```json
{"blueprints":{"sec":"sha256:bef85f02692707ae3179d10366050315d13b4ecd6383eba0a90bc1212725dc53"},"definition":{"name":"fx","roles":[{"blueprint":"sec","id":"boss","reports_to":null,"type":"boss"}]}}
```

and the hash `2db4cf8c4596e17c97bd20a66d30c56cdaccf6bf9fc71a4e57adbadf2d7e7508`
(`org-signature-blueprint.test.ts` pins it). A changed `blueprint.json`, or another package
activated under the same name, changes the hash, so the org verifies as `changed` until you sign
it again; `org run` and `org reload` also refuse a blueprint whose bytes changed after the
signature was checked.

**Source:** [`commands/org-sign.ts → signAction`](packages/@monomind/cli/src/commands/org-sign.ts#signAction), [`orgrt/org-signature.ts → verifyOrgDef`](packages/@monomind/cli/src/orgrt/org-signature.ts#verifyOrgDef)


---

## `approve-paths`

List, or approve, paths that the org runtime would quarantine as possible plants (#502). A role
can create a protected path that did not exist yet — a `.mcp.json` or `.claude/` in the project,
`~/.claude/.config.json`, a shell or npm config — so the runtime quarantines one that appears
(see `doc/concepts/org-runtime.md`, "Planted paths"). A file you created yourself, or restored from
quarantine, is trusted only once you approve it here. Signing an org approves nothing.

```bash
monomind org approve-paths                  # list what is waiting; approves nothing
monomind org approve-paths .mcp.json ...    # approve exactly these paths
```

With paths, it asks on a TTY and refuses without one, and it refuses inside an org role's or
`agent exec`'s process tree (the same check as `sign`). A named path that is not waiting is left
unchanged and reported. `org sign`'s review warns when paths are waiting.

**Source:** [`commands/org-approve-paths.ts → approvePathsAction`](packages/@monomind/cli/src/commands/org-approve-paths.ts#approvePathsAction)
---

## Name Validation

Org names must match: `/^[a-z0-9][a-z0-9_-]*$/i`  
([`commands/org-control.ts → validateOrgName`](packages/@monomind/cli/src/commands/org-control.ts#validateOrgName))

This prevents path traversal attacks.
