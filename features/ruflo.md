# ruflo (ruvnet/ruflo)

**Source:** https://github.com/ruvnet/ruflo  
**Category:** Framework / Skeleton  
**Role in Monobrain:** Foundational architecture

---

## What It Is

Ruflo is an open-source multi-agent framework built by ruvnet that established the core patterns for swarm-based AI coordination within Claude Code. It introduced the concept of wiring Claude Code's hook system to a persistent agent coordination layer.

## What We Extracted

### 1. Swarm Coordination Skeleton
The entire swarm initialization and topology concept — hierarchical, mesh, ring, star, and adaptive topologies — traces directly back to ruflo's coordination model. Monobrain adopted this as its primary agent orchestration structure.

### 2. Hooks System
Ruflo introduced the idea of binding shell commands to Claude Code lifecycle events (pre-edit, post-edit, pre-task, post-task, session-start, session-end). Monobrain extended this into a full 17-hook + 12-background-worker system, but the original event-bus pattern came from ruflo.

### 3. SPARC Methodology
The Specification → Pseudocode → Architecture → Refinement → Completion (SPARC) structured development workflow was adopted wholesale. Monobrain exposes SPARC as a first-class set of agents (`sparc-coord`, `specification`, `pseudocode`, `architecture`, `refinement`, `sparc-coder`) and a CLI workflow.

## How It Improved Monobrain

Without ruflo, Monobrain would have started from scratch on the fundamental question of how to bridge a CLI tool to Claude Code's hook system. Ruflo answered that question by proving that a CJS helper registered as a `UserPromptSubmit` hook can observe every user input and inject routing recommendations, session state, and agent suggestions into the conversation context.

The hook-handler.cjs file — which is the only actually-running code layer in Monobrain — descends architecturally from ruflo's hook runner pattern.

## Key Files Influenced

- `.claude/helpers/hook-handler.cjs` — event dispatch pattern
- `.claude/settings.json` — hook registration format
- `packages/@monobrain/cli/src/` — command structure
- All SPARC-mode agents under `.claude/agents/`
