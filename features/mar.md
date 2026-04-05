# Multi-Agent Reflexion (MAR) (arXiv:2512.20845)

**Source:** https://arxiv.org/html/2512.20845  
**Category:** Multi-Agent Reasoning Research  
**Role in Monobrain:** Heterogeneous reflection loop on task failure — Diagnoser → Critic×2 → Aggregator

---

## What It Is

Multi-Agent Reflexion (MAR) extends the single-agent Reflexion framework to multi-agent settings. Single-agent Reflexion has one agent reflect on its own failure and generate a self-critique. MAR introduces a **heterogeneous** reflection team with specialized roles:

1. **Diagnoser**: Analyzes what went wrong and why (root cause analysis)
2. **Critic × 2**: Two independent critics evaluate the diagnosis and propose improvements from different angles (diversity of perspective prevents echo-chamber critiques)
3. **Aggregator**: Synthesizes the two critiques into a unified improvement plan

The heterogeneous team produces higher-quality reflections than a single self-critiquing agent because each role applies specialized reasoning: the Diagnoser focuses on the technical failure, the Critics on alternative approaches, and the Aggregator on actionable synthesis.

## What We Extracted

### `marReflection` in `hooks_post-task` on Failure

When `hooks_post-task` receives a failed task signal (`success: false` or `status: 'failed'`), Monobrain's hook handler triggers the MAR reflection protocol by returning a `marReflection` object that specifies the four agent roles and their spawn order:

```json
{
  "marReflection": {
    "trigger": "task_failure",
    "taskId": "task-xyz",
    "agents": [
      { "role": "diagnoser", "subagent_type": "researcher", "priority": 1 },
      { "role": "critic-a",  "subagent_type": "reviewer",   "priority": 2 },
      { "role": "critic-b",  "subagent_type": "security-auditor", "priority": 2 },
      { "role": "aggregator","subagent_type": "planner",    "priority": 3 }
    ],
    "strategy": "sequential-then-parallel",
    "outputNamespace": "reflexion"
  }
}
```

The orchestrating agent (Claude Code) reads this signal and spawns the reflection team in the declared order: Diagnoser first (sequential), then both Critics in parallel, then the Aggregator to synthesize.

The Aggregator's output is stored to the `reflexion` memory namespace, where it becomes a high-importance entry that will be retrieved as a hint before the next similar task (via ERL's heuristic injection at `pre-task`).

## How It Improved Monobrain

Single-agent self-reflection is vulnerable to self-justification bias — an agent that fails tends to explain its failure in ways that minimize the need for fundamental change. MAR's heterogeneous team breaks this bias: the Diagnoser cannot see the Critics' analysis, and the Critics cannot see each other's, so their assessments are genuinely independent. The Aggregator then produces a synthesis that no single agent would have generated alone.

The practical result: failed tasks produce richer reflection that leads to more effective retries and better learned heuristics for future tasks.

## Key Files Influenced

- `hook-handler.cjs` `post-task` — `marReflection` signal generation on failure
- `.claude/agents/` — diagnoser, critic, aggregator role mappings
- `packages/@monobrain/memory/` — `reflexion` namespace for aggregated insights
- `hook-handler.cjs` `pre-task` — reflexion insights injected as pre-task hints
