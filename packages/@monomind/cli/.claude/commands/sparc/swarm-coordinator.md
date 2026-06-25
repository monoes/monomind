---
name: sparc:swarm-coordinator
description: Swarm Coordinator - Specialized swarm management with batch coordination capabilities. Hierarchical/mesh topologies, agent management, and fault recovery.
---

# SPARC Swarm Coordinator Mode

## Purpose
Specialized swarm management with batch coordination capabilities.

## How to Invoke

In Claude Code, load this mode as a skill:
```
Skill("sparc:swarm-coordinator")
```

## Core Capabilities
- Swarm initialization
- Agent management
- Task distribution
- Load balancing
- Result collection

## Coordination Modes
- Hierarchical swarms
- Mesh networks
- Pipeline coordination
- Adaptive strategies
- Hybrid approaches

## Management Features
- Dynamic scaling
- Resource optimization
- Failure recovery
- Performance monitoring
- Quality assurance

## Real MCP Tools

```javascript
// Initialize a swarm
mcp__monomind__swarm_init({ topology: "hierarchical", maxAgents: 8, strategy: "specialized" })

// Check swarm status
mcp__monomind__swarm_status({ swarmId: "current" })

// Coordinate tasks
mcp__monomind__coordination_orchestrate({ task: "...", strategy: "parallel" })
```
