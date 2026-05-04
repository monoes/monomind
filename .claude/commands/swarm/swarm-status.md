---
name: swarm-swarm-status
description: Check swarm health, agent status, and progress for a running multi-agent swarm
---

# Swarm Status

Check the health and progress of a running swarm.

## How to Invoke

```
Skill("swarm:swarm-status")
```

---

## MCP Tools

```javascript
// Check current swarm
mcp__monomind__swarm_status({ swarmId: "current" })

// System-level health
mcp__monomind__system_health({})

// System metrics
mcp__monomind__system_metrics({})
```

## CLI

```bash
npx monomind swarm status
```

## What to Look For

- **Active agents**: count of agents currently running
- **Task completion**: percentage of tasks finished
- **Agent health**: any failed or stalled agents
- **Memory usage**: memory consumption across agents

If any agent is stalled, run `swarm stop` then `swarm start` to restart.
