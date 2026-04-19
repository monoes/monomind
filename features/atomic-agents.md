# Atomic Agents (KRunchPL/atomic-agents)

> **Note:** References to `@monobrain/security` in this document are historical. That package was removed in the 2026-04-19 cleanup. Security features are now in `@monobrain/aidefence`.

**Source:** https://github.com/KRunchPL/atomic-agents  
**Category:** Typed Agent Contracts Library  
**Role in Monobrain:** BaseIOSchema typed contracts, SystemPromptContextProvider composition

---

## What It Is

Atomic Agents is a framework built on the principle that AI agents should be composable primitives with strict typed contracts at every interface. Its two core contributions are `BaseIOSchema` — a Pydantic-based schema that every agent input and output must conform to — and `SystemPromptContextProvider` — a composable mechanism for injecting context into system prompts from multiple independent sources.

## What We Extracted

### 1. `BaseIOSchema` Typed Agent Contracts
Every agent in Atomic Agents declares its input and output as a `BaseIOSchema` subclass. This creates a machine-verifiable contract: if agent A's output schema matches agent B's input schema, they can be composed safely. Monobrain adopted this pattern for all MCP tool inputs — each tool's parameters are validated against a declared schema before execution, with structured errors returned on mismatch rather than silent failures or runtime crashes.

In `@monobrain/security`, the `InputValidator` class serves as the runtime enforcer of these contracts for all externally-facing tools.

### 2. `SystemPromptContextProvider` Composition
Atomic Agents' `SystemPromptContextProvider` allows multiple independent providers to contribute sections to an agent's system prompt — date/time context, user preferences, project rules, retrieved memories — and these are assembled at runtime without any provider knowing about the others. Monobrain's hook injection system works the same way: each `console.log('[TAG] ...')` call in `hook-handler.cjs` is one provider contributing one section to the session context, independently of all others.

The `[MEMORY_PALACE_L0]`, `[MEMORY_PALACE_L1]`, `[KNOWLEDGE_PRELOADED]`, `[SHARED_INSTRUCTIONS]`, and `[TASK_MODEL_RECOMMENDATION]` tags are each a separate context provider contributing a section to the session's working context.

## How It Improved Monobrain

Atomic Agents' composable system prompt pattern is what makes Monobrain's hook output readable and debuggable. Because each context contribution is tagged and independent, users can see exactly what each subsystem contributed. Without this pattern, the hook output would be an unstructured blob of text with no clear provenance.

The typed contract pattern also enabled safer inter-agent communication in the claims system — handoffs only succeed when the receiving agent's input schema matches the handing-off agent's output.

## Key Files Influenced

- `packages/@monobrain/security/src/input-validator.ts` — `BaseIOSchema` enforcement
- `hook-handler.cjs` — tagged context provider pattern (every `[TAG]` output)
- `packages/@monobrain/cli/src/swarm/claims/` — typed handoff contracts
- `.claude/agents/*.md` — structured capability declarations
