---
name: monitoring:agents
---

# status agents

Show detailed agent status — ID, type, current task, uptime, and success rate for all running agents.

## Usage

```bash
npx monomind status agents [options]
```

## Options

| Flag | Type | Description |
|---|---|---|
| `--format` | string | Output format: `json` |

## Examples

```bash
# Show all agents
npx monomind status agents

# JSON output
npx monomind status agents --format json
```

## Output Columns

| Column | Description |
|---|---|
| ID | Agent identifier |
| Type | Agent type (coder, reviewer, tester, etc.) |
| Status | `healthy` / `degraded` / `stopped` |
| Current Task | Task the agent is executing (or `-`) |
| Uptime | How long the agent has been running |
| Success | Task success rate (%) |

## Related Commands

```bash
# Quick agent count overview (in main status)
npx monomind status

# Agent performance metrics by type
npx monomind agent metrics

# Agent health check
npx monomind agent health

# List all agents
npx monomind agent list
```

## MCP Tool

```javascript
mcp__monomind__agent_list({
  includeMetrics: true,
  status: "all"
})
```

## See Also

- `status` — full system status including agents
- `agent metrics` — performance metrics over time
- `agent health` — per-agent health checks
