---
name: swarm-examples
description: Swarm pattern examples — concrete recipes for research, development, analysis, and testing swarms with real MCP tool invocations
---

# Common Swarm Patterns

Ready-to-use recipes for the most common swarm scenarios.

## Research Swarm

```javascript
// 1. Initialize
mcp__monomind__swarm_init({ topology: "mesh", maxAgents: 6, strategy: "adaptive" })

// 2. Spawn agents
mcp__monomind__agent_spawn({ type: "researcher", capabilities: ["web-search", "analysis", "synthesis"] })
mcp__monomind__agent_spawn({ type: "analyst", capabilities: ["data-processing", "reporting"] })

// 3. Coordinate
mcp__monomind__coordination_orchestrate({ task: "research AI trends", strategy: "parallel" })

// 4. Monitor
mcp__monomind__swarm_status({ swarmId: "current" })
```

```bash
npx monomind swarm init --topology mesh --max-agents 6 --strategy research
npx monomind swarm start "research AI trends" --strategy research --parallel
```

---

## Development Swarm

```javascript
// 1. Initialize
mcp__monomind__swarm_init({ topology: "hierarchical", maxAgents: 8, strategy: "specialized" })

// 2. Spawn team
mcp__monomind__agent_spawn({ type: "architect", capabilities: ["system-design", "api-design"] })
mcp__monomind__agent_spawn({ type: "coder", capabilities: ["typescript", "api", "backend"] })
mcp__monomind__agent_spawn({ type: "tester", capabilities: ["integration", "e2e"] })
mcp__monomind__agent_spawn({ type: "documenter", capabilities: ["api-docs", "readme"] })

// 3. Coordinate
mcp__monomind__coordination_orchestrate({ task: "build REST API", strategy: "sequential" })

// 4. Monitor
mcp__monomind__swarm_status({ swarmId: "current" })
```

```bash
npx monomind swarm start "build REST API" --strategy development --mode hierarchical
```

---

## Analysis Swarm

```javascript
// 1. Initialize
mcp__monomind__swarm_init({ topology: "mesh", maxAgents: 5, strategy: "adaptive" })

// 2. Spawn agents
mcp__monomind__agent_spawn({ type: "analyst", capabilities: ["static-analysis", "complexity-analysis"] })
mcp__monomind__agent_spawn({ type: "analyst", capabilities: ["security-scan", "vulnerability-detection"] })
mcp__monomind__agent_spawn({ type: "analyst", capabilities: ["performance-analysis", "bottleneck-detection"] })

// 3. Coordinate
mcp__monomind__coordination_orchestrate({ task: "analyze codebase", strategy: "parallel" })

// 4. Report
mcp__monomind__performance_report({ format: "detailed" })
```

```bash
npx monomind swarm start "analyze codebase" --strategy analysis --mode mesh --parallel
```

---

## Error Recovery

When a swarm gets into a bad state:

```javascript
// Check status first
mcp__monomind__swarm_status({ swarmId: "current" })

// System health check
mcp__monomind__system_health({})

// Shut down and restart
mcp__monomind__swarm_shutdown({ swarmId: "current" })
mcp__monomind__swarm_init({ topology: "hierarchical", maxAgents: 6, strategy: "specialized" })
```

## See Also

- `swarm:swarm` — Main skill with strategy selection guide
- `swarm:swarm-modes` — Topology reference
- `swarm:swarm-strategies` — When to use each strategy
