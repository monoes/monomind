---
name: swarm-swarm-monitor
description: Monitor a running swarm in real-time — track agent activity, task completion, and swarm health during execution
---

# Swarm Monitor

Monitor a running swarm's progress and agent activity.

## How to Invoke

```
Skill("swarm:swarm-monitor")
```

---

## MCP Tools

```javascript
// Poll swarm status (call repeatedly to monitor)
mcp__monomind__swarm_status({ swarmId: "current" })

// System-level metrics
mcp__monomind__system_metrics({})

// Agent health
mcp__monomind__agent_health({})

// Agent list with status
mcp__monomind__agent_list({})
```

## CLI

```bash
# Check status
npx monomind swarm status

# List active agents
npx monomind agent list

# Agent metrics
npx monomind agent metrics
```

## Monitoring Pattern

Do NOT poll in a tight loop — check status every 30-60 seconds for long-running swarms. The swarm will report when it finishes.

```javascript
// One-time health snapshot
mcp__monomind__swarm_health({})
```
