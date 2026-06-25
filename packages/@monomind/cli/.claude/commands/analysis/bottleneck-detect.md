---
name: analysis:bottleneck-detect
---

# bottleneck-detect

Detect performance bottlenecks in system components and swarm operations.

## Usage

```bash
npx monomind performance bottleneck [options]
```

## Options

- `--component, -c <name>` - Analyze a specific component (e.g. `memory`, `neural`, `swarm`)
- `--depth, -d <level>` - Analysis depth: `quick` (default) or `full`

## Examples

### Quick bottleneck scan

```bash
npx monomind performance bottleneck
```

### Deep analysis of a specific component

```bash
npx monomind performance bottleneck --component memory --depth full
```

## Metrics Analyzed

### Processing Bottlenecks

- CPU load and utilization
- Memory pressure and heap usage
- Disk I/O latency

### Swarm Bottlenecks

- Agent coordination overhead
- Task queue depth and wait times
- Parallel execution efficiency

### Memory Bottlenecks

- Cache hit rates
- Neural pattern load time
- Storage I/O performance

## Integration with Claude Code

```javascript
mcp__monomind__performance_bottleneck({
  component: "memory",   // optional — omit to scan all
  threshold: 20,         // alert threshold %
  deep: false            // set true for full analysis
})
```

## See Also

- `performance metrics` — detailed time-series metrics
- `performance optimize` — apply recommended fixes
- `performance benchmark` — run benchmark suites
- `token-usage` — token consumption analysis
