# DSPy (stanfordnlp/dspy)

**Source:** https://github.com/stanfordnlp/dspy | https://dspy.ai  
**Category:** Prompt Optimization Framework  
**Role in Monobrain:** Automatic prompt optimization (BootstrapFewShot + MIPRO) and Bayesian exploration

---

## What It Is

DSPy (Declarative Self-improving Python) treats LLM prompts as programs with learnable parameters rather than hand-written strings. Instead of manually crafting few-shot examples, DSPy optimizers (BootstrapFewShot, MIPRO, BayesianSignatureOptimizer) automatically search for the best prompts and examples by running the pipeline, measuring outcomes, and updating the prompt parameters.

## What We Extracted

### 1. `BootstrapFewShot` + MIPRO Automatic Prompt Optimization
DSPy's `BootstrapFewShot` collects traces from the current program's execution, filters to successful traces, and uses them as few-shot examples in future runs — automatically, without manual example curation. MIPRO extends this by jointly optimizing both the instruction text and the examples using a Bayesian surrogate model.

Monobrain implements this via `PromptOptimizer.optimize()` in `packages/@monobrain/cli/src/agents/prompt-experiment.ts`. Successful task trajectories (captured by the intelligence system) are scored, and the top-scoring traces become the few-shot pool for the next prompt version. The `PromptVersionStore` tracks which version is active for each agent slug.

### 2. Bayesian Exploration Option
DSPy's `BayesianSignatureOptimizer` adds controlled noise (U(0,0.1)) to trace scores before example selection, preventing the optimizer from converging too quickly to a local optimum when the evaluation signal is noisy. Monobrain exposes this as `PromptOptimizer.optimize({ bayesian: true })` — when enabled, trace scores are shuffled with uniform noise before `selectExamples` runs, diversifying the few-shot pool.

This is particularly useful when task success signals are sparse or ambiguous — adding noise keeps the optimizer exploring rather than exploiting a potentially misleading local maximum.

## How It Improved Monobrain

DSPy's core insight — that prompt engineering should be automated through systematic optimization rather than manual iteration — aligned with Monobrain's goal of building a self-improving system. Without DSPy's influence, the `hooks pretrain` command would have been a simple "collect examples and store them" step. With it, the command runs an actual optimization loop that improves prompt quality measurably across sessions.

The Bayesian exploration option also prevents a failure mode observed in early testing: when a particular agent slug had few examples, the optimizer would overfit to those examples. Adding noise breaks the overfit.

## Key Files Influenced

- `packages/@monobrain/cli/src/agents/prompt-experiment.ts` — `PromptOptimizer` and `PromptVersionStore`
- `hook-handler.cjs` `pre-task` — `[PROMPT_VERSION]` signal (resolved variant per agent)
- `packages/@monobrain/cli/src/commands/hooks/pretrain.ts` — bootstrap optimization loop
- Intelligence trajectory system — trace capture for few-shot pool
