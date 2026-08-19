---
name: hive-mind-advanced
description: |
  Advanced Hive Mind collective intelligence system for queen-led multi-agent coordination with consensus mechanisms and persistent memory
---

# Hive Mind Advanced Skill

Queen-led multi-agent coordination with shared JSON state, threshold-based voting, and a collective memory blob. Use when a task needs a declared coordinator (queen) plus N workers who must reach a documented decision before proceeding.

## What Hive-Mind Is — and Is Not

**Is:** An MCP-only surface that tracks queen + workers, proposals/votes, and a shared key/value blob in a single JSON state file at `.monomind/hive-mind/state.json`. Real execution happens in Claude Code Task-tool agents; the hive only records bookkeeping.

**Is not:** A distributed system. The consensus strategies (`bft` / `raft` / `quorum`) are **vote-count thresholds applied to one in-process tally** — not Raft leader election, not Byzantine agreement, not Paxos. There is no log replication, no network model, no adversarial fault model. The strategy names are kept for CLI/API compatibility; see the honesty note in `packages/@monomind/cli/src/mcp-tools/hive-mind-tools.ts:2-12`.

If you need to actually coordinate work in parallel, use `monomind swarm` (real CLI) — see "Swarm vs Hive-Mind" below.

## Visibility Requires `MONOMIND_MCP_SPECULATIVE=1`

Only two hive-mind tools are visible to MCP clients by default: `hive-mind_status` and `hive-mind_join`. To see and call the full surface (`init`, `spawn`, `consensus`, `memory`, `broadcast`, `shutdown`, `audit_*`), the MCP server must run with:

```bash
MONOMIND_MCP_SPECULATIVE=1
```

If a tool returns "unknown tool" or isn't listed, this flag is missing. Set it on the `mcp start` invocation (e.g. in `claude mcp add monomind -- env MONOMIND_MCP_SPECULATIVE=1 npx -y monomind@latest mcp start`).

## Core Concepts

### Queen / Worker Roles

- **Queen** — the agent ID recorded as hive coordinator at `hive-mind_init`. Pure bookkeeping label; the queen has no special powers in code. Strategic/tactical/adaptive "queen types" from older docs are **not implemented** — pick the queen by passing its `queenId`.
- **Worker** — generalist agent joined to the hive.
- **Specialist** — worker with a defined specialty.
- **Scout** — worker role for exploration / information gathering.

### Topologies (recorded on state, not enforced)

`mesh`, `hierarchical`, `ring`, `star`. The topology is a label stored on the state file; nothing in the hive-mind tools routes messages differently based on it. Real coordination topology comes from how **you** spawn and instruct Task-tool agents.

### Consensus Strategies — Honest Definitions

Source: `hive-mind-tools.ts:98-124` and `hive-mind_consensus` description at `hive-mind-tools.ts:662-663`.

| Strategy | Required votes to resolve | Tolerates | Notes |
|---|---|---|---|
| `bft` (CLI alias: `byzantine`) | `floor(2n/3) + 1` | `f < n/3` "faulty" voters | Cross-proposal conflicting votes are flagged in `byzantineVoters`. Still a single-process tally. |
| `raft` | `floor(n/2) + 1` (majority) | `f < n/2` | One pending proposal per `term`. Re-proposal timeout defaults to 30s. No leader election. |
| `quorum` | Configurable preset | depends on preset | Presets: `majority`, `supermajority`, `unanimous`. `unanimous` rejects on the first dissent. |

**Not implemented:** `gossip` and `crdt`. Passing them to `hive-mind_init` or `hive-mind_consensus` returns an explicit error.

**O-Information anti-groupthink gate** (`minDivergenceRounds`, optional): forces a proposal to wait through N rounds of non-unanimous votes before it can resolve, even if the threshold is already met. Source: arXiv:2510.05174. Off by default.

## Swarm vs Hive-Mind — Pick the Right Surface

| Need | Use |
|---|---|
| Real CLI to register agents, set topology, run an objective | `monomind swarm init/start/status/stop` (real commands) |
| Threshold-vote a decision and keep an audit trail | `mcp__monomind__hive-mind_*` (this skill) |
| Both at once | Initialize a swarm for execution **and** a hive-mind for the decision record |

Hive-mind tools do **not** spawn processes. `hive-mind_spawn` writes agent records into the agent store and joins their IDs to the hive state file — actual work happens in Task-tool agents you start yourself.

## MCP Tool Reference

All tools are called as `mcp__monomind__<tool_name>` from inside Claude Code.

### Lifecycle

```
mcp__monomind__hive-mind_init {
  topology: "mesh" | "hierarchical" | "ring" | "star",   // default: mesh
  queenId: "<agent-id>",                                  // default: queen-<ts>
  consensus: "byzantine" | "bft" | "raft" | "quorum",     // default: byzantine
  maxAgents: 15,                                          // default: 15
  persist: true,
  memoryBackend: "hybrid"
}
```

Persists `state.json` with empty workers. Returns `hiveId`, elected queen, and the resolved consensus strategy. The strategy chosen here governs `hive-mind_consensus` propose/vote when the caller doesn't pass one explicitly.

```
mcp__monomind__hive-mind_spawn {
  count: 1,                                    // 1-20 per call
  role: "worker" | "specialist" | "scout",     // default: worker
  agentType: "worker",                         // recorded on agent record
  prefix: "hive-worker"                        // agent-id prefix
}
```

Creates agent records **and** joins them to the hive in one call. Caps: 20 workers per call, 100 workers max in the hive.

```
mcp__monomind__hive-mind_join   { agentId, role }    // join an existing agent
mcp__monomind__hive-mind_leave  { agentId }          // remove from hive
```

Use `join` when the agent was created elsewhere (e.g. via `monomind agent spawn`). `agentId` must match `^[a-zA-Z0-9_-]+$` and is capped at 128 chars.

```
mcp__monomind__hive-mind_shutdown { graceful: true, force: false }
```

Removes worker records from the agent store and clears pending proposals. Graceful shutdown refuses to run with pending proposals unless `force: true`. Consensus **history** is kept for audit.

### Status & Memory

```
mcp__monomind__hive-mind_status { verbose: false }
```

Returns hive state: queen, worker count, pending/history proposals, and task counters computed from the task store.

```
mcp__monomind__hive-mind_memory {
  action: "get" | "set" | "delete" | "list",
  key: "<string>",         // required for get/set/delete, ≤256 chars
  value: <any>             // required for set, ≤1 MiB string or any JSON
}
```

Plain key/value blob on `state.sharedMemory`. Bounded: 1000 keys max, 1 MiB per string value. `set` also mirrors the entry into the searchable memory bridge (`namespace: hive-memory`) so `memory search` can find it. This is **not** a replicated KV store — it's JSON on disk.

```
mcp__monomind__hive-mind_broadcast {
  message: "<text>",                          // ≤1 MiB
  priority: "low" | "normal" | "high" | "critical",
  fromId: "<agent-id>"
}
```

Appends to a capped 100-entry noticeboard on `state.sharedMemory.broadcasts`. **Not message delivery** — no listener is notified. A worker sees a broadcast only when something later reads `hive-mind_status` or `hive-mind_memory get`. `recipients` in the response is just `state.workers.length`.

### Consensus

```
mcp__monomind__hive-mind_consensus {
  action: "propose" | "vote" | "status" | "list",
  // propose:
  type: "<proposal-type>",       // ≤128 chars, e.g. "architecture"
  value: <any>,                  // ≤64 KiB if string
  voterId: "<agent-id>",         // recorded as proposedBy
  strategy: "bft" | "raft" | "quorum",     // default: from hive-mind_init, then "raft"
  quorumPreset: "majority" | "supermajority" | "unanimous",
  term: 1,                       // raft only
  timeoutMs: 30000,              // raft re-proposal timeout
  minDivergenceRounds: 0,        // O-Information gate, default 0 (off)
  // vote / status:
  proposalId: "<id>",
  vote: true | false
}
```

**propose** creates a pending proposal, computes required votes from current worker count, and (for raft) blocks duplicate proposals in the same term. **vote** records a boolean vote and tries to resolve: approved if `votesFor >= required`, rejected if `votesAgainst >= required` (or, for `unanimous`, on any dissent). Deadlock (neither side can reach threshold) rejects. **status** / **list** read pending and historical proposals.

Each resolved decision is HMAC-signed and appended to a tamper-evident JSONL audit trail at `.monomind/consensus/`. The signing secret comes from `MONOMIND_SESSION_SECRET` if set, otherwise a per-project generated secret at `.monomind/hive-mind/session-secret`.

### Audit

```
mcp__monomind__hive-mind_audit_list   { swarmId?, limit: 50 }   // max 500
mcp__monomind__hive-mind_audit_verify { decisionId }
```

List signed decision records, or verify that all vote signatures and the record signature on a specific decision still validate against the project secret.

## Workflow Patterns

### Pattern 1: Decide-then-Build (queen + workers + vote)

Use when an architectural choice must be documented before implementation begins.

```
# 1. Initialize hive with a known queen and byzantine threshold
mcp__monomind__hive-mind_init {
  topology: "hierarchical",
  queenId: "architect-1",
  consensus: "byzantine"
}

# 2. Spawn or join workers (specialist role for SMEs)
mcp__monomind__hive-mind_spawn { count: 4, role: "specialist", agentType: "reviewer" }

# 3. Queen proposes the architecture decision
mcp__monomind__hive-mind_consensus {
  action: "propose",
  type: "architecture",
  value: { pattern: "modular-monolith", modules: ["auth","billing","shipping"] },
  voterId: "architect-1"
}
# → returns proposalId

# 4. Each worker votes (in parallel Task-tool agents)
mcp__monomind__hive-mind_consensus {
  action: "vote", proposalId: "<id>",
  vote: true, voterId: "reviewer-2"
}

# 5. Once threshold reached, store the decision rationale
mcp__monomind__hive-mind_memory {
  action: "set", key: "decision-architecture-v1",
  value: { summary: "...", proposalId: "<id>", decidedAt: "..." }
}

# 6. Spin up a real swarm to execute, sharing the decision via memory namespace
#    (CLI)
npx monomind@latest swarm init --topology hierarchical --max-agents 6
npx monomind@latest swarm start --objective "Implement modular monolith per decision-architecture-v1"
```

### Pattern 2: Release Gate (raft majority for go/no-go)

```
mcp__monomind__hive-mind_init { topology: "star", queenId: "release-manager", consensus: "raft" }
mcp__monomind__hive-mind_spawn { count: 3, role: "specialist", agentType: "reviewer" }

# One proposal per term — propose "ship v2.9.5"
mcp__monomind__hive-mind_consensus {
  action: "propose", type: "release-gate",
  value: { version: "2.9.5" }, voterId: "release-manager", term: 1
}
# Reviewers vote; majority of 4 nodes = 3 votes needed
```

If the term times out (30s default), re-propose with `term: 2`.

### Pattern 3: Unanimous Consent (quorum/unanimous for high-bar decisions)

```
mcp__monomind__hive-mind_consensus {
  action: "propose", type: "policy-change",
  value: "...", strategy: "quorum", quorumPreset: "unanimous",
  voterId: "queen-1"
}
# Any single dissent rejects the proposal immediately.
```

### Pattern 4: Shared Scratchpad (no voting, just memory)

For loose coordination without a formal vote — skip consensus entirely.

```
mcp__monomind__hive-mind_init { topology: "mesh", queenId: "coord-1", consensus: "raft" }
mcp__monomind__hive-mind_join { agentId: "agent-a", role: "worker" }
mcp__monomind__hive-mind_join { agentId: "agent-b", role: "worker" }

# Agents write findings into shared memory via MCP, in their Task-tool bodies
mcp__monomind__hive-mind_memory { action: "set", key: "auth-findings", value: { ... } }
mcp__monomind__hive-mind_memory { action: "list" }
```

## Configuration

The hive config is the `state.json` written by `hive-mind_init`. There is no separate config file. Notable fields persisted:

| Field | Meaning |
|---|---|
| `hiveId` | Random `hive-<ts>-<rand>` identifier |
| `topology` | One of `mesh` / `hierarchical` / `ring` / `star` (label only) |
| `queen` | `{ agentId, electedAt, term }` |
| `consensusStrategy` | `bft` / `raft` / `quorum` — the default for `hive-mind_consensus` |
| `workers` | Array of joined agent IDs (≤100) |
| `sharedMemory` | Free-form key/value object (≤1000 keys) |
| `consensus.pending` / `consensus.history` | Open and resolved proposals (history capped at 1000) |

Hive state file is capped at 10 MiB; larger files are treated as corrupt and reset to defaults.

## Best Practices

### 1. Pick the strategy by decision shape

- **High-bar policy / breaking change** → `quorum` with `unanimous` or `supermajority`
- **Adversarial review with distrusted input** → `bft` (raises threshold to 2/3, flags conflicting voters)
- **Standard majority decision** → `raft` (simple majority, one proposal per term)
- **Quick informal coordination** → skip consensus, use `hive-mind_memory` only

### 2. Initialize before spawn/join

`spawn`, `join`, `consensus`, `broadcast`, and `memory` all error with `"Hive-mind not initialized"` until `hive-mind_init` has written `state.json`.

### 3. Set `MONOMIND_MCP_SPECULATIVE=1` once, up front

Without it only `status` and `join` are exposed. If `init`, `spawn`, `consensus`, `memory`, `broadcast`, `shutdown`, or `audit_*` are reported as unknown tools, the flag is missing.

### 4. Real parallelism comes from Task-tool agents

`hive-mind_spawn` writes records; it does not start anything. For each worker, spawn a Task-tool agent with `run_in_background: true` in **one** message, and let each agent call `hive-mind_consensus vote` / `hive-mind_memory set` via MCP from inside its work.

### 5. Don't use the broadcast tool as a message bus

`hive-mind_broadcast` is a noticeboard, not delivery. For real task assignment use `mcp__monomind__task_create` / `task_assign`, or pass instructions in each Task-tool agent's prompt directly.

### 6. Verify important decisions cryptographically

For any decision that will be cited later (release gates, architecture calls), record the `decisionId` and run `hive-mind_audit_verify` after the fact to prove the vote signatures still validate.

## Troubleshooting

### "Hive-mind not initialized"

Run `mcp__monomind__hive-mind_init` first. The state file lives at `.monomind/hive-mind/state.json` — if it's missing or >10 MiB, the hive resets to the uninitialized default.

### "Consensus strategy X is not implemented"

`gossip` and `crdt` are rejected. Use `bft`, `raft`, or `quorum` (`byzantine` is accepted as an alias for `bft` at init time only).

### "Raft term N already has a pending proposal"

Either wait for the current proposal in that term to resolve, re-propose with a higher `term`, or switch strategy. One pending raft proposal per term is allowed.

### "Cannot gracefully shutdown with N pending consensus items"

Resolve the proposals (vote them through or let them reject) or pass `force: true`.

### "Shared memory full (max 1000 keys)"

Delete unused keys with `hive-mind_memory delete`, or move bulk context to the regular memory store (`mcp__monomind__memory_pattern-store`) under a hive namespace.

### Tool isn't visible

Set `MONOMIND_MCP_SPECULATIVE=1` on the MCP server process. Only `hive-mind_status` and `hive-mind_join` are unconditionally visible.

## Related Skills

- `swarm-orchestration` — real CLI swarm coordination (the execution side)
- `swarm-advanced` — advanced swarm patterns
- `mastermind-debug` — systematic root-cause debugging protocol
- `verification-quality` — truth scoring and rollback

## References

- Implementation: `packages/@monomind/cli/src/mcp-tools/hive-mind-tools.ts`
- Honest scope note: `hive-mind-tools.ts:2-12`
- Vote-threshold math: `hive-mind-tools.ts:98-124`
- Consensus description: `hive-mind-tools.ts:662-663`
- State file: `.monomind/hive-mind/state.json` (capped at 10 MiB)
- Audit trail: `.monomind/consensus/` (HMAC-signed JSONL)
- Concepts doc: `doc/concepts/swarm.md` (Hive-Mind Consensus section)

---

**Skill Version**: 2.0.0
**Last Updated**: 2026-08-12
**Maintained By**: Monomind Team
