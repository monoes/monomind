---
name: training:README
description: Training skill index — neural pattern training, model optimization, agent specialization, and pattern learning reference
---

# Training Skills

Neural network training, pattern learning, and agent specialization for Monomind.

## Available Skills

- [neural-patterns](./neural-patterns.md) — Overview of how automatic and manual neural training works
- [neural-train](./neural-train.md) — Train neural patterns with WASM acceleration (MicroLoRA + Flash Attention)
- [pattern-learn](./pattern-learn.md) — Analyze and store patterns from successful operations
- [model-update](./model-update.md) — Update and optimize trained neural models
- [specialization](./specialization.md) — Train agents to specialize in specific domains or file types

## Quick Start

```bash
# Train coordination patterns (50 epochs, WASM + Flash Attention)
npx monomind neural train --pattern coordination --epochs 50

# Check neural status
npx monomind neural status

# Analyze stored patterns
npx monomind neural patterns --action analyze
```

## MCP Tools

```javascript
mcp__monomind__neural_train({ patternType: "coordination", epochs: 50 })
mcp__monomind__neural_status({})
mcp__monomind__neural_patterns({ action: "list", limit: 10 })
mcp__monomind__neural_predict({ input: "task description" })
mcp__monomind__neural_optimize({ method: "quantize" })
```
