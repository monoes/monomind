# Monoswarm

Monoswarm is monomind's multi-agent coordination layer: topology bookkeeping, agent
roster management, vote-based decisions, and shared state for a group of agents
working on the same task.

## How It Works

Coordination state lives in a single JSON file, `.monomind/monoswarm/state.json`
— topology, agent roster, vote history, and shared memory keys. Votes are counted
by threshold in one process (majority, supermajority, unanimous, or a custom
count). Real concurrent execution happens through Claude Code's Task tool: the
monoswarm layer records who's doing what and tallies decisions, while spawned
Task-tool agents do the actual work.

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
| `adaptive` | A label recorded in state; the caller decides how to interpret it — monoswarm doesn't auto-reconfigure coordination based on it |

### Default Config

```bash
monomind monoswarm init \
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

## Vote Strategies

Each strategy is a threshold applied to votes tallied by `monoswarm_vote` in a
single process:

| Strategy | Threshold |
|---|---|
| `majority` | More than 50% of votes |
| `supermajority` | At least 2/3 of votes |
| `unanimous` | 100% of votes |
| `threshold` | Custom `minVotes` count |

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

The `monoswarm` and `agent` commands run in-process — no separate MCP server is
required.

```bash
# Initialize
monomind monoswarm init --topology hierarchical --max-agents 8 --strategy specialized

# Start (after init)
monomind monoswarm start

# Status
monomind monoswarm status

# Scale up/down
monomind monoswarm scale --agents 12

# Stop
monomind monoswarm stop
```

## Slash Command

```
/mastermind          — topology picker: lists all monoswarm modes and
                       gives one concrete recommendation for the current task
/mastermind:swarm    — full monoswarm coordination reference
```

---

## MCP Tools

```
mcp__monomind__monoswarm_init          — record a topology, agent roster, and vote strategy in the state file
mcp__monomind__monoswarm_status        — read merged coordination + vote state (roster, topology, pending/resolved votes, memory key count)
mcp__monomind__monoswarm_scale         — adjust the roster to a target agent count
mcp__monomind__monoswarm_health        — inspect state and roster, report derived healthy/degraded status
mcp__monomind__monoswarm_shutdown      — mark the state file terminated and remove roster agents
mcp__monomind__monoswarm_agent_add     — add agent record(s) to the roster and agent store
mcp__monomind__monoswarm_join          — append an agent id to the roster array
mcp__monomind__monoswarm_leave         — remove an agent id from the roster array
mcp__monomind__monoswarm_vote          — create or vote on a proposal; resolves when the chosen strategy's threshold is met
mcp__monomind__monoswarm_notice        — append a message to the shared noticeboard array
mcp__monomind__monoswarm_memory        — key/value bookkeeping in the state file
mcp__monomind__monoswarm_audit_list    — list tamper-evident vote audit records (HMAC-signed JSONL trail)
mcp__monomind__monoswarm_audit_verify  — verify tamper-evidence of a vote decision
```
