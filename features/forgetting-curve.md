# FOREVER Forgetting Curve (arXiv:2601.03938)

**Source:** https://arxiv.org/html/2601.03938v1  
**Category:** Memory Retention Research  
**Role in Monobrain:** Exponential importance-weighted memory decay replacing linear decay

---

## What It Is

The FOREVER paper introduces an importance-weighted forgetting curve for AI memory systems that models how information should decay over time based on its importance, not just its age. The key insight is that Ebbinghaus's classical forgetting curve (exponential decay of recall probability over time) should be modulated by an importance score: high-importance memories decay much more slowly than low-importance ones.

The proposed formula:

```
retention = importanceScore × e^(−λt)
```

Where:
- `importanceScore` ∈ [0, 1] — how significant the memory is
- `λ` — the decay rate (adjusted per memory tier)
- `t` — time elapsed since the memory was formed

This produces slow decay for important memories and fast decay for trivial ones, rather than treating all memories equally.

## What We Extracted

### Importance-Weighted Exponential Decay in `LearningBridge.decayConfidences()`
Monobrain's intelligence system maintains confidence scores for every learned pattern. Without a decay mechanism, patterns from six months ago would have equal weight to patterns from yesterday, even though the codebase has changed dramatically.

The FOREVER forgetting curve is implemented in `LearningBridge.decayConfidences()`:
- Each memory entry has an `importanceScore` field set at storage time
- On each `session-end`, confidences are decayed by `importanceScore × e^(−λt)`
- High-importance entries (architectural decisions, security patterns) decay slowly
- Low-importance entries (formatting preferences, single-use heuristics) decay quickly

`MemoryEntry.importanceScore` is set based on:
- Access frequency (frequently recalled = higher importance)
- Explicit annotation by agents (`@important` tag)
- Memory tier (entity/contextual tier entries start with higher importance than episodic)

## How It Improved Monobrain

Linear decay (subtract a fixed amount per day) was the original approach. It failed in two ways: important patterns decayed to zero even though they remained relevant, and trivial patterns persisted long after they ceased to be useful. The FOREVER curve fixed both problems by making the decay rate a function of importance, not just time.

The practical result: architectural patterns learned from early project decisions remain high-confidence through months of daily use, while incidental patterns (e.g., "used vim keybindings for a week") fade quickly.

## Key Files Influenced

- `packages/@monobrain/memory/src/learning-bridge.ts` — `decayConfidences()` implementation
- `packages/@monobrain/memory/src/agent-db.ts` — `MemoryEntry.importanceScore` field
- `hook-handler.cjs` `session-end` — triggers decay on session close
- Intelligence trajectory system — importance scoring based on outcome quality
