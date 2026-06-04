# Swarm & Hive-Mind

> Monomind coordinates multi-agent swarms using the `UnifiedSwarmCoordinator` — a single system that consolidates hierarchical, mesh, and adaptive topologies with Raft, Byzantine, and Gossip consensus.

---

## Architecture

```
UnifiedSwarmCoordinator (ADR-003)
  ├── TopologyManager     — graph of nodes and edges; handles rebalancing
  ├── MessageBus          — inter-agent queue; maxQueueSize 10,000; batchSize 100
  ├── AgentPool           — lifecycle management; idleTimeout 300s; min 1 / max 15
  ├── ConsensusEngine     — factory: Raft | Byzantine | Gossip
  ├── AgentRegistry       — tracks registrations and capabilities
  └── TaskOrchestrator    — routes tasks to domains; manages parallel execution
```

Performance targets: agent coordination <100ms for 15 agents; consensus <100ms; message throughput 1000+ msgs/sec.

---

## Topologies

| Topology | When to use |
|---|---|
| `hierarchical` | Default — feature dev, clear task decomposition, one team lead |
| `mesh` | Research, exploration, peer-to-peer knowledge sharing |
| `centralized` | Simple parallel tasks with a single coordinator |
| `hybrid` | Complex work requiring both hierarchy and peer communication |
| `hierarchical-mesh` | Recommended for 10+ agents |
| `adaptive` | Self-organizing — reconfigures based on task load |

### Default Config

```bash
monomind swarm init \
  --topology hierarchical \
  --strategy specialized \
  --max-agents 8 \
  --consensus raft
```

### 15-Agent Hierarchy

The v1 default hierarchy for large swarms:

| Domain | Agents | Roles |
|---|---|---|
| queen | 1 | Top-level coordinator |
| security | 2–4 | security-architect, security-auditor, test-architect |
| core | 5–9 | core-architect, type-modernization, memory-specialist, swarm-specialist, mcp-optimizer |
| integration | 10–12 | integration-architect, cli-modernizer, neural-integrator |
| support | 13–15 | test-architect, performance-engineer, deployment-engineer |

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

## Consensus Algorithms

| Algorithm | Fault tolerance | When to use |
|---|---|---|
| `raft` | f < n/2 (crash faults) | Default — strong consistency, small/medium scale, low latency |
| `byzantine` | f < n/3 (malicious agents) | When agent trust cannot be assumed |
| `gossip` | Eventual consistency | Large scale, high throughput, relaxed consistency acceptable |
| `crdt` | Conflict-free, no coordination | Replicated state, offline-first |
| `quorum` | Configurable quorum | Custom fault tolerance requirements |

### Selecting Consensus

```typescript
selectOptimalAlgorithm({
  faultTolerance: 'byzantine',  // or 'crash'
  consistency: 'strong',        // or 'eventual'
  networkScale: 15,
  latencyPriority: false
})
// → 'raft' or 'byzantine' based on requirements
```

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

## Advanced Components

### QueenCoordinator

Top-level hive-mind orchestrator:
- Analyzes incoming tasks
- Builds `DelegationPlan` (routes subtasks to specialist domains)
- Monitors domain health
- Runs consensus on major decisions

### FederationHub

Coordinates multiple swarms as a federation:
- Spawns ephemeral cross-swarm agents
- Manages cross-swarm consensus proposals
- Maintains federation membership

---

## CLI Commands

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

## Slash Commands

```
/mastermind:swarm       — full swarm reference
/swarm:development    — hierarchical swarm for feature dev
/swarm:research       — mesh swarm for research
/swarm:testing        — star swarm for parallel testing
/swarm:analysis       — mesh + adaptive for distributed analysis
/swarm:optimization   — bottleneck detection and optimization
/swarm:maintenance    — dependency updates, security audits
```

---

## Hive-Mind (Byzantine Fault-Tolerant)

The `hive-mind` command group is a higher-level abstraction over the swarm system, adding Byzantine fault tolerance and a Claude-as-Queen mode.

### CLI

```bash
# Initialize with Byzantine consensus
monomind hive-mind init --topology hierarchical-mesh --consensus byzantine

# Spawn workers (--claude launches Claude Code as Queen)
monomind hive-mind spawn --workers 5 --claude

# Status
monomind hive-mind status

# Consensus proposal
monomind hive-mind consensus propose "use PostgreSQL for user data"

# Access shared memory
monomind hive-mind memory search "architecture decisions"

# Graceful shutdown
monomind hive-mind shutdown
```

### Slash Commands

```
/hive-mind:hive-mind-init      — initialize with topology + consensus
/hive-mind:hive-mind-spawn     — spawn workers
/hive-mind:hive-mind-status    — check status
/hive-mind:hive-mind-consensus — manage consensus proposals
/hive-mind:hive-mind-memory    — shared memory access
/hive-mind:hive-mind-stop      — graceful shutdown
```

---

## MCP Tools

```
mcp__monomind__swarm_init         — initialize swarm
mcp__monomind__swarm_status       — get swarm status
mcp__monomind__agent_spawn        — spawn an agent
mcp__monomind__task_orchestrate   — orchestrate tasks across agents
mcp__monomind__coordination_sync  — sync coordination state
mcp__monomind__load_balance       — balance workload
mcp__monomind__parallel_execute   — execute tasks in parallel
```

---

## SwarmHub (Compatibility Wrapper)

`SwarmHub` is maintained as a deprecated compatibility wrapper around `UnifiedSwarmCoordinator`. All new code should use `UnifiedSwarmCoordinator` directly.
