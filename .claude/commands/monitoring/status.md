---
name: monitoring:status
---

# status

Show system status — swarm health, agents, tasks, memory, and MCP server. The primary monitoring command.

## Usage

```bash
npx monomind status [options]
npx monomind status <subcommand>
```

## Options

| Flag | Short | Type | Default | Description |
|---|---|---|---|---|
| `--watch` | `-w` | boolean | `false` | Continuously refresh status (live view) |
| `--interval` | `-i` | number | `2` | Refresh interval in seconds (watch mode) |
| `--health-check` | — | boolean | `false` | Run structured health checks and exit |
| `--format` | — | string | — | Output format: `json` |

## Subcommands

| Subcommand | Description |
|---|---|
| `status agents` | Detailed agent status table (ID, type, current task, uptime, success rate) |
| `status tasks` | Detailed task status table (ID, type, priority, agent, progress) |
| `status memory` | Memory backend stats (entries, size, HNSW, performance metrics) |

## Examples

```bash
# One-shot status snapshot
npx monomind status

# Live watch mode (refreshes every 2s)
npx monomind status --watch

# Watch with custom interval
npx monomind status --watch -i 5

# Health checks with pass/warn/fail output
npx monomind status --health-check

# JSON output for scripting
npx monomind status --format json

# Detailed agent table
npx monomind status agents

# Detailed task table
npx monomind status tasks

# Memory backend details
npx monomind status memory
```

## Status Display Sections

- **Swarm** — ID, topology, health (`healthy` / `degraded` / `stopped`), uptime
- **Agents** — active / idle / total counts
- **Tasks** — pending / running / completed / failed / total
- **Memory** — backend, entries, size, search time, cache hit rate
- **MCP Server** — running state, transport, port
- **Performance** — CPU usage, memory usage, Flash Attention, vector search speed

## Health Check Mode

`--health-check` runs structured checks and exits with code 0 (all pass) or 1 (any fail):

| Check | Pass Condition |
|---|---|
| System Running | MCP/swarm reachable |
| Swarm Health | status = `healthy` |
| Agents Available | active > 0 |
| MCP Server | running |
| Memory Backend | backend != `none` |
| Task Success Rate | < 5% failure rate |

## Watch Mode

`--watch` clears the screen and re-renders on each interval. Press `Ctrl+C` to exit.

## MCP Tools (equivalent)

```javascript
// Swarm status
mcp__monomind__swarm_status({ includeMetrics: true })

// Memory stats
mcp__monomind__memory_stats({})

// Task summary
mcp__monomind__task_summary({})

// Agent list
mcp__monomind__agent_list({ includeMetrics: true, status: "all" })
```

## See Also

- `agent metrics` — performance metrics per agent type
- `agent health` — agent-specific health check
- `swarm status` — swarm-specific status
- `doctor` — comprehensive system diagnostics
