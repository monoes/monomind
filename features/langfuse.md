# Langfuse (langfuse/langfuse)

**Source:** https://github.com/langfuse/langfuse  
**Category:** LLM Observability Platform  
**Role in Monomind:** Trace/span/generation hierarchy, per-agent cost attribution, latency views, prompt versioning

---

## What It Is

Langfuse is an open-source observability and analytics platform for LLM applications. It organizes telemetry into a three-level hierarchy — traces (full request lifecycle), spans (sub-operations within a trace), and generations (individual LLM calls) — and provides per-model cost tracking, latency percentiles, and prompt version analytics.

## What We Extracted

### 1. Unified Trace/Span/Generation Observability Hierarchy
Langfuse's three-level observability model maps cleanly onto Monomind's operation structure:
- **Trace**: A full task execution (from `pre-task` to `post-task`)
- **Span**: Each agent action within the task (file edit, bash command, tool call)
- **Generation**: Each individual LLM call made by an agent

Monomind's intelligence trajectory system (`trajectory-start`, `trajectory-step`, `trajectory-end`) implements this hierarchy. A trajectory is a trace; each step is a span; and LLM calls within steps can be tagged as generations.

### 2. Per-Agent Cost Attribution
Langfuse attributes token usage and cost to specific agents/prompts, enabling "which agent is most expensive?" analysis. Monomind's performance metrics system tracks `latencyMs` per agent slug (from `hookInput.latencyMs` in `post-task`) and logs it via `hooks performance benchmark`, enabling similar cost-per-agent analysis.

### 3. Latency Views
Langfuse's latency percentile views (p50, p90, p99 per operation) inspired Monomind's `performance profile` command, which reports response time distributions per operation type rather than just averages.

### 4. Prompt Version Management
Langfuse tracks which prompt version was active for each LLM call, enabling before/after comparisons when prompts change. Monomind's `PromptVersionStore` and the `[PROMPT_VERSION]` signal in `hook-handler.cjs` implement this: every agent spawn logs the active prompt version so the intelligence system can attribute performance changes to specific prompt updates.

## How It Improved Monomind

Langfuse's observability model gave Monomind a principled structure for the intelligence trajectory system. Without it, the trajectory would be a flat log. With it, the hierarchy makes it possible to answer: "which step of which task contributed most to the learned pattern?" — a question the RETRIEVE→JUDGE→DISTILL pipeline needs to answer correctly.

## Key Files Influenced

- `hook-handler.cjs` intelligence trajectory handlers — trace/span hierarchy
- `hook-handler.cjs` `post-task` handler — `latencyMs` attribution
- `packages/@monomind/cli/src/agents/prompt-experiment.ts` — prompt version tracking
- `packages/@monomind/cli/src/commands/performance/` — latency reporting
