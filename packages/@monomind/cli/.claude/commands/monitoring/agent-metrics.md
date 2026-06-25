---
name: monitoring:agent-metrics
---

# agent metrics

Show agent performance metrics — tasks completed, success rate, and memory vectors by agent type.

## Usage

```bash
npx monomind agent metrics [agentId] [options]
```

The optional `agentId` positional argument filters to a specific agent. Omit for all agents.

## Options

| Flag | Short | Type | Default | Description |
|---|---|---|---|---|
| `--period` | `-p` | string | `24h` | Time period: `1h`, `24h`, `7d`, `30d` |
| `--format` | — | string | — | Output format: `json` |

## Examples

```bash
# All agents — last 24 hours
npx monomind agent metrics

# Last hour
npx monomind agent metrics --period 1h

# Last 7 days
npx monomind agent metrics -p 7d

# Specific agent
npx monomind agent metrics agent-001

# JSON output
npx monomind agent metrics --format json
```

## Output Sections

**Summary table** — total agents, active agents, tasks completed, average success rate, memory vector count

**By Agent Type table** — per-type breakdown: count, tasks completed, success rate

**Memory** — vector count and search backend (HNSW-indexed once vectors exist)

## Data Source

Metrics are read from `.swarm/agents/` state files and `.swarm/swarm-activity.json`. If no agents have been spawned yet, the output will note this with a suggestion to run `agent spawn`.

## MCP Tool

```javascript
mcp__monomind__agent_status({ agentId: "agent-001" })
```

## See Also

- `status agents` — live agent status table
- `agent health` — per-agent health check with `--watch` mode
- `agent list` — list all agents
