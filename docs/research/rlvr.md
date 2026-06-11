# RLVR — Reinforcement Learning with Verifiable Rewards (opendilab/awesome-RLVR)

**Source:** https://github.com/opendilab/awesome-RLVR  
**Category:** Reinforcement Learning for LLMs  
**Role in Monomind:** Grounded binary reward signals for hook-based learning

---

## What It Is

Reinforcement Learning with Verifiable Rewards (RLVR) is an approach to training and fine-tuning LLMs where the reward signal comes from an external verifier that can definitively determine correctness — a unit test runner, a type checker, a linter, a math proof checker — rather than from a human rater or another LLM acting as a judge. Because the verifier produces ground-truth binary feedback (pass/fail), the reward signal is unambiguous and reproducible.

DeepSeek-R1's success demonstrated that RLVR with code execution as the verifier produces dramatically stronger reasoning in models trained on math and coding tasks.

## What We Extracted

### `hooksModelOutcome` with Verifier Types
Monomind's `hooks_post-task` hook was extended to accept a `verifier_type` field that specifies which external verifier determined the task's success or failure:

| `verifier_type` | Verifier | Signal source |
|-----------------|----------|---------------|
| `tsc` | TypeScript compiler | Exit code 0/non-0 |
| `vitest` | Vitest test runner | Test pass/fail count |
| `eslint` | ESLint linter | Error count |
| `llm_judge` | Secondary LLM | Score 0/1 |

When `verifier_type` is provided alongside an `exit_code`, the intelligence system uses this as a **grounded binary reward signal** — a definitive pass/fail rather than a heuristic. This reward feeds into the RETRIEVE→JUDGE→DISTILL pipeline as a high-confidence training signal.

Without a `verifier_type`, the system falls back to heuristic success detection (`hookInput.success !== false`), which is less reliable.

## How It Improved Monomind

RLVR changed the quality of the learning signals that feed the intelligence system. Before this influence, task success was inferred from the absence of errors in the hook input — a fragile heuristic. After, tasks that run a type checker or test suite can report their outcome as a verifiable binary signal, making the learned patterns much more reliable.

The practical result: patterns learned from `tsc`-verified tasks have higher confidence scores and decay more slowly than patterns from heuristically-assessed tasks.

## Key Files Influenced

- `hook-handler.cjs` `post-task` handler — `verifier_type` and `exit_code` processing
- Intelligence trajectory system — grounded reward signal injection
- `packages/@monomind/cli/src/commands/hooks/model-outcome.ts` — `hooksModelOutcome` command
- `LearningBridge` — confidence weighting by signal source quality
