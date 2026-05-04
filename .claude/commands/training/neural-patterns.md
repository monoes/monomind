---
name: training:neural-patterns
description: Neural pattern training overview — automatic learning from operations, manual training, pattern types, and improvement tracking
---

# Neural Pattern Training

How Monomind continuously learns and improves through neural pattern training.

## How to Invoke

```
Skill("training:neural-patterns")
```

---

## Automatic Learning

Every successful operation trains the neural networks automatically:
- Edit patterns for different file types
- Search strategies that find results faster
- Task decomposition approaches
- Agent coordination patterns

The hooks system (`post-edit`, `post-task`) feeds successful operations into training automatically.

## Manual Training

```javascript
// Train coordination patterns
mcp__monomind__neural_train({ patternType: "coordination", epochs: 50 })

// Train security patterns with contrastive learning
mcp__monomind__neural_train({ patternType: "security", epochs: 100 })

// Check training status and pattern scores
mcp__monomind__neural_status({})

// Analyze recent patterns
mcp__monomind__neural_patterns({ action: "analyze", limit: 20 })
```

```bash
npx monomind neural train --pattern coordination --epochs 50
npx monomind neural status
npx monomind neural patterns --action analyze
```

## Pattern Types

| Pattern | Purpose |
|---------|---------|
| `coordination` | Multi-agent task coordination (default) |
| `optimization` | Performance and resource optimization |
| `prediction` | Task routing and agent selection |
| `security` | Security scanning and vulnerability detection |
| `testing` | Test strategy selection and coverage |

## Improvement Tracking

```javascript
// View current pattern scores and improvement
mcp__monomind__neural_status({ verbose: true })
```

Output includes pattern confidence scores and improvement percentage since last session.

## See Also

- `training:neural-train` — Full training options with WASM acceleration
- `training:pattern-learn` — Manual pattern storage
- `training:model-update` — Model optimization
