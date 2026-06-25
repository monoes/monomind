---
name: hive-mind:hive-mind
---

# hive-mind

Queen-led consensus-based multi-agent coordination system.

## Usage
```bash
npx monomind hive-mind <subcommand> [options]
```

## Subcommands

| Subcommand | Description |
|---|---|
| `init` | Initialize hive mind with topology and consensus settings |
| `spawn` | Spawn worker agents; use `--claude` to launch Claude Code as Queen |
| `status` | Show hive status, workers, and metrics |
| `task` | Submit a task to the hive for distributed execution |
| `join` | Add an existing agent to the hive |
| `leave` | Remove an agent from the hive |
| `consensus` | Manage consensus proposals and voting |
| `broadcast` | Broadcast a message to all workers |
| `memory` | Access and manage hive shared memory |
| `optimize-memory` | Optimize hive memory patterns and consolidation |
| `shutdown` | Gracefully shutdown the hive mind |

## Topologies

| Topology | Description |
|---|---|
| `hierarchical` | Queen controls workers directly — tight coordination for small teams |
| `mesh` | Peer-to-peer coordination among all agents |
| `hierarchical-mesh` | Queen + peer communication — recommended for 10+ agents |
| `adaptive` | Dynamic topology based on task load |

## Consensus Strategies

| Strategy | Description |
|---|---|
| `byzantine` | BFT — tolerates f < n/3 faulty agents (default) |
| `raft` | Leader-based — tolerates f < n/2 |
| `gossip` | Eventually consistent, scales well |
| `crdt` | Conflict-free replicated data types |
| `quorum` | Simple majority voting |

## Quick Start

```bash
# 1. Initialize hive with recommended topology
npx monomind hive-mind init -t hierarchical-mesh -c byzantine

# 2. Spawn workers
npx monomind hive-mind spawn -n 5 -r specialist

# 3. (Optional) Launch Claude Code as the Queen coordinator
npx monomind hive-mind spawn --claude -o "Build a REST API with auth"

# 4. Check status
npx monomind hive-mind status --detailed

# 5. Submit a task
npx monomind hive-mind task -d "Implement authentication module" -p high

# 6. Shutdown when done
npx monomind hive-mind shutdown --save-state
```

## MCP Tools

All subcommands call their corresponding MCP tool:

```
mcp__monomind__hive-mind_init
mcp__monomind__hive-mind_spawn
mcp__monomind__hive-mind_status
mcp__monomind__hive-mind_task
mcp__monomind__hive-mind_join
mcp__monomind__hive-mind_leave
mcp__monomind__hive-mind_consensus
mcp__monomind__hive-mind_broadcast
mcp__monomind__hive-mind_memory
mcp__monomind__hive-mind_optimize-memory
mcp__monomind__hive-mind_shutdown
```
