---
name: optimization:README
description: Optimization skills index — swarm topology selection, parallel execution patterns, and system-level performance tuning
---

# Optimization Commands

Guides and commands for optimizing Monomind performance — swarm topology, parallel execution, and system-level tuning.

## Real CLI Commands

| Command | Description |
|---|---|
| `performance optimize` | Analyze and apply system optimizations (memory/CPU/latency) |
| `performance bottleneck` | Find performance bottlenecks |
| `performance benchmark` | Run benchmark suites (WASM/neural/memory/search) |
| `performance metrics` | View performance metrics over time |
| `neural optimize` | Quantize or compact neural model weights |
| `swarm init --topology` | Configure swarm topology for performance |

## Quick Reference

```bash
# Find what's slow
npx monomind performance bottleneck

# Get optimization recommendations (no changes)
npx monomind performance optimize --dry-run

# Apply all optimizations
npx monomind performance optimize --target all --apply

# Benchmark all subsystems
npx monomind performance benchmark --suite all

# Neural model quantization
npx monomind neural optimize --method quantize
```

## Files

- [auto-topology.md](./auto-topology.md) — Automatic topology selection and swarm configuration
- [parallel-execution.md](./parallel-execution.md) — Parallel agent execution patterns with Task tool
- [performance-optimize.md](./performance-optimize.md) — `performance optimize` CLI reference

## MCP Tools

| Tool | Purpose |
|---|---|
| `mcp__monomind__performance_optimize` | Apply performance optimizations |
| `mcp__monomind__performance_benchmark` | Run benchmarks |
| `mcp__monomind__performance_metrics` | Get performance metrics |
| `mcp__monomind__performance_bottleneck` | Detect bottlenecks |
| `mcp__monomind__performance_profile` | CPU/memory profiling |
| `mcp__monomind__coordination_topology` | Optimize swarm topology |
| `mcp__monomind__neural_optimize` | Neural model optimization |

## Performance Targets

| Metric | Target |
|---|---|
| Flash Attention | 2.49x–7.47x speedup |
| HNSW Search | 150x–12,500x faster |
| Memory Reduction | 50–75% with quantization |
| MCP Response | <100ms |
| CLI Startup | <500ms |

## See Also

- `performance` — full performance command set
- `neural` — neural training and optimization
- `memory compress` — memory-level optimization
- `hooks metrics` — intelligence system metrics
