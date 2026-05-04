---
name: training:model-update
description: Update and optimize trained neural models — quantize, compact, and export models using the real neural optimize and export CLI commands
---

# Model Update

Update, optimize, and export trained neural models.

## How to Invoke

```
Skill("training:model-update")
```

---

## CLI Reference

```bash
# Optimize a model (quantize for size/speed)
npx monomind neural optimize --method quantize

# Analyze model quality before/after optimization
npx monomind neural optimize --method analyze --verbose

# Compact model for faster inference
npx monomind neural optimize --method compact

# Check model status after update
npx monomind neural status --verbose

# Export a trained model
npx monomind neural export --model coordination
```

## MCP Tools

```javascript
// Optimize model (quantize/compact)
mcp__monomind__neural_optimize({ method: "quantize" })

// Compress for deployment
mcp__monomind__neural_compress({})

// Check model health and scores
mcp__monomind__neural_status({ verbose: true })

// SONA self-adapting model update
mcp__monomind__ruvllm_sona_adapt({ modelId: "coordination" })
```

## Optimization Methods

| Method | What it does |
|--------|-------------|
| `quantize` | Reduce model precision for smaller size and faster inference |
| `analyze` | Report model quality metrics without changing the model |
| `compact` | Prune low-value weights, reduce model footprint |

## Workflow

```bash
# 1. Analyze current state
npx monomind neural optimize --method analyze --verbose

# 2. Train with new data if needed
npx monomind neural train --pattern coordination --epochs 100

# 3. Optimize the updated model
npx monomind neural optimize --method quantize

# 4. Verify improvement
npx monomind neural status --verbose

# 5. Export for deployment
npx monomind neural export --model coordination
```
