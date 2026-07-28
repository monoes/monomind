# Swarm & Hive-Mind

> **Status: experimental.** Monomind's swarm and hive-mind systems provide in-process multi-agent coordination — topology bookkeeping, agent lifecycle, task orchestration, and vote-count "consensus" — inside a single Node process. They are not distributed systems: there is no networking between separate machines, and the consensus strategies are vote-count thresholds, not distributed consensus protocols.

---

## What It Actually Is

- **In-process coordination** — swarm state (topology, agents, tasks) lives in one process and is persisted to `.monomind/swarm/`.
- **Real work happens via Claude Code's Task tool** — the swarm layer coordinates; spawned agents do the actual execution.
- **"Consensus" = vote counting** — proposals collect votes from registered agents in the same process and pass when a threshold is met (see below).

---

## Topologies

| Topology | When to use |
|---|---|
| `hierarchical` | Default — feature dev, clear task decomposition, one team lead |
| `mesh` | Research, exploration, peer-to-peer knowledge sharing |
| `hierarchical-mesh` | Recommended for 10+ agents |
| `hybrid` | Complex work requiring both hierarchy and peer communication |
| `ring` | Circular communication pattern |
| `star` | Central coordinator with spokes |
| `adaptive` | Self-organizing — reconfigures based on task load |

### Default Config

```bash
monomind swarm init \
  --topology hierarchical \
  --strategy specialized \
  --max-agents 8
```

---

## Strategies

| Strategy | Description |
|---|---|
| `specialized` | Agents have fixed roles (architect, coder, tester). Best for feature work. |
| `adaptive` | Agents adapt roles to workload. Best for mixed tasks. |
| `balanced` | Even distribution of work. Best for homogeneous tasks. |
| `sequential` | One agent at a time. Best for dependent tasks. |
| `parallel` | Maximum concurrency. Best for independent tasks. |

---

## Consensus Strategies (Vote-Count Thresholds)

These are **not** distributed consensus protocols. Each strategy is a threshold applied to votes collected in a single process:

| Strategy | Threshold | Notes |
|---|---|---|
| `bft` | Requires 2f+1 votes | Byzantine-style threshold for an adversarial fault model |
| `raft` | Simple majority | Named after Raft, but it is majority vote counting — no leader election or log replication |
| `quorum` | Configurable preset | `majority`, `supermajority`, or `unanimous` |

Gossip and CRDT strategies are not implemented.

---

## Agent Types

```typescript
type AgentType =
  | 'coordinator' | 'researcher' | 'coder' | 'analyst' | 'architect'
  | 'tester' | 'reviewer' | 'optimizer' | 'documenter' | 'monitor'
  | 'specialist' | 'queen' | 'worker'
```

### Agent Routing Table

| Code | Task | Recommended agents |
|---|---|---|
| 1 | Bug Fix | coordinator, researcher, coder, tester |
| 3 | Feature | coordinator, architect, coder, tester, reviewer |
| 5 | Refactor | coordinator, architect, coder, reviewer |
| 7 | Performance | coordinator, perf-engineer, coder |
| 9 | Security | coordinator, security-architect, auditor |
| 11 | Memory | coordinator, memory-specialist, perf-engineer |
| 13 | Docs | researcher, api-docs |

---

## CLI Commands

The `swarm` and `agent` commands run in-process — no separate MCP server is required.

```bash
# Initialize
monomind swarm init --topology hierarchical --max-agents 8 --strategy specialized

# Start (after init)
monomind swarm start

# Status
monomind swarm status

# Scale up/down
monomind swarm scale --agents 12

# Coordinate a specific task
monomind swarm coordinate "implement JWT authentication"

# Stop
monomind swarm stop
```

## Slash Command

```
/mastermind          — topology picker: lists all swarm/hive-mind modes and
                       gives one concrete recommendation for the current task
/mastermind:swarm    — full swarm coordination reference
```

---

## Hive-Mind (MCP Tools Only)

Hive-mind is a higher-level abstraction over the swarm system with vote-count consensus and shared memory. It is available **only as MCP tools** (`hive-mind-tools.ts`) — there is no `monomind hive-mind` CLI command.

```
mcp__monomind__hive-mind_init          — initialize with topology + consensus strategy
mcp__monomind__hive-mind_spawn         — spawn workers
mcp__monomind__hive-mind_status        — status, workers, consensus state
mcp__monomind__hive-mind_consensus     — create/vote on proposals (bft | raft | quorum)
mcp__monomind__hive-mind_memory        — shared memory access
mcp__monomind__hive-mind_broadcast     — broadcast a message to workers
mcp__monomind__hive-mind_join / leave  — membership management
mcp__monomind__hive-mind_audit_list    — list audit entries
mcp__monomind__hive-mind_audit_verify  — verify the audit chain
mcp__monomind__hive-mind_shutdown      — graceful shutdown
```

---

## Swarm MCP Tools

```
mcp__monomind__swarm_init         — initialize swarm
mcp__monomind__swarm_status       — get swarm status
mcp__monomind__swarm_scale        — scale agent count
mcp__monomind__swarm_health       — health check
mcp__monomind__swarm_shutdown     — shut down the swarm
mcp__monomind__agent_spawn        — spawn an agent
mcp__monomind__agent_list         — list agents
mcp__monomind__agent_status       — agent status
mcp__monomind__agent_terminate    — terminate an agent
mcp__monomind__task_create        — create a task
mcp__monomind__task_assign        — assign a task to an agent
mcp__monomind__task_status        — task status
```
