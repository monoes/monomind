# smolagents (huggingface/smolagents)

**Source:** https://github.com/huggingface/smolagents  
**Category:** Minimal Agent Framework  
**Role in Monobrain:** Explicit planning step, ManagedAgent delegation wrapper

---

## What It Is

smolagents is Hugging Face's deliberately minimal agent framework. Its design philosophy is "do less, but do it correctly" — reducing the agent loop to the bare essentials: think, act, observe. Despite its simplicity, it introduced two patterns that proved broadly applicable: an explicit planning phase before any execution begins, and a `ManagedAgent` wrapper for clean delegation.

## What We Extracted

### 1. Explicit Planning Step Before Execution
smolagents requires agents to produce a written plan before taking any action. This plan is not hidden — it is part of the conversation and can be inspected and corrected. Monobrain implements this via the `EnterPlanMode` mechanism in Claude Code and the `planner` agent type, which decomposes a task into a structured step list before any coding or editing begins.

The `pre-task` hook reinforces this pattern by emitting `[TASK_MODEL_RECOMMENDATION]` — a complexity-scored routing suggestion that includes an implicit planning signal: low-complexity tasks skip planning, high-complexity tasks route to an agent that will plan first.

### 2. ManagedAgent Delegation Wrapper
smolagents' `ManagedAgent` is a thin wrapper that gives a sub-agent a name, description, and input/output contract, then calls it as a tool from the parent agent's perspective. Monobrain's `Task` tool spawning pattern mirrors this exactly: each spawned agent is described by a `description` field, receives a self-contained `prompt`, and reports results back to the orchestrating agent.

The `claims` system extends this further — a ManagedAgent's work is "claimed" as a unit, with handoff protocols when the claiming agent completes or fails.

## How It Improved Monobrain

smolagents' minimalism was a corrective influence. Before its patterns were incorporated, the tendency was to add more features to the hook system. smolagents argued that the loop — plan, act, observe — should be kept lean and explicit rather than hidden in framework magic. This shaped Monobrain's philosophy of keeping the CJS helper layer thin and transparent: every decision the hook makes is logged with a `[TAG]` prefix that is visible to Claude.

## Key Files Influenced

- Claude Code's `EnterPlanMode` usage pattern
- `hook-handler.cjs` `pre-task` complexity scorer — planning signal
- `.claude/agents/planner.md` — explicit planning agent
- `packages/@monobrain/cli/src/swarm/claims/` — ManagedAgent delegation
