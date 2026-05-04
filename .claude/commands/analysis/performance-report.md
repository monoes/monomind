---
name: analysis:performance-report
---

# performance-report

Generate performance metrics reports for swarm operations and system components.

## Usage

```bash
npx monomind performance metrics [options]
```

## Options

- `--timeframe, -t <range>` - Time range: `1h`, `24h` (default), `7d`, `30d`
- `--format, -f <type>` - Output format: `text` (default), `json`, `prometheus`
- `--component, -c <name>` - Filter to a specific component

## Examples

```bash
# Default 24h report
npx monomind performance metrics

# Last 7 days in JSON
npx monomind performance metrics --timeframe 7d --format json

# Prometheus-compatible output
npx monomind performance metrics --format prometheus

# Filter to memory component
npx monomind performance metrics --component memory
```

## Integration with Claude Code

```javascript
mcp__monomind__performance_report({
  timeRange: "24h",   // "1h" | "24h" | "7d"
  format: "summary",  // "json" | "summary" | "detailed"
  components: ["memory", "neural", "swarm"]  // optional filter
})
```

## See Also

- `performance benchmark` — run benchmark suites
- `performance bottleneck` — detect bottlenecks
- `performance optimize` — apply optimizations
- `token-usage` — token consumption by period
