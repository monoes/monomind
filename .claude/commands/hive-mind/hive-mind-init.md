---
name: hive-mind:hive-mind-init
---

# hive-mind init

Initialize a hive mind with topology and consensus settings.

There is no `npx monomind hive-mind init` CLI command — this is invoked
directly as an MCP tool call:

```javascript
mcp__monomind__hive-mind_init({
  topology: "hierarchical",
  consensus: "byzantine",
  maxAgents: 15,
  persist: true,
  memoryBackend: "hybrid"
})
```

## Parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `topology` | string | `mesh` | Hive topology: `mesh`, `hierarchical`, `ring`, `star` |
| `consensus` | string | `byzantine` | Consensus strategy: `byzantine` (internal name `bft`), `raft`, `quorum` |
| `maxAgents` | number | `15` | Maximum number of agents (bookkeeping only, not enforced by a scheduler) |
| `persist` | boolean | `true` | Whether to persist hive state to disk |
| `memoryBackend` | string | `hybrid` | Label stored with the hive config — not validated against a real backend list |
| `queenId` | string | `queen-<timestamp>` | Initial queen agent ID |

`gossip` and `crdt` are **not implemented** — passing either as `consensus`
is rejected with an error listing the supported set (`byzantine`, `bft`,
`raft`, `quorum`).

## Examples

```javascript
// Initialize with recommended settings
mcp__monomind__hive-mind_init({})

// Initialize hierarchical topology with Byzantine consensus
mcp__monomind__hive-mind_init({ topology: "hierarchical", consensus: "byzantine" })

// Larger hive with raft consensus
mcp__monomind__hive-mind_init({ topology: "mesh", consensus: "raft", maxAgents: 20 })

// Minimal hive with no persistence
mcp__monomind__hive-mind_init({ topology: "hierarchical", consensus: "raft", persist: false })
```

## Topology Guide

- **`hierarchical`** — Queen controls workers directly. Best for small teams (< 8 agents). Prevents drift.
- **`mesh`** — Fully connected peers. Best when all agents are equals.
- **`ring`** — Circular communication pattern.
- **`star`** — Central coordinator with spokes.

## Consensus Guide

- **`byzantine` / `bft`** — Requires 2f+1 votes. Tolerates f < n/3 faulty agents. Default.
- **`raft`** — Majority vote. Tolerates f < n/2.
- **`quorum`** — Configurable threshold preset (`unanimous`, `majority`, `supermajority`).

These are single-process vote-threshold implementations over one JSON state
file, not real distributed consensus protocols (no leader election, log
replication, or network model) — see CLAUDE.md's Hive-Mind Consensus section.
