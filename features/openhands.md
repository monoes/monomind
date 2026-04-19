# OpenHands (All-Hands-AI/OpenHands)

> **Note:** References to `@monobrain/security` in this document are historical. That package was removed in the 2026-04-19 cleanup. Security features are now in `@monobrain/aidefence`.

**Source:** https://github.com/All-Hands-AI/OpenHands  
**Category:** AI Software Development Agent  
**Role in Monobrain:** Sandboxing, agent registry versioning, session replay

---

## What It Is

OpenHands (formerly OpenDevin) is an AI-powered software development agent platform that runs agents inside isolated sandbox environments. It introduced production-grade patterns for agent security, registry management, and deterministic session replay that are directly applicable to multi-agent systems.

## What We Extracted

### 1. Per-Agent Docker/WASM Sandboxing
OpenHands runs every agent action inside an isolated container or WASM sandbox, limiting the blast radius of errors and preventing agents from affecting each other's environments. Monobrain adopted this pattern via two mechanisms:
- **Docker sandboxing**: `SandboxConfig.use_gvisor` flag in deployment configuration (enhanced with gVisor's `runsc` runtime)
- **WASM agents**: The `wasm_agent_create` MCP tool launches agents in WASM-isolated contexts via the monobrain MCP server

### 2. Semantic Versioned Agent Registry (AgentHub)
OpenHands maintains an `AgentHub` — a registry of agents with semantic version numbers, compatibility matrices, and capability declarations. Monobrain's agent registry follows the same pattern: agents are versioned, and the `PromptVersionStore` (from `packages/@monobrain/cli/src/agents/prompt-experiment.ts`) manages prompt versions per agent slug with A/B experiment routing.

### 3. EventStream Session Replay
OpenHands captures every agent action as an event in an append-only stream, enabling exact replay of any session for debugging or verification. Monobrain's intelligence trajectory system (`hooks_intelligence trajectory-start`, `trajectory-step`, `trajectory-end`) implements the same pattern — each step of a task is logged as a structured event that can be replayed by the RETRIEVE→JUDGE→DISTILL pipeline.

## How It Improved Monobrain

OpenHands demonstrated that production AI agents require hard isolation boundaries between agents — not just logical separation but runtime-level sandboxing. This influenced Monobrain's security model to treat every agent as a potentially hostile process that must be contained.

The session replay model also proved essential for the learning system: without capturing every step as a structured event, the RuVector intelligence pipeline could not retroactively judge and distill lessons from past executions.

## Key Files Influenced

- `packages/@monobrain/security/` — sandbox configuration
- `packages/@monobrain/cli/src/agents/prompt-experiment.ts` — versioned agent registry
- `hook-handler.cjs` intelligence trajectory handlers — event stream capture
- `packages/@monobrain/cli/src/mcp-tools/` — WASM agent tools
