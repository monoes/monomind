# ERL — Experiential Reflective Learning (arXiv:2603.24639)

**Source:** https://arxiv.org/abs/2603.24639  
**Category:** Agent Learning Research  
**Role in Monobrain:** Structured heuristic extraction at post-task, ranked hint injection at pre-task

---

## What It Is

Experiential Reflective Learning (ERL) is a framework where AI agents learn from their own execution history by extracting structured heuristics — `{condition, action, confidence}` triples — from completed tasks, storing them, and injecting the most relevant ones as ranked hints before starting future tasks. The reflection loop: do → reflect → store → recall → do better.

The key innovation over naive experience replay is the structured format: instead of storing raw task transcripts, ERL distills each experience into a `condition` (when does this apply?) and `action` (what should be done?) pair with an associated confidence score. This makes retrieval by semantic similarity much more effective — you match on conditions, not raw text.

## What We Extracted

### Structured `{condition, action, confidence}` Heuristics

Monobrain implements ERL's heuristic lifecycle across two hook events:

**At `hooks_post-task`** (extraction):
When a task completes, the intelligence system extracts heuristics in structured format:
```json
{
  "condition": "TypeScript file with React hooks imports",
  "action": "Check for missing useCallback/useMemo around event handlers",
  "confidence": 0.85,
  "source": "task-trajectory-xyz"
}
```
These are stored to the `heuristics` memory namespace.

**At `hooks_pre-task`** (injection):
Before a new task starts, the system retrieves the top-k most relevant heuristics by matching the task description against stored conditions. The top heuristics are injected as ranked hints in the session context — suggestions the agent can use or ignore, not mandatory instructions.

The confidence score determines ranking: high-confidence heuristics appear first. Heuristics decay via the FOREVER forgetting curve if they aren't validated by future successes.

## How It Improved Monobrain

ERL bridges the gap between raw experience storage (which autogen and smolagents handle) and useful learning (which requires distillation). Without ERL's structured format, the intelligence system stored task transcripts and hoped semantic search would retrieve relevant ones. With structured heuristics, retrieval is precise — a TypeScript task retrieves TypeScript-specific heuristics, not Python ones.

The practical result: after 50+ tasks, the system's pre-task hints become genuinely useful productivity shortcuts rather than noisy irrelevant suggestions.

## Key Files Influenced

- `hook-handler.cjs` `post-task` — heuristic extraction trigger
- `hook-handler.cjs` `pre-task` — heuristic injection via `[INTELLIGENCE]` signal
- Intelligence trajectory system — `trajectory-end` fires heuristic distillation
- `packages/@monobrain/memory/` — `heuristics` namespace storage and retrieval
