# TextGrad — Automatic Differentiation via Text (arXiv:2406.07496)

**Source:** https://arxiv.org/abs/2406.07496 (Nature, 2024)  
**Category:** LLM Optimization Research  
**Role in Monomind:** Textual gradient critiques stored on failure, injected into next-prompt for self-correction

---

## What It Is

TextGrad is a framework that adapts automatic differentiation — the core mechanism of neural network training — to work with text. In standard backpropagation, gradients flow backward through a computation graph as numerical vectors, updating model weights. TextGrad replaces numerical gradients with **textual gradients**: natural language critiques that explain *why* an output was wrong and *how* it should be improved.

The computation graph is the LLM pipeline:
- **Forward pass**: LLM generates output given prompt
- **Loss evaluation**: Verifier/evaluator scores the output
- **Backward pass**: TextGrad asks the LLM to generate a critique of its own output given the score
- **Update step**: The critique (textual gradient) is injected into the next prompt

The paper reports +20% improvement on LeetCode-Hard problems, demonstrating that textual gradients are a practical training signal for LLM pipelines.

## What We Extracted

### Textual Gradient Storage on `hooks_post-task` Failure

When a task fails, Monomind's `post-task` hook triggers the textual gradient generation process:

**Forward pass result**: The failed task output (code, plan, response)  
**Loss signal**: The failure reason (test failure, compilation error, review rejection)  
**Textual gradient**: The LLM generates a critique structured as:
```
What went wrong: [specific failure description]
Why it went wrong: [root cause analysis]
How to improve: [concrete actionable changes]
```

This critique is stored as a `textual_gradient` entry in the `gradients` memory namespace:

```javascript
palace.storeVerbatim(CWD, textualGradient, {
  wing: 'gradients',
  room: agentSlug,
  hall: taskId,
});
```

**Next-prompt injection**: On the next task of the same type (same agent slug or similar task description), the `pre-task` hook retrieves the most recent relevant textual gradients and injects them as "previous attempt critiques" — giving the agent the self-corrective signal without requiring full model fine-tuning.

The combination of Memory Palace's BM25 retrieval and textual gradients means the agent effectively "remembers" its previous failures and their diagnosed causes.

## How It Improved Monomind

TextGrad addressed a fundamental problem: standard retry logic just repeats the same approach and hopes for a different result. Textual gradients give retries a direction — the agent knows specifically what not to repeat.

The +20% improvement on LeetCode-Hard is particularly relevant for Monomind's coding tasks. Complex multi-file refactors that fail on the first attempt now have a structured critique to guide the second attempt rather than starting from scratch.

## Key Files Influenced

- `hook-handler.cjs` `post-task` — `textual_gradient` generation trigger on failure
- `.claude/helpers/memory-palace.cjs` — `gradients` wing storage for textual gradient entries
- `hook-handler.cjs` `pre-task` — retrieval and injection of relevant textual gradients
- Intelligence trajectory system — gradient signals feed the JUDGE step
