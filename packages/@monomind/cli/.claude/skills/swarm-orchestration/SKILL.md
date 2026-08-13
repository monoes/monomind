---
name: swarm-orchestration
description: Orchestrate in-process multi-agent swarms with monomind for parallel task execution, topology selection, and shared memory coordination. Use when scaling beyond a single agent on tasks with clear decomposition.
---

# Swarm Orchestration

## What This Skill Does

Coordinates multiple Claude Code Task-tool agents inside a single monomind process. The swarm layer tracks topology, agent lifecycle, and task assignment. **Real work happens in spawned Task-tool agents** — the swarm coordinates, agents execute.

## What Swarm Is (and Is Not)

**Is:** In-process coordination — topology bookkeeping, agent lifecycle, task routing, vote-count consensus. State persists to `.monomind/swarm/`.

**Is not:** A distributed system. There is no networking between separate machines. "Consensus" strategies (`raft`, `bft`, `quorum`) are vote-count thresholds applied inside one process — not Raft/Paxos protocols.

If you need persistent, scheduled, autonomous agent organizations, use `monomind org run` instead. **Swarm coordinates a single task; org runtime governs a long-running org.** (See "Successor: Org Runtime" below.)

## Prerequisites

- monomind v2.9.4+
- Claude Code's Task tool available (agents execute via Task tool, not CLI alone)
- A task that decomposes into 2+ independent subtasks

## Topology Selection

Choose topology by task shape:

| Topology | When | Example |
|---|---|---|
| `hierarchical` | Default — clear task decomposition, one coordinator | Feature build (architect → coders → testers) |
| `mesh` | Peer-to-peer exploration, research, knowledge sharing | Multi-source research synthesis |
| `hierarchical-mesh` | 10+ agents — hierarchy with peer side-channels | Large refactor touching many modules |
| `ring` | Circular handoff (review → fix → re-review) | Code review cycle |
| `star` | Central hub with specialist spokes | Coordinator dispatching to niche experts |
| `hybrid` | Mixed work needing both hierarchy and peer comms | Migration + new feature in parallel |

**Rule of thumb:** ≤8 agents → `hierarchical`. 10+ agents → `hierarchical-mesh`. Research/exploration → `mesh`.

## Strategy Selection

| Strategy | When |
|---|---|
| `specialized` | Fixed roles (default for feature work) |
| `balanced` | Even work distribution, homogeneous tasks |
| `development` | Dev pipeline (plan → code → test → review) |

## Lifecycle

### 1. Initialize

```bash
npx monomind@latest swarm init \
  --topology hierarchical \
  --max-agents 8 \
  --strategy specialized
```

### 2. Spawn agents (CLI or MCP)

```bash
npx monomind@latest agent spawn -t coordinator --name lead
npx monomind@latest agent spawn -t coder       --name impl
npx monomind@latest agent spawn -t tester      --name qa
```

Equivalent MCP: `mcp__monomind__agent_spawn { type: "...", name: "..." }`.

### 3. Start work

```bash
npx monomind@latest swarm start \
  --objective "Add OAuth2 login with tests" \
  --strategy specialized \
  --agents 4
```

### 4. Monitor and stop

```bash
npx monomind@latest swarm status
npx monomind@latest agent list
npx monomind@latest agent status <id>
npx monomind@latest swarm stop
```

## Agent Role Assignment

Match agent type to task category. Use `mcp__monomind__hooks_route` to auto-pick instead of guessing:

```
mcp__monomind__hooks_route { task: "implement JWT auth" }
# → returns the recommended agent type
```

Common assignments (see `doc/concepts/swarm.md` for the full routing table):

| Task | Recommended agents |
|---|---|
| Bug fix | coordinator, researcher, coder, tester |
| Feature | coordinator, architect, coder, tester, reviewer |
| Refactor | coordinator, architect, coder, reviewer |
| Performance | coordinator, performance-engineer, coder |
| Security | coordinator, security-architect, security-auditor |
| Docs | researcher, documenter |

## Workflow Patterns

### Sequential pipeline (design → code → test → review)

```bash
npx monomind@latest swarm init --topology hierarchical --strategy development --max-agents 4
npx monomind@latest swarm start --objective "Build user-profile API with full test coverage"
```

Drive each stage via task assignment — the next stage picks up when the previous completes:

```
mcp__monomind__task_create { description: "Design schema", agent_type: "architect" }
# after architect completes:
mcp__monomind__task_assign { task_id: "...", agent_id: "<coder-id>" }
# after coder completes:
mcp__monomind__task_assign { task_id: "...", agent_id: "<tester-id>" }
```

### Parallel fan-out (independent subtasks)

```bash
npx monomind@latest swarm init --topology mesh --strategy balanced --max-agents 6
npx monomind@latest swarm start --objective "Audit 6 modules for security issues" --agents 6
```

Spawn one Task-tool agent per module; each writes findings to the shared namespace.

### Mixed (parallel sub-trees, sequential stages)

Use `hierarchical-mesh` — the coordinator fans out parallel work while stages run sequentially. Best for 10+ agent workloads:

```
mcp__monomind__swarm_init { topology: "hierarchical-mesh", max_agents: 12, strategy: "specialized" }
```

## Memory Sharing Across Agents

Swarm agents share state through monomind memory (SQLite/JSON) — there is no separate "swarm memory" API. Each agent reads/writes the same namespace.

Store context once (CLI), or via MCP inside an agent:

```bash
npx monomind@latest memory store \
  --key "feature-spec" \
  --value "OAuth2 with PKCE, refresh tokens, 15-min access TTL" \
  --namespace swarm-001 --tags spec,auth
```

```
mcp__monomind__memory_kg_ingest { key: "feature-spec", value: "...", namespace: "swarm-001" }
```

Retrieve during work:

```bash
npx monomind@latest memory retrieve --key feature-spec --namespace swarm-001
npx monomind@latest memory search --query "auth requirements"
```

**Use one shared namespace per swarm run** so every agent sees the same context.

## Load Balancing (Concept)

In-process "load balancing" is task routing, not network LB. Two mechanisms: `hooks_route` (picks the optimal agent type from the routing table) and `strategy` (`balanced` evens work, `specialized` keeps roles fixed).

For uneven workloads, scale up and reassign stalled tasks:

```bash
npx monomind@latest swarm scale --agents 12
npx monomind@latest swarm status
npx monomind@latest agent status <id>
```

```
mcp__monomind__task_assign { task_id: "...", agent_id: "<idle-agent-id>" }
```

## Full Example: Feature Build

```bash
npx monomind@latest swarm init --topology hierarchical --max-agents 5 --strategy specialized

# Share the spec once — all agents read this
npx monomind@latest memory store \
  --key "feature-spec" \
  --value "Add CSV import: parse, validate, persist, report errors" \
  --namespace swarm-csv

npx monomind@latest agent spawn -t coordinator --name lead
npx monomind@latest agent spawn -t coder       --name impl
npx monomind@latest agent spawn -t tester      --name qa
npx monomind@latest agent spawn -t reviewer    --name audit

npx monomind@latest swarm start --objective "Implement CSV import end-to-end" --agents 4
npx monomind@latest swarm status
npx monomind@latest swarm stop
```

Execution happens in Claude Code Task-tool agents. The CLI coordinates; Task agents do the work.

## Successor: Org Runtime

For autonomous, recurring, or long-running work, prefer `monomind org run`:

```bash
npx monomind@latest org run my-team --task "Maintain CI hygiene"
npx monomind@latest org status
npx monomind@latest org logs my-team --follow
npx monomind@latest org stop my-team
```

Org runtime adds: scheduled wakeups, governance gates, budget enforcement, persistent state across runs. **Swarm is a single coordinated session; org runtime is a durable organization.**

- Use **swarm** for: one-off parallel tasks today.
- Use **org runtime** for: recurring autonomous work, scheduled agents, multi-session goals.

## Best Practices

1. **Right-size the swarm.** Start with 3–4 agents; scale only when utilization is high.
2. **One shared memory namespace per run.** All agents read/write the same context.
3. **Pick topology by agent count.** ≤8 → `hierarchical`; 10+ → `hierarchical-mesh`.
4. **Route before assigning.** `hooks_route` picks better agent types than guessing.
5. **Let Task-tool agents do the work.** CLI coordinates; execution lives in Claude Code Task agents.
6. **Set clear boundaries.** Every subtask needs clear inputs and outputs, or agents will thrash.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Agents not coordinating | Different namespace per agent | Use one shared `--namespace` |
| Stalled agent | Blocked on upstream stage | `agent status <id>`, then reassign task |
| Poor throughput | Wrong topology for count | Switch to `hierarchical-mesh` at 10+ agents |
| Duplicate work | No shared memory | `memory store` the spec; agents `retrieve` before acting |
| Swarm won't start | Bad topology/strategy combo | Verify flags against `doc/concepts/swarm.md` |

## Learn More

- `doc/concepts/swarm.md` — honest scope, topologies, agent types, full MCP tool list
- Hive-mind (MCP only): `mcp__monomind__hive-mind_*` tools for vote-count consensus
- `/mastermind:topology` — interactive topology picker
- Org runtime: `npx monomind@latest org --help`
