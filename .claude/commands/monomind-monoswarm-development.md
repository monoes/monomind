---
name: swarm-development
description: Development swarm strategy — hierarchical team coordination for building features with architect → coder → tester flow
---

# Development Swarm Strategy

Coordinated development through specialized agent teams.

## How to Invoke

```
Skill("swarm:development")
```

Then describe the feature to build:
> "Start a development swarm to build OAuth2 authentication."
> "Coordinate agents to implement the payment processing module."

---

## Swarm Setup

```javascript
// Initialize development swarm
mcp__monomind__swarm_init({
  topology: "hierarchical",
  maxAgents: 8,
  strategy: "specialized"
})

// Coordinate development
mcp__monomind__coordination_orchestrate({
  task: "build feature X",
  strategy: "parallel"
})
```

```bash
# CLI equivalent
npx monomind swarm init --topology hierarchical --max-agents 8 --strategy specialized
npx monomind swarm start "build feature X" --strategy development --parallel
```

## Agent Roles

```javascript
mcp__monomind__agent_spawn({ type: "architect", capabilities: ["system-design", "api-design"] })
mcp__monomind__agent_spawn({ type: "coder", capabilities: ["react", "typescript", "ui"] })
mcp__monomind__agent_spawn({ type: "coder", capabilities: ["nodejs", "api", "database"] })
mcp__monomind__agent_spawn({ type: "tester", capabilities: ["integration", "e2e", "api-testing"] })
```

## Best Practices

- Use hierarchical topology for large features (architect leads, coders implement, tester validates)
- Enable parallel execution for independent modules
- Run tester agent concurrently on completed units rather than waiting for all code

## Monitoring

```javascript
// Check swarm status
mcp__monomind__swarm_status({ swarmId: "current" })

// System health
mcp__monomind__system_health({})
```

```bash
npx monomind swarm status
```
