---
name: "source-command-monoswarm-monoswarm"
description: "Main monoswarm skill — initializes and starts multi-agent swarms for research, development, analysis, testing, optimization, and maintenance tasks, with optional vote-based consensus"
---

# source-command-monoswarm-monoswarm

Use this skill when the user asks to run the migrated source command `monoswarm-monoswarm`.

## Command Template

# Monoswarm Orchestration

Start and coordinate multi-agent swarms for complex tasks. Queen-led,
vote-based coordination for decisions that need a recorded outcome.

## How to Invoke

In Codex, load this skill:
```
Skill("monoswarm:monoswarm")
```

Then describe what you want to accomplish:
> "Start a development swarm to build a REST API with auth endpoints."
> "Run a research swarm on AI agent coordination patterns."

---

## CLI Reference

```bash
# Initialize a swarm
npx monomind swarm init --topology hierarchical --max-agents 8 --strategy specialized

# Start a swarm with an objective
npx monomind swarm start "Build REST API" --strategy development --parallel

# Check swarm status
npx monomind swarm status

# Stop the swarm
npx monomind swarm stop

# Scale agents
npx monomind swarm scale <swarm-id> --agents 12
```

## MCP Tools

```javascript
// Initialize swarm
mcp__monomind__swarm_init({
  topology: "hierarchical",
  maxAgents: 8,
  strategy: "specialized"
})

// Check status
mcp__monomind__swarm_status({ swarmId: "current" })

// Coordinate tasks
mcp__monomind__coordination_orchestrate({ task: "build feature", strategy: "parallel" })

// Spawn an agent
mcp__monomind__agent_spawn({ type: "coder", capabilities: ["typescript", "api"] })

// Shut down swarm
mcp__monomind__swarm_shutdown({ swarmId: "current" })
```

## Strategy Selection

| Strategy | Topology | Use when |
|----------|----------|----------|
| research | mesh | Gathering information from multiple sources in parallel |
| development | hierarchical | Building features with architect → coder → tester flow |
| analysis | mesh | Distributed codebase or performance analysis |
| testing | star | Parallel test suite execution |
| optimization | mesh | Performance profiling and bottleneck resolution |
| maintenance | star | Sequential dependency updates with checkpoints |

## Vote-Based Consensus (Optional)

There is no `npx monomind monoswarm consensus` CLI subcommand — vote/decision
functionality is available **exclusively via MCP tools**
(`mcp__monomind__monoswarm_*`). Invoke the tools directly, or use one of the
slash commands in this directory, which call the tools for you.

### Real Tools (11 total)

| Tool | Description |
|---|---|
| `monoswarm_init` | Create the run state file (topology, vote strategy, empty worker list) |
| `monoswarm_agent_add` | Write worker agent records into the agent store and register them |
| `monoswarm_status` | Read run status: lead, workers, task/vote metrics |
| `monoswarm_join` | Add an existing agent id to the run's worker list |
| `monoswarm_leave` | Remove an agent id from the run's worker list |
| `monoswarm_vote` | Propose/vote/check status on threshold-based decisions |
| `monoswarm_notice` | Write a message into the run's shared memory for all workers to read |
| `monoswarm_memory` | Get/set/delete/list keys in the run's shared memory namespace |
| `monoswarm_audit_list` | List signed vote decision records |
| `monoswarm_audit_verify` | Verify a vote decision's signatures |
| `monoswarm_shutdown` | Clear run workers from the agent store and reset run state |

### Vote Strategies (`monoswarm_vote`'s `strategy` param)

Vote-threshold bookkeeping over one JSON state file — see
`doc/concepts/monoswarm.md` for how the mechanism works.

| Strategy | Description |
|---|---|
| `supermajority` | Requires 2f+1 votes — tolerates f < n/3 dissenting voters (default) |
| `majority` | Simple majority — tolerates f < n/2 |
| `unanimous` | Rejects on the first dissenting vote |
| `threshold` | Caller-supplied vote count or fraction |

`gossip` and `crdt` are planned but not implemented — both `monoswarm_init`
and `monoswarm_vote` reject them with an error.

### Quick Start

```javascript
// 1. Initialize with recommended topology
mcp__monomind__monoswarm_init({ topology: "hierarchical", voteStrategy: "supermajority" })

// 2. Add worker agents
mcp__monomind__monoswarm_agent_add({ count: 5, role: "specialist" })

// 3. Check status
mcp__monomind__monoswarm_status({ verbose: true })

// 4. Shut down when done
mcp__monomind__monoswarm_shutdown({ graceful: true })
```

Note: `monoswarm_agent_add` only writes bookkeeping records into the agent
store and the run's worker list — it does not start any process, thread, or
agent. Real concurrency comes from Codex's Task tool.

## See Also
- `monoswarm:examples` — Common patterns with full code
- `monoswarm:consensus` — Vote proposal/vote details
- `monoswarm:memory` — Shared memory reference
- `monoswarm:status` — Status output reference
