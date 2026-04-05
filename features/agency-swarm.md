# Agency Swarm (VRSEN/agency-swarm)

**Source:** https://github.com/VRSEN/agency-swarm  
**Category:** Multi-Agent Communication Framework  
**Role in Monobrain:** Directed communication flows, shared instruction propagation

---

## What It Is

Agency Swarm is a framework for building networks of AI agents where communication paths are explicitly declared as directional flows rather than free-form. Each agent can only communicate with agents it is explicitly connected to, preventing the "everyone talks to everyone" chaos that breaks down in large swarms.

## What We Extracted

### 1. Declared Directed Communication Flows
Agency Swarm forces the developer to declare which agents can talk to which — an adjacency graph of communication permissions. Monobrain implements this through swarm topology configuration. The `hierarchical` topology enforces that worker agents communicate only upward to their coordinator, not laterally. The `mesh` topology allows lateral communication but still follows declared connection patterns rather than open broadcast.

The `claims` system also encodes this directionally: an agent can only `handoff` to another agent that is declared as a valid recipient in the claims configuration.

### 2. Shared Instruction Propagation
Agency Swarm propagates a set of shared instructions to every agent in the swarm automatically, ensuring all agents operate under the same base rules without each needing its own copy. Monobrain implements this via `.agents/shared_instructions.md`, loaded at `SessionStart` and injected into the context with a hard 1500-character limit. Every agent operating in that session inherits these instructions without any additional configuration.

## How It Improved Monobrain

Agency Swarm's communication flow model solved a real problem that emerged during early Monobrain swarm runs: agents would route tasks back to the orchestrator instead of completing them, creating infinite loops. By enforcing directional communication at the topology level — workers push results up, they don't pull new tasks — the loop problem is structurally eliminated.

The shared instruction propagation model also reduced per-agent configuration overhead. Instead of duplicating common rules (concurrency patterns, file organization rules, tool call patterns) in every agent file, they live once in `shared_instructions.md` and propagate automatically.

## Key Files Influenced

- `packages/@monobrain/cli/src/swarm/topology/` — directed communication topologies
- `packages/@monobrain/cli/src/swarm/claims/` — directional handoff protocol
- `.agents/shared_instructions.md` — shared instruction propagation
- `hook-handler.cjs` `session-restore` — shared instructions loading
