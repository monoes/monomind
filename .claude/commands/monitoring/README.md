---
name: monitoring:README
---

# Monitoring Commands

Commands for monitoring Monomind system health — swarm status, agents, tasks, memory, and performance metrics.

## Available Commands

| Command | Description |
|---|---|
| `status` | Full system status (swarm, agents, tasks, memory, MCP) |
| `status agents` | Detailed agent table with uptime and success rate |
| `status tasks` | Detailed task table with progress and priority |
| `status memory` | Memory backend stats and HNSW performance |
| `agent metrics` | Agent performance metrics by type and time period |
| `agent health` | Per-agent health check with optional watch mode |
| `swarm status` | Swarm-specific status (topology, consensus, agents) |

## Quick Reference

```bash
# One-shot system snapshot
npx monomind status

# Live watch (refreshes every 2s)
npx monomind status --watch

# Health checks with pass/warn/fail
npx monomind status --health-check

# Detailed agent view
npx monomind status agents

# Agent performance metrics
npx monomind agent metrics --period 7d

# Swarm status
npx monomind swarm status
```

## Files

- [status.md](./status.md) — Full system status + watch mode + health checks
- [agents.md](./agents.md) — `status agents` subcommand
- [agent-metrics.md](./agent-metrics.md) — `agent metrics` by type and period

## MCP Tools

| Tool | Purpose |
|---|---|
| `mcp__monomind__swarm_status` | Swarm health and agent counts |
| `mcp__monomind__swarm_health` | Swarm health check |
| `mcp__monomind__agent_list` | All agents with metrics |
| `mcp__monomind__agent_status` | Specific agent status |
| `mcp__monomind__agent_health` | Agent health check |
| `mcp__monomind__memory_stats` | Memory backend stats |
| `mcp__monomind__task_summary` | Task counts by status |
| `mcp__monomind__task_list` | All tasks with progress |
| `mcp__monomind__system_health` | Full system health |
| `mcp__monomind__system_metrics` | System performance metrics |
| `mcp__monomind__mcp_status` | MCP server status |

## See Also

- `doctor` — comprehensive diagnostics (`npx monomind doctor`)
- `hooks metrics` — learning and intelligence metrics
- `performance` — performance profiling commands
