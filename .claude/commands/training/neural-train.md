---
name: training:neural-train
description: Train neural patterns with WASM SIMD acceleration — MicroLoRA, Flash Attention (2.49x-7.47x speedup), MoE routing, contrastive learning
---

# Neural Train

Train neural patterns with WASM acceleration using the real `npx monomind neural train` command.

## How to Invoke

```
Skill("training:neural-train")
```

---

## CLI Reference

```bash
# Train coordination patterns (default, 50 epochs)
npx monomind neural train --pattern coordination --epochs 50

# Train with Flash Attention speedup (2.49x-7.47x)
npx monomind neural train --pattern optimization --flash --epochs 100

# Train security patterns with contrastive learning (InfoNCE)
npx monomind neural train --pattern security --wasm --contrastive

# Train with Mixture of Experts routing
npx monomind neural train --pattern coordination --moe --epochs 200

# Train from a data file
npx monomind neural train --data ./training-data.json --flash

# Curriculum learning (easy → hard)
npx monomind neural train --pattern prediction --curriculum --epochs 150
```

## All Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--pattern` | `coordination` | Pattern type: coordination, optimization, prediction, security, testing |
| `--epochs` | `50` | Training epochs |
| `--data` | — | Training data file path or inline JSON |
| `--model` | — | Specific model ID to train |
| `--learning-rate` | `0.01` | Learning rate |
| `--batch-size` | `32` | Batch size |
| `--dim` | `256` | Embedding dimension (max 256) |
| `--wasm` | `true` | Use RuVector WASM SIMD acceleration |
| `--flash` | `true` | Enable Flash Attention (2.49x-7.47x speedup) |
| `--moe` | `false` | Enable Mixture of Experts routing (8 experts) |
| `--hyperbolic` | `false` | Hyperbolic attention for hierarchical patterns |
| `--contrastive` | `true` | Contrastive learning with InfoNCE loss |
| `--curriculum` | `false` | Curriculum learning (easy → hard progression) |

## MCP Tools

```javascript
// Train via MCP
mcp__monomind__neural_train({ patternType: "coordination", epochs: 50 })

// Check training progress
mcp__monomind__neural_status({ verbose: true })

// MicroLoRA adaptation
mcp__monomind__ruvllm_microlora_adapt({ modelId: "coordination", data: trainingData })
```

## After Training

```bash
# Verify training improved the model
npx monomind neural status --verbose

# Export the trained model
npx monomind neural export --model coordination
```
