---
name: swarm-swarm-analysis
description: Analyze swarm performance — review coordination efficiency, bottlenecks, and agent utilization for a completed swarm run
---

# Swarm Performance Analysis

Analyze how a swarm performed: coordination efficiency, agent utilization, and bottlenecks.

## How to Invoke

```
Skill("swarm:swarm-analysis")
```

---

## Performance Review

```javascript
// Full performance report
mcp__monomind__performance_report({ format: "detailed" })

// Identify bottlenecks
mcp__monomind__performance_bottleneck({ component: "swarm" })

// System metrics snapshot
mcp__monomind__system_metrics({})

// Coordination topology review
mcp__monomind__coordination_metrics({})
```

## What to Analyze

After a swarm completes, review:

1. **Agent utilization** — were all agents busy or were some idle?
2. **Task completion time** — which tasks took longest?
3. **Coordination overhead** — how much time was spent coordinating vs executing?
4. **Memory usage** — did agents share knowledge effectively?

## Optimization Loop

```javascript
// Check what patterns worked
mcp__monomind__neural_patterns({ action: "stats" })

// Store lessons learned
mcp__monomind__memory_store({
  key: "swarm-analysis",
  value: "what worked: hierarchical was efficient, what to improve: too many agents for small task",
  namespace: "swarm"
})
```

## CLI

```bash
npx monomind performance report --format detailed
npx monomind performance bottleneck --component swarm
```
