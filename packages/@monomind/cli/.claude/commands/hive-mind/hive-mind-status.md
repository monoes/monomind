---
name: hive-mind:hive-mind-status
---

# hive-mind status

Show hive mind status including queen, workers, and optional detailed metrics.

## Usage
```bash
npx monomind hive-mind status [options]
```

## Options

| Flag | Short | Type | Default | Description |
|---|---|---|---|---|
| `--detailed` | `-d` | boolean | `false` | Include metrics (task counts, avg time, consensus rounds, memory) and health breakdown |
| `--watch` | `-w` | boolean | `false` | Watch for changes and refresh |
| `--format` | — | string | — | Output format: `json` |

## Examples

```bash
# Basic status
npx monomind hive-mind status

# Full metrics and health breakdown
npx monomind hive-mind status --detailed

# Watch mode (refreshes on change)
npx monomind hive-mind status --watch

# JSON output for scripting
npx monomind hive-mind status --format json
```

## Output

Basic status shows:
- Hive ID, status (active / idle / degraded / offline), topology, consensus
- Queen agent ID, status, load %, and queued task count
- Worker table: ID, type, status, current task, tasks completed

`--detailed` adds:
- Metrics table: total tasks, completed, failed, avg task time, consensus rounds, memory usage
- Health breakdown: overall, queen, workers, consensus, memory

## MCP Tool

```javascript
mcp__monomind__hive-mind_status({
  includeMetrics: true,  // set by --detailed
  includeWorkers: true
})
```
