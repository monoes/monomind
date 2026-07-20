# Org Runtime v2

> `monomind org` — the SDK-backed daemon that runs autonomous agent organizations. This page covers the architecture and operational details behind the summary in the README's "Autonomous Organizations" section.

---

## Architecture

Each role in an org is a **live, in-process Claude Agent SDK session** — not a subprocess, not a simulated actor. Roles are started via `runAgentSession`, which wraps `@anthropic-ai/claude-agent-sdk`'s `query`/`tool`/`createSdkMcpServer` primitives. The `OrgDaemon` hosts one or more orgs in a single Node process.

**Inter-role communication:**
- The `org_send` SDK tool lets one role message another (or another org, `org:role`) — the only inter-agent channel by design.
- Delivery runs through a Mailbox / OrgBus pub-sub layer inside the daemon process — not a queue or external broker.

**Tools available to every role agent:**
- `ask_human` — pause and request a human answer (see Human-in-the-Loop below)
- `org_recall` / `org_remember` / `org_learn` — cross-run knowledge-graph memory, scoped by `memory_namespace`
- `knowledge_search` — semantic search over the Second Brain (project docs + the user's global brain)

This is a different model from the legacy v1 orchestration path (see Mastermind Skill Layer below), which spawned a single Claude-Code Task-tool "boss" agent coordinating work over a monotask board — no live SDK sessions per role, no `org_send`/Mailbox mechanism.

---

## CLI Subcommands (16)

`monomind org <subcommand>`: `run` [--dry-run], `stop`, `status`, `serve`, `test-loop`, `logs`, `report`, `memory`, `questions`, `answer`, `create`, `validate`, `migrate`, `list`, `delete`, `mark-complete`.

`org memory` is the newest addition — some docs/configs still say "15 subcommands"; the correct count is **16**.

### `org memory <name>` detail

- `stats` (default) — knowledge-graph node/edge/rule counts, plus per-namespace entry counts
- `search <query>` — search cross-run memory
- `rules` — list up to 50 stored "when X do Y" rules learned across runs
- `rollback <run-ref>` — undo what a specific run wrote to memory

---

## Human-in-the-Loop Flow

1. A role agent calls the `ask_human` tool with a question.
2. The question is appended to that org's `questions.json`, and a dashboard SSE event fires immediately so the live dashboard shows it without polling.
3. `monomind org questions <name>` reads pending questions from disk.
4. `monomind org answer <name> <id> "<text>"` delivers the answer:
   - **Live**, if the org is currently running (the daemon picks it up immediately)
   - **Queued offline** otherwise — the answer is written to disk and consumed the next time that org starts

---

## Config Schema

Org definitions (`.monomind/orgs/<name>.json`) support:

| Field | Default | Purpose |
|---|---|---|
| `budget_tokens` | 1,000,000 | Token spend ceiling for the org run |
| `memory_namespace` | — | Scopes `org_recall`/`org_remember`/`org_learn` to this org's slice of cross-run memory |
| `max_turns_per_message` | 30 | Cap on agent turns per inbound message, to bound runaway loops |
| `max_concurrent_agents` | 4 | How many role sessions can run at once |
| `idle_minutes` | — | Idle timeout before a role session is considered stalled |

---

## Mastermind Skill Layer

- **`/mastermind:runorg`** — delegates directly to the Org Runtime v2 daemon (same path as `monomind org run`). No boss agent, no monotask board, no manual curl calls.
- **`/mastermind:runorgv1`** (`LEGACY-ORG-V1`) — the separate, pre-v2 prompt-orchestrated path: a Task-tool boss agent coordinating roles over a monotask board, with dashboard events posted via manual curl calls (no delivery guarantees, no ground-truth event stream). Reachable only by this explicit `v1` name; refuses to run against v2-shaped org configs. Kept only for orgs not yet migrated off the v1 `topology`/`board_id`/`communication` config shape.

---

## Known Historical Trap — Scoped to v1 Only

Early org-dashboard debugging (see `docs/adrs/org-dashboard-v2-design.md`, Issue 21 and FA-1/FA-2) uncovered that `runorg.md`'s old Step-2-bash-to-Task-tool handoff lost `runId`/`sessionId` because Claude Code truncates long bash stdout — the fix was writing a `<org>-runcontext.json` context file to disk instead of relying on stdout (`ORG_VARS` block) or Task-prompt template substitution.

**This trap is scoped only to the legacy v1 skill path** (`runorg.md` → Task-tool boss). The current Org Runtime v2 source (`packages/@monomind/cli/src/orgrt/`) has zero references to either `runcontext.json` or `ORG_VARS` stdout parsing — v2 doesn't use a bash-to-Task handoff at all, so this specific failure mode does not apply to it. Don't cite this trap when debugging v2/orgrt issues.
