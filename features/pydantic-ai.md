# pydantic-ai (pydantic/pydantic-ai)

> **Note:** References to `@monobrain/security` in this document are historical. That package was removed in the 2026-04-19 cleanup. Security features are now in `@monobrain/aidefence`.

**Source:** https://github.com/pydantic/pydantic-ai  
**Category:** Type-Safe Agent Framework  
**Role in Monobrain:** Typed I/O schemas, auto-retry on validation, deterministic test model, dynamic system prompts

---

## What It Is

pydantic-ai is Pydantic's official agent framework that brings strict type safety to LLM interactions. Its core premise: every agent has a declared input type, output type, and dependency injection contract — making agents testable, composable, and safe in production.

## What We Extracted

### 1. Typed `Agent[Deps, Result]` I/O Schemas
pydantic-ai's generic `Agent[Deps, Result]` forces the developer to declare what an agent receives and what it returns. Monobrain adopted this via the `BaseIOSchema` pattern (also reinforced by atomic-agents): every public-facing agent tool has a declared input schema validated at the boundary before any processing begins. This is implemented in `@monobrain/security`'s `InputValidator` using Zod schemas.

### 2. Auto-Retry on Validation Failure
pydantic-ai automatically retries an LLM call when the response fails output schema validation, passing the validation error back as context for the model to self-correct. Monobrain's `[AUTO_RETRY_ENABLED]` hook signal and the exponential-backoff retry policy in the coordinator path implement the same pattern.

### 3. TestModel for Deterministic CI
pydantic-ai's `TestModel` replaces the real LLM with a deterministic stub for unit testing, making agent tests fast and reproducible. Monobrain's test infrastructure uses the same concept — routing tests and hook handler tests mock the model call layer, verifying the surrounding logic without requiring live API access.

### 4. Dynamic System Prompt Functions
pydantic-ai allows system prompts to be functions that receive the current dependency context and return a string, making prompts context-aware at runtime. Monobrain's `PromptExperimentRouter` in `packages/@monobrain/cli/src/agents/prompt-experiment.ts` implements this pattern — the active prompt variant is resolved dynamically at agent spawn time based on the experiment configuration.

## How It Improved Monobrain

pydantic-ai's type-safety philosophy hardened Monobrain's input validation layer. Before this influence, tool inputs were validated loosely with `typeof` checks. After, all external-facing tools validate against Zod schemas that produce structured error messages rather than runtime crashes.

## Key Files Influenced

- `packages/@monobrain/security/` — `InputValidator` with Zod schemas
- `packages/@monobrain/cli/src/agents/prompt-experiment.ts` — dynamic system prompts
- `hook-handler.cjs` `pre-task` — `[AUTO_RETRY_ENABLED]` signal
- Agent test infrastructure — `TestModel` stub pattern
