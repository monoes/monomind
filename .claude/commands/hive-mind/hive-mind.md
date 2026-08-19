---
name: hive-mind:hive-mind
---

# hive-mind

Queen-led consensus-based multi-agent coordination system.

There is no `npx monomind hive-mind` CLI subcommand — hive-mind functionality
is available **exclusively via MCP tools** (`mcp__monomind__hive-mind_*`).
Invoke the tools directly, or use one of the slash commands in this
directory, which call the tools for you.

## Real Tools (11 total)

| Tool | Description |
|---|---|
| `hive-mind_init` | Create the hive state file (topology, consensus strategy, empty worker list) |
| `hive-mind_spawn` | Write worker agent records into the agent store and register them on the hive |
| `hive-mind_status` | Read hive status: queen, workers, task/consensus metrics |
| `hive-mind_join` | Add an existing agent id to the hive's worker list |
| `hive-mind_leave` | Remove an agent id from the hive's worker list |
| `hive-mind_consensus` | Propose/vote/check status on threshold-based decisions |
| `hive-mind_broadcast` | Write a message into the hive's shared memory for all workers to read |
| `hive-mind_memory` | Get/set/delete/list keys in the hive's shared memory namespace |
| `hive-mind_audit_list` | List signed consensus decision records |
| `hive-mind_audit_verify` | Verify a consensus decision's vote/record signatures |
| `hive-mind_shutdown` | Clear hive workers from the agent store and reset hive state |

## Topologies (`hive-mind_init`'s `topology` param)

| Topology | Description |
|---|---|
| `hierarchical` | Queen controls workers directly — tight coordination for small teams |
| `mesh` | Peer-to-peer coordination among all agents |
| `ring` | Circular communication pattern |
| `star` | Central coordinator with spokes |

## Consensus Strategies (`hive-mind_consensus`'s `strategy` param)

All of these are single-process vote-threshold bookkeeping over one JSON
state file — not real distributed consensus protocols (no leader election,
log replication, or network model). Names are kept for compatibility.

| Strategy | Description |
|---|---|
| `bft` (CLI-facing name: `byzantine`) | Requires 2f+1 votes — tolerates f < n/3 faulty agents (default) |
| `raft` | Majority vote — tolerates f < n/2 |
| `quorum` | Configurable threshold preset: `unanimous`, `majority`, `supermajority` |

`gossip` and `crdt` are planned but not implemented — both `hive-mind_init`
and `hive-mind_consensus` reject them with an error.

## Quick Start

```javascript
// 1. Initialize hive with recommended topology
mcp__monomind__hive-mind_init({ topology: "hierarchical", consensus: "byzantine" })

// 2. Register worker agents into the hive
mcp__monomind__hive-mind_spawn({ count: 5, role: "specialist" })

// 3. Check status
mcp__monomind__hive-mind_status({ verbose: true })

// 4. Shut down when done
mcp__monomind__hive-mind_shutdown({ graceful: true })
```

Note: `hive-mind_spawn` only writes bookkeeping records into the agent store
and the hive's worker list — it does not start any process, thread, or
agent. Real concurrency comes from Claude Code's Task tool.
