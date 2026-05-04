---
name: truth:start
description: Truth skill — assess system health, agent reliability, and task quality using real MCP metrics tools. Use when you want a holistic picture of how well the system is performing.
---

# Truth — System Reliability Assessment

Assess the current health, agent performance, and task quality of the Monomind system.

## How to Invoke

```
Skill("truth:start")
```

Then describe what you want to assess:
> "Run a truth check on the current session."
> "Show me system health and agent performance."
> "Check for any reliability issues across active agents."

---

## What Truth Covers

| Area | What to check |
|------|--------------|
| System health | MCP server status, memory DB, daemon |
| Agent performance | Active agents, task completion rates |
| Neural quality | Pattern confidence scores |
| Security posture | Recent AI defence scan results |
| Performance | Bottlenecks, latency, resource usage |

## MCP Tools for Truth Assessment

### System Health

```javascript
// Full system status
mcp__monomind__system_health({})
mcp__monomind__system_status({})
mcp__monomind__system_metrics({})

// MCP server connectivity
mcp__monomind__mcp_status({})
```

### Agent Reliability

```javascript
// List active agents and their states
mcp__monomind__agent_list({})
mcp__monomind__agent_health({})

// Swarm health (if a swarm is running)
mcp__monomind__swarm_health({})
mcp__monomind__swarm_status({ swarmId: "current" })
```

### Neural Pattern Quality

```javascript
// Pattern confidence scores
mcp__monomind__neural_status({ verbose: true })
mcp__monomind__neural_patterns({ action: "list", limit: 10 })

// Hooks intelligence stats (routing accuracy)
mcp__monomind__hooks_intelligence_stats({})
```

### Task Quality

```javascript
// Recent task outcomes
mcp__monomind__task_summary({})
mcp__monomind__progress_summary({})

// AgentDB health (memory integrity)
mcp__monomind__agentdb_health({})
```

### Performance

```javascript
// Performance bottlenecks
mcp__monomind__performance_bottleneck({ component: "all" })
mcp__monomind__performance_report({ format: "detailed" })
```

### Security

```javascript
// AI defence stats
mcp__monomind__aidefence_stats({})
mcp__monomind__aidefence_analyze({ content: "recent session summary" })
```

---

## Assessment Workflow

When invoked, run these checks in parallel:

```javascript
// Batch all checks in one message for speed
mcp__monomind__system_health({})
mcp__monomind__agent_health({})
mcp__monomind__neural_status({ verbose: true })
mcp__monomind__agentdb_health({})
mcp__monomind__performance_report({ format: "detailed" })
```

Then synthesize findings into:
1. **Green** — operating normally
2. **Yellow** — degraded, worth investigating
3. **Red** — action required

## Related Skills

- `verify:start` — Run targeted verification checks on specific code or tasks
- `monitoring:status` — Real-time agent monitoring
- `swarm:swarm-status` — Check running swarm health
