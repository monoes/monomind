---
name: optimization:performance-optimize
description: Analyze system-level performance and get optimization recommendations — memory, latency, and throughput — using the mcp__monomind__performance_optimize MCP tool
---

# performance optimize

Analyze system-level performance and get optimization recommendations — memory, latency, and throughput.

There is no `optimize` subcommand of `monomind performance` — this is invoked
directly as an MCP tool call. It is a rule-based recommendation engine over
real CPU, memory, and disk readings: only garbage collection and probe-file
cleanup are applied automatically (with `aggressive: true`); everything else is
returned as a recommendation.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `target` | string | `all` | Optimization target: `memory`, `latency`, `throughput`, `all` |
| `aggressive` | boolean | `false` | Force GC (needs `--expose-gc`) and clear perf probe files |

## Examples

```javascript
// Analyze and show recommendations
mcp__monomind__performance_optimize({ target: "all" })

// Memory-specific recommendations, forcing a GC pass
mcp__monomind__performance_optimize({ target: "memory", aggressive: true })

// Latency recommendations (disk I/O)
mcp__monomind__performance_optimize({ target: "latency" })
```

## Optimization Targets

| Target | What It Checks |
|---|---|
| `memory` | System memory pressure, HNSW rebuild recommendation, forced GC (aggressive) |
| `latency` | Disk I/O latency, batching of file operations |
| `throughput` | Batch size for the CPU core count, CPU load throttling |
| `all` | All of the above |

## Related Commands

```bash
# Find bottlenecks before optimizing
npx monomind performance bottleneck

# Run benchmarks to measure before/after
npx monomind performance benchmark --suite all

# View current performance metrics
npx monomind performance metrics
```

## See Also

- `performance bottleneck` — diagnose what to optimize first
- `performance benchmark` — measure optimization impact
- `performance metrics` — track performance over time
- `neural optimize` — optimize neural model weights
