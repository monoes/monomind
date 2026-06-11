# AutoGen (microsoft/autogen)

**Source:** https://github.com/microsoft/autogen  
**Category:** Multi-Agent Framework  
**Role in Monomind:** Human oversight, ephemeral agents, skill learning, retry patterns

---

## What It Is

AutoGen is Microsoft's framework for building multi-agent AI systems with conversational patterns. It introduced several production-grade patterns for managing agent lifecycles, human-in-the-loop control, and automatic skill acquisition from successful task executions.

## What We Extracted

### 1. Human Oversight Interrupt Gates
AutoGen's `human_input_mode` concept — where an agent can pause execution and request human confirmation before proceeding — was adapted into Monomind's pre-command risk assessment. When `hooks_pre-command` detects a destructive or ambiguous operation, it surfaces an interrupt signal that allows the user to review before execution continues.

### 2. AutoBuild Ephemeral Agents
AutoGen's `AgentBuilder` pattern creates temporary specialized agents for a single task and tears them down afterward. Monomind implements this via the `agent spawn` CLI command combined with the claims system — agents are registered, do their work, and their registration is pruned by the `post-task` hook's FIFO cleanup logic in `hook-handler.cjs`.

### 3. Procedural Skill Learning from Executions
AutoGen demonstrated that successful code executions could be captured and stored as reusable "skills" — structured `{description, code}` pairs. Monomind's `hooks_post-task` implements this by storing successful task patterns to the `patterns` memory namespace via `storeVerbatim` and the intelligence system's `trajectory-end` signal.

### 4. Tool-Retry Patterns
AutoGen's retry-on-error pattern for tool calls — exponential backoff with a max attempt count — was adopted as Monomind's `[AUTO_RETRY_ENABLED]` signal emitted from `hook-handler.cjs` when a swarm coordinator is active.

## How It Improved Monomind

AutoGen brought production robustness thinking to Monomind. Without it, the hook system would have been purely fire-and-forget with no retry logic and no human oversight mechanism. The ephemeral agent pattern keeps the agent registry clean between tasks rather than accumulating stale registrations.

## Key Files Influenced

- `hook-handler.cjs` `pre-command` handler — interrupt gate
- `hook-handler.cjs` `post-task` handler — FIFO registration cleanup
- `hook-handler.cjs` `pre-task` handler — `[AUTO_RETRY_ENABLED]` signal
- `packages/@monomind/cli/src/agents/` — agent lifecycle management
