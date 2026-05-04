---
name: swarm-swarm-strategies
description: Swarm strategy selection guide — when to use specialized, adaptive, balanced, sequential, and parallel strategies for different tasks
---

# Swarm Strategy Guide

Choose the right strategy for your swarm objective.

## How to Invoke

```
Skill("swarm:swarm-strategies")
```

---

## Available Strategies

### specialized

```javascript
mcp__monomind__swarm_init({ topology: "hierarchical", maxAgents: 8, strategy: "specialized" })
```

- Each agent has a specific role and skill set — no overlap
- Best for: complex feature development, audits, structured workflows
- Agents: architect, coder, tester, reviewer — each owns their domain

### adaptive

```javascript
mcp__monomind__swarm_init({ topology: "mesh", maxAgents: 6, strategy: "adaptive" })
```

- Agents dynamically adjust to task demands
- Best for: research, exploration, unknown problem spaces
- Agents can shift roles as needs emerge

### balanced

```javascript
mcp__monomind__swarm_init({ topology: "hierarchical", maxAgents: 8, strategy: "balanced" })
```

- Mix of specialization and flexibility
- Best for: medium complexity features where requirements may evolve

### sequential

```javascript
mcp__monomind__swarm_init({ topology: "star", maxAgents: 5, strategy: "sequential" })
```

- Tasks execute one after another in a defined order
- Best for: maintenance workflows, migrations, processes with strict dependencies

### parallel

```javascript
mcp__monomind__swarm_init({ topology: "star", maxAgents: 7, strategy: "parallel" })
```

- Tasks execute simultaneously, no dependencies between them
- Best for: running multiple independent test suites, analyzing multiple modules

## Decision Matrix

| Objective | Strategy | Topology |
|-----------|----------|----------|
| Build complex feature | specialized | hierarchical |
| Research open-ended topic | adaptive | mesh |
| Run test suites | parallel | star |
| Update dependencies | sequential | star |
| Analyze codebase | adaptive | mesh |
| Security audit | specialized | hierarchical |
