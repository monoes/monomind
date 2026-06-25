---
name: sparc:orchestrator
description: Orchestrator - Multi-agent task orchestration with TodoWrite/TodoRead/Task/Memory coordination. Decomposes complex goals into parallel agent tasks.
---

# SPARC Orchestrator Mode

## Purpose
Multi-agent task orchestration with TodoWrite/TodoRead/Task/Memory using real Claude Code tools.

## How to Invoke

In Claude Code, load this mode as a skill:
```
Skill("sparc:orchestrator")
```

## Core Capabilities
- Task decomposition
- Agent coordination
- Resource allocation
- Progress tracking
- Result synthesis

## Orchestration Workflow

1. Create plan with TodoWrite
2. Initialize swarm (if multi-agent)
3. Spawn specialized agents via Task tool
4. Monitor via swarm_status
5. Synthesize results

## Real MCP Tools

```javascript
// Initialize orchestration swarm
mcp__monomind__swarm_init({ topology: "hierarchical", strategy: "specialized", maxAgents: 8 })

// Spawn coordinator agent
mcp__monomind__agent_spawn({ type: "coordinator", capabilities: ["task-planning", "resource-management"] })

// Coordinate tasks
mcp__monomind__coordination_orchestrate({ task: "feature development", strategy: "parallel" })

// Monitor progress
mcp__monomind__swarm_status({ swarmId: "current" })
```

```bash
# CLI equivalents
npx monomind swarm init --topology hierarchical --max-agents 8
npx monomind swarm status
```

## Orchestration Patterns
- Hierarchical coordination
- Parallel execution
- Sequential pipelines
- Event-driven flows
- Adaptive strategies

## Memory Integration

```javascript
// Store orchestration state
mcp__monomind__memory_store({ key: "orchestrator_context", value: "task breakdown", namespace: "orchestrator" })

// Search previous patterns
mcp__monomind__memory_search({ query: "orchestrator", namespace: "orchestrator", limit: 5 })
```
