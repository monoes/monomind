---
name: swarm-optimization
description: Optimization swarm strategy — performance profiling, bottleneck detection, and coordinated optimization through specialized mesh agents
---

# Optimization Swarm Strategy

Performance optimization through specialized analysis agents.

## How to Invoke

```
Skill("swarm:optimization")
```

Then describe the optimization target:
> "Start an optimization swarm to improve API response times."
> "Run an optimization swarm on the memory usage in the agent system."

---

## Swarm Setup

```javascript
// Initialize optimization swarm
mcp__monomind__swarm_init({
  topology: "mesh",
  maxAgents: 6,
  strategy: "adaptive"
})

// Coordinate optimization
mcp__monomind__coordination_orchestrate({
  task: "optimize performance",
  strategy: "parallel"
})
```

```bash
# CLI equivalent
npx monomind swarm init --topology mesh --max-agents 6
npx monomind swarm start "optimize performance" --strategy optimization --parallel
```

## Agent Roles

```javascript
mcp__monomind__agent_spawn({ type: "optimizer", capabilities: ["profiling", "bottleneck-detection"] })
mcp__monomind__agent_spawn({ type: "analyst", capabilities: ["memory-analysis", "leak-detection"] })
mcp__monomind__agent_spawn({ type: "optimizer", capabilities: ["code-optimization", "refactoring"] })
mcp__monomind__agent_spawn({ type: "tester", capabilities: ["benchmarking", "performance-testing"] })
```

## Performance Analysis

```javascript
// Profile performance
mcp__monomind__performance_profile({ target: "api", metrics: ["cpu", "memory", "latency"] })

// Find bottlenecks
mcp__monomind__performance_bottleneck({ component: "all" })

// Performance report
mcp__monomind__performance_report({ format: "detailed", timeframe: "7d" })

// Benchmark results
mcp__monomind__performance_benchmark({ suite: "performance" })
```

## Load Balancing

```javascript
// Balance work across optimization agents
mcp__monomind__coordination_load_balance({
  tasks: ["profile", "analyze", "optimize", "benchmark"]
})
```

## Monitoring

```javascript
mcp__monomind__swarm_status({ swarmId: "current" })
mcp__monomind__system_metrics({})
```
