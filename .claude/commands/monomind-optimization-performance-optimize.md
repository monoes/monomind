---
name: optimization:performance-optimize
description: Analyze and apply system-level performance optimizations — memory, CPU, and latency using npx monomind performance optimize
---

# performance optimize

Analyze and apply system-level performance optimizations — memory, CPU, and latency.

## Usage

```bash
npx monomind performance optimize [options]
```

## Options

| Flag | Short | Type | Default | Description |
|---|---|---|---|---|
| `--target` | `-t` | string | `all` | Optimization target: `memory`, `cpu`, `latency`, `all` |
| `--apply` | `-a` | boolean | `false` | Apply recommended optimizations |
| `--dry-run` | `-d` | boolean | `false` | Show recommended changes without applying |

## Examples

```bash
# Analyze and show recommendations (no changes)
npx monomind performance optimize --dry-run

# Optimize everything and apply
npx monomind performance optimize --target all --apply

# Memory-specific optimization
npx monomind performance optimize --target memory --apply

# CPU optimization only
npx monomind performance optimize --target cpu --apply

# Latency optimization (MCP response time)
npx monomind performance optimize --target latency --apply
```

## Optimization Targets

| Target | What It Optimizes |
|---|---|
| `memory` | Memory backend compression, HNSW rebuild, cache eviction |
| `cpu` | Agent pool sizing, task batching, concurrency limits |
| `latency` | MCP response caching, neural model quantization |
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

## MCP Tool

```javascript
mcp__monomind__performance_optimize({
  target: "all",
  apply: false
})
```

## See Also

- `performance bottleneck` — diagnose what to optimize first
- `performance benchmark` — measure optimization impact
- `performance metrics` — track performance over time
- `neural optimize` — optimize neural model weights
