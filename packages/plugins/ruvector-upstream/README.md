# RuVector Upstream WASM Packages

This directory contains references and integration bridges for upstream RuVector WASM packages used by Monobrain plugins.

## Available WASM Packages

| Package | Category | Description |
|---------|----------|-------------|
| `micro-hnsw-wasm` | Vector Search | Ultra-fast HNSW vector similarity search |
| `ruvector-attention-wasm` | Neural | Flash attention mechanism (2.49x-7.47x speedup) |
| `ruvector-gnn-wasm` | Graph | Graph Neural Networks for relationship modeling |
| `ruvector-hyperbolic-hnsw-wasm` | Embeddings | Hyperbolic embeddings in Poincaré ball model |
| `ruvector-learning-wasm` | Learning | Reinforcement learning algorithms |
| `ruvector-nervous-system-wasm` | Coordination | Neural coordination for multi-agent systems |
| `ruvector-economy-wasm` | Economics | Token economics and resource allocation |
| `ruvector-exotic-wasm` | Quantum | Quantum-inspired optimization algorithms |
| `ruvector-sparse-inference-wasm` | Inference | Sparse matrix inference for efficiency |
| `ruvector-tiny-dancer-wasm` | Inference | Lightweight model inference (<5MB) |
| `ruvector-mincut-wasm` | Graph | Graph mincut algorithms for partitioning |
| `ruvector-fpga-transformer-wasm` | Accelerated | FPGA-accelerated transformer operations |
| `ruvector-dag-wasm` | Graph | Directed Acyclic Graph processing |
| `cognitum-gate-kernel` | Cognitive | Cognitive computation kernels |
| `sona` | Neural | Self-Optimizing Neural Architecture |

## Upstream Repository

All packages are sourced from: https://github.com/nokhodian/ruvector

## Active Plugin Dependencies

| Plugin | Primary WASM Packages |
|--------|----------------------|
| `@monobrain/plugin-agentic-qe` | micro-hnsw-wasm, ruvector-gnn-wasm, sona |
| `@monobrain/plugin-gastown-bridge` | micro-hnsw-wasm, ruvector-attention-wasm |
| `@monobrain/plugin-prime-radiant` | ruvector-exotic-wasm, ruvector-hyperbolic-hnsw-wasm |
| `@monobrain/teammate-plugin` | sona |

> 10 domain-specific plugins were archived — see `features/deleted-concepts.md` for details.

## Installation

```bash
# Install specific WASM bridges
npm install @ruvector/micro-hnsw-wasm
npm install @ruvector/attention-wasm
npm install @ruvector/gnn-wasm
```

## Integration Pattern

```typescript
import { initMicroHnsw } from '@ruvector/micro-hnsw-wasm';
import { FlashAttention } from '@ruvector/attention-wasm';

// Initialize WASM modules
const hnsw = await initMicroHnsw();
const attention = await FlashAttention.init();

// Use in Monobrain plugin
export const plugin: MonobrainPlugin = {
  name: '@monobrain/plugin-example',
  bridges: {
    hnsw,
    attention,
  },
};
```
