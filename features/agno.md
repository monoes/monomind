# Agno (agno-agi/agno)

**Source:** https://github.com/agno-agi/agno  
**Category:** Agent Framework  
**Role in Monomind:** AgentMemory knowledge base design and team-level coordination

---

## What It Is

Agno (formerly Phidata) is a lightweight framework for building AI agents with structured memory and tool use. Its key contribution is the `AgentMemory` class — a layered knowledge base that separates agent-specific memories from shared team knowledge — and its `Team` abstraction for coordinating multiple agents on a shared task.

## What We Extracted

### 1. AgentMemory Knowledge Base Architecture
Agno's `AgentMemory` separates three distinct concerns:
- **User memories**: Facts the agent learned about the person it works with
- **Agent memories**: What the agent has learned about its own performance and capabilities  
- **Run memories**: Context from the current execution

Monomind's AgentDB implements this three-way separation via memory namespaces. The `auto-memory` system (writing to `/Users/morteza/.claude/projects/.../memory/`) stores user-level facts, while agent-level patterns go to the `patterns` namespace and run-level context is held in the session's active working set.

### 2. Team-Level Agent Coordination Class
Agno's `Team` class manages a group of agents with a shared task context, distributing work and synthesizing results. Monomind's swarm coordination — particularly the `hierarchical-coordinator` agent type and the `swarm_init` + `agent_spawn` MCP tools — maps directly onto this pattern. The Team Lead (main Claude instance) maintains the shared task context while teammates work in parallel.

## How It Improved Monomind

Agno's clean separation of user / agent / run memories is what led Monomind to use namespaces as the primary memory organization unit rather than tags or timestamps. This makes it possible to retrieve "what has this agent learned about its own capabilities" separately from "what does the user prefer" — two fundamentally different query patterns that a single flat store cannot serve well.

## Key Files Influenced

- `packages/@monomind/memory/` — AgentDB namespace model
- `/Users/morteza/.claude/projects/.../memory/` — auto-memory user facts
- `packages/@monomind/cli/src/swarm/` — Team-level coordination
- `hook-handler.cjs` `post-task` — agent memory storage
