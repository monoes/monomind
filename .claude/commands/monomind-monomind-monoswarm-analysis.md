---
name: swarm-analysis
description: Analysis swarm strategy — distributed codebase, performance, and security analysis through coordinated mesh agents
---

# Analysis Swarm Strategy

Comprehensive analysis through distributed agent coordination.

## How to Invoke

```
Skill("swarm:analysis")
```

Then describe what to analyze:
> "Run an analysis swarm on the src/ directory."
> "Analyze API performance bottlenecks across all services."

---

## Swarm Setup

```javascript
// Initialize analysis swarm
mcp__monomind__swarm_init({
  topology: "mesh",
  maxAgents: 6,
  strategy: "adaptive"
})

// Coordinate analysis
mcp__monomind__coordination_orchestrate({
  task: "analyze system performance",
  strategy: "parallel"
})
```

```bash
# CLI equivalent
npx monomind swarm init --topology mesh --max-agents 6
npx monomind swarm start "analyze system performance" --strategy analysis --parallel
```

## Agent Roles

```javascript
mcp__monomind__agent_spawn({ type: "analyst", capabilities: ["metrics", "logging", "monitoring"] })
mcp__monomind__agent_spawn({ type: "analyst", capabilities: ["pattern-recognition", "anomaly-detection"] })
mcp__monomind__agent_spawn({ type: "documenter", capabilities: ["reporting", "visualization"] })
mcp__monomind__agent_spawn({ type: "coordinator", capabilities: ["synthesis", "correlation"] })
```

## Coordination Modes

| Mode | When to use |
|------|-------------|
| Mesh | Exploratory analysis — agents search in parallel |
| Hierarchical | Complex systems — coordinator aggregates sub-agent findings |
| Star | Sequential pipeline — each step depends on previous |

## Monitoring

```javascript
// Check analysis progress
mcp__monomind__swarm_status({ swarmId: "current" })

// Performance metrics
mcp__monomind__performance_report({ format: "detailed" })

// System health
mcp__monomind__system_health({})
```
