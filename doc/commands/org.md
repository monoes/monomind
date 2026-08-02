# `monomind org` — Command Reference

> **27 subcommands** for starting, stopping, monitoring, and managing autonomous agent
> organizations. All commands target a named org config in `.monomind/orgs/<name>.json`.

---

## Subcommand Index

| Subcommand | Purpose |
|---|---|
| [`run`](#run) | Start org foreground daemon |
| [`stop`](#stop) | Stop a running org |
| [`pause`](#pause) | Pause org (suspend message delivery) |
| [`resume`](#resume) | Resume a paused org |
| [`status`](#status) | Show org runtime status |
| [`serve`](#serve) | Long-running daemon for multiple/scheduled orgs |
| [`supervisor`](#supervisor) | Generate launchd/systemd unit for persistent serve |
| [`test-loop`](#test-loop) | Run org test loop |
| [`logs`](#logs) | Stream or filter bus.jsonl event log |
| [`report`](#report) | Summarize a run (cost, tokens, assets, crashes) |
| [`memory`](#memory) | Cross-run knowledge-graph memory |
| [`costs`](#costs) | Per-role cost tracking |
| [`flow`](#flow) | Export Mermaid message flow diagram |
| [`questions`](#questions) | List pending ask_human questions |
| [`answer`](#answer) | Deliver answer to an ask_human question |
| [`approve`](#approve) | Approve pending tool guardrail |
| [`deny`](#deny) | Deny pending tool guardrail |
| [`replay`](#replay) | Time-travel debug from a run ID |
| [`resume-from`](#resume-from) | Alias for replay |
| [`branch`](#branch) | Create what-if branch from checkpoint |
| [`decisions`](#decisions) | Show rifft-style decision traces |
| [`create`](#create) | Scaffold org from template |
| [`validate`](#validate) | Validate org config(s) against schema |
| [`migrate`](#migrate) | Convert v1 org config to v2 shape |
| [`list`](#list) | List all org configs |
| [`delete`](#delete) | Delete org and all artifacts |
| [`mark-complete`](#mark-complete) | Clear stale running/crashed runtime record |

---

## `run`

Start an org in the **foreground**. If a live `org serve` daemon is detected (via heartbeat),
the task is sent as a runfile to the daemon instead of competing with it.

```bash
monomind org run <name> [--task "..."] [--cross-process] [--dry-run]
```

| Flag | Purpose |
|---|---|
| `--task "..."` | Override the org's `goal` for this run |
| `--cross-process` | Register with broker for cross-daemon `org_send` delivery |
| `--dry-run` | Validate config and print plan without starting |

**Source:** [`commands/org.ts:L84`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/commands/org.ts#L84)

---

## `stop`

Write a stopfile to `.monomind/orgs/<name>/stop`. The daemon picks it up within 2s.
Validates that `runtime.json` PID is alive before writing the stopfile.

```bash
monomind org stop <name>
```

**Source:** [`commands/org.ts:L199`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/commands/org.ts#L199)

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

## `status`

Read `runtime.json` for each org and display a live summary.

```bash
monomind org status [<name>]
```

Shows: elapsed time, events, messages, tool calls, roles, tokens used, cost in USD.
Detects stale PIDs (process no longer alive).

**Source:** [`commands/org.ts:L262`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/commands/org.ts#L262)

---

## `serve`

Long-running daemon that hosts **all scheduled orgs** and responds to runfiles/stopfiles.

```bash
monomind org serve [--forward <url>]
```

- Polls stopfiles every 2 seconds (`pollStopfiles()`).
- Polls runfiles every 2 seconds (`pollRunfiles()`).
- Writes heartbeat to `serve-heartbeat.json` every 30 seconds.
- Runs `OrgScheduler` for orgs with a `schedule` field.

**Source:** [`commands/org.ts:L549`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/commands/org.ts#L549)

---

## `supervisor`

Emit a launchd plist (macOS) or systemd unit (Linux) for persistent `org serve`.

```bash
monomind org supervisor <name> [--install]
```

| Flag | Purpose |
|---|---|
| `--install` | Write the unit to the system location directly |

Generates a per-project slug from a SHA256 hash of the current working directory.

**Source:** [`commands/org.ts:L450`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/commands/org.ts#L450)

---

## `test-loop`

Run the org's test loop (delegates to `orgrt/test-loop.ts::runTestLoop()`).

```bash
monomind org test-loop <name>
```

**Source:** [`commands/org.ts:L705`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/commands/org.ts#L705)

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

**Source:** [`commands/org.ts:L1012`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/commands/org.ts#L1012)

---

## `costs`

Per-role cost tracking from `runtime.json`.

```bash
monomind org costs <name> [--run <run-id>]
```

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
monomind org questions <name>
```

Questions are stored in `<org>/questions.json`. Each entry has an `id`, `role`, `text`,
and `timestamp`.

---

## `answer`

Deliver a human answer to a pending `ask_human` question.

```bash
monomind org answer <name> <question-id> "<answer text>"
```

- **Live delivery** if the org is running.
- **Queued to disk** if the org is stopped (consumed on next start).

---

## `approve`

Approve a pending tool guardrail decision.

```bash
monomind org approve <name> <decision-id>
```

---

## `deny`

Deny a pending tool guardrail decision.

```bash
monomind org deny <name> <decision-id>
```

---

## `replay`

Time-travel debugging — re-emit all bus events from a historical run.

```bash
monomind org replay <name> --run <run-id>
```

**Source:** [`daemon.ts:L926`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/daemon.ts#L926) (`replayFrom()`)

---

## `resume-from`

Alias for `replay`.

```bash
monomind org resume-from <name> --run <run-id>
```

---

## `branch`

Create a what-if branch from a checkpoint for divergent experimentation.

```bash
monomind org branch <name> --run <run-id>
```

**Source:** [`daemon.ts:L1580`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/orgrt/daemon.ts#L1580) (`branchCheckpoint()`)

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
monomind org create <name> [--template content-team|dev-team|research-pod]
```

Templates available: `content-team`, `dev-team`, `research-pod`.

---

## `validate`

Validate one or all org config files against the Zod schema.

```bash
monomind org validate [<name>]    # validates one or all orgs
```

---

## `migrate`

Convert a v1 org config (`topology`/`board_id`/`communication` shape) to the v2 daemon shape.

```bash
monomind org migrate <name>
```

Saves a backup as `<name>.v1.json` before overwriting.

**Source:** [`commands/org.ts:L895`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/commands/org.ts#L895)

---

## `list`

List all org configs with their role count, schedule, and current status.

```bash
monomind org list
```

Excludes artifact suffixes (`-state`, `-goals`, `-threads`, etc.) and `.v1.json` backups.

**Source:** [`commands/org.ts:L718`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/commands/org.ts#L718)

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

**Source:** [`commands/org.ts:L759`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/commands/org.ts#L759)

---

## `mark-complete`

Clear a stale `running` or `crashed` record from `runtime.json` and POST to dashboard.

```bash
monomind org mark-complete <name>
```

Writes `{status:'stopped', closedBy:'mark-complete'}` to `runtime.json`.

**Source:** [`commands/org.ts:L830`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/commands/org.ts#L830)

---

## Name Validation

Org names must match: `/^[a-z0-9][a-z0-9_-]*$/i`  
([`commands/org.ts:L20`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/commands/org.ts#L20))

This prevents path traversal attacks.
