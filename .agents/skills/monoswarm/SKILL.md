---
name: monoswarm
description: Coordinate in-process multi-agent work with monomind — topology selection, agent lifecycle, shared memory, and vote-based consensus. Use when scaling beyond a single agent on tasks with clear decomposition, or when a decision needs a recorded vote before work proceeds.
---

# Monoswarm

## What This Skill Does

Coordinates multiple Claude Code Task-tool agents inside a single monomind process, and — when a decision needs to be documented before proceeding — runs a threshold vote over that group. **Real work happens in spawned Task-tool agents**; monoswarm coordinates and records, agents execute.

## How It Works

State for a run lives in one JSON file under `.monomind/monoswarm/`. Topology, agent roster, task assignment, and any votes are bookkeeping fields on that file, updated by a single process. Real concurrency comes from Claude Code's Task tool: when you spawn several agents with `run_in_background: true` in one message, those run in parallel and this skill's tools track what they're doing and, if asked, tally their votes.

If you need persistent, scheduled, autonomous agent organizations that outlive a single session, use `monomind org run` instead — see "Successor: Org Runtime" below.

## Prerequisites

- monomind v2.9.4+
- Claude Code's Task tool available (agents execute via Task tool, not CLI alone)
- A task that decomposes into 2+ independent subtasks, or a decision that needs a recorded vote

## Topology Selection

| Topology | When | Example |
|---|---|---|
| `hierarchical` | Default — clear task decomposition, one coordinator | Feature build (architect → coders → testers) |
| `mesh` | Peer-to-peer exploration, research, knowledge sharing | Multi-source research synthesis |
| `hierarchical-mesh` | 10+ agents — hierarchy with peer side-channels | Large refactor touching many modules |
| `ring` | Circular handoff (review → fix → re-review) | Code review cycle |
| `star` | Central hub with specialist spokes | Coordinator dispatching to niche experts |

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

Equivalent MCP: `mcp__monomind__monoswarm_init { topology, maxAgents, strategy }`.

### 2. Spawn agents (CLI or MCP)

```bash
npx monomind@latest agent spawn -t coordinator --name lead
npx monomind@latest agent spawn -t coder       --name impl
npx monomind@latest agent spawn -t tester      --name qa
```

Equivalent MCP: `mcp__monomind__monoswarm_agent_add { type: "...", name: "..." }`.

### 3. Start work

```bash
npx monomind@latest swarm start \
  --objective "Add OAuth2 login with tests" \
  --strategy specialized \
  --agents 4
```

### 4. Monitor, scale, and stop

```bash
npx monomind@latest swarm status
npx monomind@latest agent list
npx monomind@latest agent status <id>
npx monomind@latest swarm scale --agents 12
npx monomind@latest swarm stop
```

Equivalent MCP: `monoswarm_status`, `monoswarm_scale`, `monoswarm_health`, `monoswarm_shutdown { graceful: true, force: false }`.

## Agent Role Assignment

Match agent type to task category. Use `mcp__monomind__hooks_route` to auto-pick instead of guessing:

```
mcp__monomind__hooks_route { task: "implement JWT auth" }
# → returns the recommended agent type
```

Common assignments (see `doc/concepts/monoswarm.md` for the full routing table):

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
mcp__monomind__monoswarm_init { topology: "hierarchical-mesh", maxAgents: 12, strategy: "specialized" }
```

### Decide-then-Build (vote before executing)

Use when an architectural choice must be documented before implementation begins.

```
# 1. Initialize with a known lead and a vote strategy
mcp__monomind__monoswarm_init { topology: "hierarchical", leadId: "architect-1", voteStrategy: "supermajority" }

# 2. Add agents (specialist role for SMEs)
mcp__monomind__monoswarm_agent_add { count: 4, role: "specialist", agentType: "reviewer" }

# 3. Lead proposes the decision and agents vote
mcp__monomind__monoswarm_vote {
  action: "propose", type: "architecture",
  value: { pattern: "modular-monolith", modules: ["auth","billing","shipping"] },
  voterId: "architect-1"
}
# → returns proposalId; each agent then calls:
mcp__monomind__monoswarm_vote { action: "vote", proposalId: "<id>", vote: true, voterId: "reviewer-2" }

# 4. Once threshold is reached, record the decision
mcp__monomind__monoswarm_memory { action: "set", key: "decision-architecture-v1", value: { summary: "...", proposalId: "<id>" } }

# 5. Execute with a regular swarm run, sharing the decision via memory namespace
npx monomind@latest swarm init --topology hierarchical --max-agents 6
npx monomind@latest swarm start --objective "Implement modular monolith per decision-architecture-v1"
```

## Vote Strategies

| Strategy | Required votes | Notes |
|---|---|---|
| `majority` | `floor(n/2) + 1` | One pending proposal per term; re-proposal timeout defaults to 30s. |
| `supermajority` | `floor(2n/3) + 1` | Conflicting votes across proposals are flagged. |
| `unanimous` | all voters | Rejects on the first dissent. |
| `threshold` | a caller-supplied count or fraction | For custom bars between majority and unanimous. |

Pick by decision shape:

- High-bar policy / breaking change → `unanimous` or `threshold` set high
- Adversarial review with distrusted input → `supermajority`
- Standard go/no-go decision → `majority`
- Quick informal coordination → skip voting, use `monoswarm_memory` only

Each resolved decision is HMAC-signed and appended to a tamper-evident JSONL audit trail under `.monomind/consensus/`. Verify later with `mcp__monomind__monoswarm_audit_verify { decisionId }`; list history with `monoswarm_audit_list { limit: 50 }`.

## MCP Tool Reference

All tools are called as `mcp__monomind__<tool_name>` from inside Claude Code.

```
monoswarm_init     { topology, maxAgents, strategy, leadId?, voteStrategy? }
monoswarm_status   { verbose? }
monoswarm_scale    { targetSize }
monoswarm_health   { }
monoswarm_shutdown { graceful, force? }

monoswarm_agent_add { count, role, agentType, prefix? }
monoswarm_join      { agentId, role }   // join an agent created elsewhere (e.g. `monomind agent spawn`)
monoswarm_leave      { agentId }

monoswarm_vote   { action: "propose"|"vote"|"status"|"list", type?, value?, voterId?, strategy?, proposalId?, vote? }
monoswarm_notice { message, priority, fromId }   // noticeboard, not delivery — see below
monoswarm_memory { action: "get"|"set"|"delete"|"list", key?, value? }

monoswarm_audit_list   { swarmId?, limit }
monoswarm_audit_verify { decisionId }
```

`monoswarm_notice` appends to a capped noticeboard; nothing is pushed to listeners. A worker sees a notice only when it later reads `monoswarm_status` or `monoswarm_memory get`. For real task handoff use `mcp__monomind__task_create` / `task_assign`, or put instructions directly in each Task-tool agent's prompt.

## Memory Sharing Across Agents

Agents share state through monomind memory (SQLite/JSON) — there is no separate "swarm memory" API beyond the small `monoswarm_memory` key/value blob for decisions. For everything else, use one shared namespace per run.

```bash
npx monomind@latest memory store \
  --key "feature-spec" \
  --value "OAuth2 with PKCE, refresh tokens, 15-min access TTL" \
  --namespace monoswarm-001 --tags spec,auth

npx monomind@latest memory retrieve --key feature-spec --namespace monoswarm-001
npx monomind@latest memory search --query "auth requirements"
```

**Use one shared namespace per run** so every agent sees the same context.

## Load Balancing (Concept)

In-process "load balancing" is task routing, not network LB. Two mechanisms: `hooks_route` (picks the optimal agent type from the routing table) and `strategy` (`balanced` evens work, `specialized` keeps roles fixed). For uneven workloads, scale up and reassign stalled tasks:

```bash
npx monomind@latest swarm scale --agents 12
npx monomind@latest swarm status
```

```
mcp__monomind__task_assign { task_id: "...", agent_id: "<idle-agent-id>" }
```

## Full Example: Feature Build

```bash
npx monomind@latest swarm init --topology hierarchical --max-agents 5 --strategy specialized

npx monomind@latest memory store \
  --key "feature-spec" \
  --value "Add CSV import: parse, validate, persist, report errors" \
  --namespace monoswarm-csv

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

Org runtime adds: scheduled wakeups, governance gates, budget enforcement, persistent state across runs.

- Use **monoswarm** for: one-off parallel tasks and recorded decisions today.
- Use **org runtime** for: recurring autonomous work, scheduled agents, multi-session goals.

## Best Practices

1. **Right-size the swarm.** Start with 3–4 agents; scale only when utilization is high.
2. **One shared memory namespace per run.** All agents read/write the same context.
3. **Pick topology by agent count.** ≤8 → `hierarchical`; 10+ → `hierarchical-mesh`.
4. **Route before assigning.** `hooks_route` picks better agent types than guessing.
5. **Let Task-tool agents do the work.** CLI coordinates; execution lives in Claude Code Task agents.
6. **Vote only when a decision needs a record.** Otherwise skip straight to memory sharing.
7. **Verify decisions that matter.** Run `monoswarm_audit_verify` on release gates and architecture calls after the fact.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Agents not coordinating | Different namespace per agent | Use one shared `--namespace` |
| Stalled agent | Blocked on upstream stage | `agent status <id>`, then reassign task |
| Poor throughput | Wrong topology for count | Switch to `hierarchical-mesh` at 10+ agents |
| Duplicate work | No shared memory | `memory store` the spec; agents `retrieve` before acting |
| Swarm won't start | Bad topology/strategy combo | Verify flags against `doc/concepts/monoswarm.md` |
| "not initialized" on a vote tool | `monoswarm_init` hasn't run yet | Run `monoswarm_init` first |
| Vote stuck | Neither side can reach threshold | Check `monoswarm_vote { action: "status" }`, add voters, or lower the strategy |

## Learn More

- `doc/concepts/monoswarm.md` — honest scope, topologies, agent types, full MCP tool list
- `/mastermind:topology` — interactive topology picker
- Org runtime: `npx monomind@latest org --help`

---

**Skill Version**: 1.0.0
**Maintained By**: Monomind Team
