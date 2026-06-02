# MonoVector Upstream WASM Packages

This directory contains references and integration bridges for upstream MonoVector WASM packages used by Monomind plugins.

## Available WASM Packages

| Package | Category | Description |
|---------|----------|-------------|
| `micro-hnsw-wasm` | Vector Search | Ultra-fast HNSW vector similarity search |
| `monovector-attention-wasm` | Neural | Flash attention mechanism (2.49x-7.47x speedup) |
| `monovector-gnn-wasm` | Graph | Graph Neural Networks for relationship modeling |
| `monovector-hyperbolic-hnsw-wasm` | Embeddings | Hyperbolic embeddings in Poincaré ball model |
| `monovector-learning-wasm` | Learning | Reinforcement learning algorithms |
| `monovector-nervous-system-wasm` | Coordination | Neural coordination for multi-agent systems |
| `monovector-economy-wasm` | Economics | Token economics and resource allocation |
| `monovector-exotic-wasm` | Quantum | Quantum-inspired optimization algorithms |
| `monovector-sparse-inference-wasm` | Inference | Sparse matrix inference for efficiency |
| `monovector-tiny-dancer-wasm` | Inference | Lightweight model inference (<5MB) |
| `monovector-mincut-wasm` | Graph | Graph mincut algorithms for partitioning |
| `monovector-fpga-transformer-wasm` | Accelerated | FPGA-accelerated transformer operations |
| `monovector-dag-wasm` | Graph | Directed Acyclic Graph processing |
| `cognitum-gate-kernel` | Cognitive | Cognitive computation kernels |
| `sona` | Neural | Self-Optimizing Neural Architecture |

## Upstream Repository

All packages are sourced from: https://github.com/nokhodian/monovector

## Active Plugin Dependencies

| Plugin | Primary WASM Packages |
|--------|----------------------|
| `@monomind/plugin-agentic-qe` | micro-hnsw-wasm, monovector-gnn-wasm, sona |
| `@monomind/plugin-gastown-bridge` | micro-hnsw-wasm, monovector-attention-wasm |
| `@monomind/plugin-prime-radiant` | monovector-exotic-wasm, monovector-hyperbolic-hnsw-wasm |
| `@monomind/teammate-plugin` | sona |

> 10 domain-specific plugins were archived — see `features/deleted-concepts.md` for details.

## Installation

```bash
# Install specific WASM bridges
npm install @monoes/micro-hnsw-wasm
npm install @monoes/attention-wasm
npm install @monoes/gnn-wasm
```

## Integration Pattern

```typescript
import { initMicroHnsw } from '@monoes/micro-hnsw-wasm';
import { FlashAttention } from '@monoes/attention-wasm';

// Initialize WASM modules
const hnsw = await initMicroHnsw();
const attention = await FlashAttention.init();

// Use in Monomind plugin
export const plugin: MonomindPlugin = {
  name: '@monomind/plugin-example',
  bridges: {
    hnsw,
    attention,
  },
};
```
