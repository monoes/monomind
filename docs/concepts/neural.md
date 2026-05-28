# Neural Learning System

> Monomind's neural layer continuously learns from agent interactions using SONA (Self-Optimizing Neural Architecture), LoRA fine-tuning, EWC++ catastrophic forgetting prevention, and a Reasoning Bank for trajectory-based pattern extraction.

---

## SONA (Self-Optimizing Neural Architecture)

**Package:** `packages/@monomind/neural/`  
**Performance targets:** adaptation <0.05ms, pattern retrieval <1ms, learning step <10ms

SONA adapts to the project over time by extracting patterns from successful task trajectories and applying LoRA delta weights to improve routing and context injection.

### Five Operating Modes

| Mode | LoRA Rank | Batch | Trajectory Cap | Latency Budget | Memory |
|---|---|---|---|---|---|
| `real-time` | 2 | 32 | 1,000 | 0.5ms | 25MB |
| `balanced` | 4 | 32 | 3,000 | 18ms | 50MB |
| `research` | 16 | 64 | 10,000 | 100ms | 100MB |
| `edge` | 1 | 16 | 200 | 1ms | 5MB |
| `batch` | 8 | 128 | 5,000 | 50ms | 75MB |

**`real-time` specifics:** 2200 ops/sec, micro-LoRA enabled, FP16 half-precision, SIMD vectorization, async updates, quality threshold 0.7.

**`research` mode:** gradient checkpointing enabled, EWC lambda=2500, quality threshold 0.2 (accepts most trajectories for exploration).

**`edge` mode:** SIMD disabled, micro-LoRA rank 1, no async updates, strict quality threshold 0.8.

---

## LoRA (Low-Rank Adaptation)

Applied as rank decomposition matrices to adapt attention layers. Rank range 1–16.

"Micro-LoRA" further reduces parameter count for edge/real-time modes.

Higher rank → more expressive updates, higher compute cost. Lower rank → faster, less memory.

---

## EWC++ (Elastic Weight Consolidation)

Prevents catastrophic forgetting — when SONA learns a new pattern, EWC++ penalizes changes to weights that were important for previous patterns.

EWC lambda controls the penalty weight (configured per-mode: 1500–2500). Higher lambda = stronger retention of old patterns = safer for production use.

---

## Reasoning Bank

Stores and retrieves `Trajectory` objects — sequences of steps with:
- `stateBefore` / `stateAfter` embeddings
- rewards
- attention weights

4-step pipeline:
1. **RETRIEVE** — top-k nearest trajectories via HNSW
2. **JUDGE** — LLM-as-judge quality evaluation
3. **DISTILL** — extract `DistilledMemory` from high-quality trajectories
4. **CONSOLIDATE** — dedup, detect contradictions, prune low-value patterns

---

## PatternLearner

Extracts `Pattern` objects from successful trajectories. Supports `findMatches(queryEmbedding, k)` for nearest-pattern retrieval during routing.

Patterns accumulate over sessions and are used to:
- Pre-select agents before the user even submits a task
- Suggest model tiers for known task types
- Inject relevant context from past successes

---

## RL Algorithms

All implemented under a unified `RLAlgorithm` interface:

| Algorithm | Use case |
|---|---|
| `PPOAlgorithm` | Proximal Policy Optimization for complex multi-step tasks |
| `DQNAlgorithm` | Deep Q-Network for discrete action spaces |
| `A2CAlgorithm` | Advantage Actor-Critic for continuous learning |
| `DecisionTransformer` | Sequence modeling for trajectory-based decisions |
| `QLearning` | Simple Q-learning for fast adaptation |
| `SARSAAlgorithm` | On-policy Q-learning variant |
| `CuriosityModule` | Intrinsic motivation for exploration |

Factory: `createAlgorithm(type, config)` — selects the right algorithm for the task.

---

## NeuralLearningSystem (Public API)

The `NeuralLearningSystem` composes `SONAManager` + `ReasoningBank` + `PatternLearner`:

```typescript
// Start tracking a task
const trajectoryId = await neural.beginTask(context, "feature-development");

// Record each step
await neural.recordStep(trajectoryId, action, reward, embedding);

// Complete and trigger learning
await neural.completeTask(trajectoryId, qualityScore);

// Use learned patterns
const patterns = await neural.findPatterns(queryEmbedding, 5);
const memories = await neural.retrieveMemories(queryEmbedding, 3);

// Manual trigger
await neural.triggerLearning();

// Stats
const stats = await neural.getStats();
// → { sona: {...}, reasoningBank: {...}, patternLearner: {...} }
```

---

## CLI Commands

```bash
# Train on current patterns
monomind neural train --flash          # 2.49x-7.47x speedup via Flash Attention
monomind neural train --moe            # Mixture of Experts routing
monomind neural train --contrastive   # Contrastive learning
monomind neural train --curriculum    # Curriculum learning schedule

# Analyze patterns
monomind neural patterns list
monomind neural patterns search "authentication"

# Optimize model
monomind neural optimize --method quantize  # reduce size
monomind neural optimize --method analyze   # performance analysis
monomind neural optimize --method compact   # prune low-value patterns

# Stats
monomind neural status
```

---

## MCP Tools

```
mcp__monomind__neural_train       — trigger training
mcp__monomind__neural_predict     — get pattern prediction for a task
mcp__monomind__neural_patterns    — list/search patterns
mcp__monomind__agentdb_pattern_store  — store a learned pattern
mcp__monomind__agentdb_pattern_search — search stored patterns
```

---

## Background Learning Workers

Neural learning runs continuously via background workers:

| Worker | Interval | What it does |
|---|---|---|
| `learning` | 30 min | Optimize SONA adaptation; runs ERL, TextGrad, RAPTOR, forgetting-curve sub-tasks |
| `ERLWorker` | On demand | Experiential Reflective Learning (arXiv:2603.24639) |
| `TextGradWorker` | On demand | Backward pass via textual gradients (arXiv:2406.07496) |
| `MARWorker` | On demand | Multi-Agent Reflexion (arXiv:2512.20845) |
| `RaptorWorker` | On demand | Recursive Abstractive Tree Indexing cluster summarization (arXiv:2401.18059) |
| `ForgettingCurveWorker` | On demand | Ebbinghaus decay scheduling for pattern replay |

---

## 3-Tier Model Routing (ADR-026)

The neural system integrates with model routing to select the right Claude model per task:

| Tier | Handler | Latency | Cost | Complexity threshold |
|---|---|---|---|---|
| 1 | Agent Booster (WASM) | <1ms | $0 | Simple transforms — skip LLM entirely |
| 2 | Haiku 4.5 | ~500ms | $0.0002/task | <30% complexity score |
| 3 | Sonnet/Opus 4.6 | 2–5s | $0.003–0.015/task | >30% complexity score |

**Complexity score** is computed from:
- Word count of task description
- Presence of high-complexity keywords (authentication, architecture, consensus, security, performance, refactor)
- File types affected

Output in terminal: `[TASK_MODEL_RECOMMENDATION] Use model="sonnet"`

Check for `[AGENT_BOOSTER_AVAILABLE]` tag before spawning agents — if present, use `Edit` tool directly instead of spawning a subagent.
