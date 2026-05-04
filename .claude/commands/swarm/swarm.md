---
name: swarm-swarm
description: Main swarm skill — initializes and starts multi-agent swarms for research, development, analysis, testing, optimization, and maintenance tasks
---

# Swarm Orchestration

Start and coordinate multi-agent swarms for complex tasks.

## How to Invoke

In Claude Code, load this skill:
```
Skill("swarm:swarm")
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

## See Also
- `swarm:examples` — Common swarm patterns with full code
- `swarm:swarm-modes` — Topology reference
- `swarm:swarm-strategies` — Strategy selection guide
