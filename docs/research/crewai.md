# crewAI (crewAIInc/crewAI)

**Source:** https://github.com/crewAIInc/crewAI  
**Category:** Multi-Agent Framework  
**Role in Monomind:** Memory architecture, agent registry schema, task chaining

---

## What It Is

crewAI is a framework for orchestrating role-playing AI agents that work together as a "crew". Its memory architecture — separating short-term, long-term, entity, and contextual memory into distinct tiers — and its agent definition pattern (role + goal + backstory) became influential across the AI agent ecosystem.

## What We Extracted

### 1. Multi-Tier Memory Architecture
crewAI proved that one monolithic memory store is insufficient. Different information has different lifespans and retrieval patterns. Monomind adopted a four-tier model:

- **Short-term**: Active session context (injected via hooks)
- **Long-term**: AgentDB SQLite + HNSW vector index
- **Entity**: Knowledge graph triples (`kg.json` in Memory Palace)
- **Contextual**: RAPTOR-clustered summaries stored as `contextual`-tier entries in AgentDB

### 2. Role / Goal / Backstory Agent Registry
crewAI's agent definition format — `role`, `goal`, `backstory` as distinct fields — shaped how Monomind's agent markdown files are structured. Each agent file has a purpose statement, capability list, and behavioral constraints that map to these three concepts.

### 3. Task Context Chaining
crewAI allows a task's output to become the next task's input automatically. Monomind implements this via the hooks `pre-task` → `post-task` cycle: routing decisions from `pre-task` are stored to `last-route.json`, and the next agent picks up that context when it starts.

### 4. Output Schema Patterns
crewAI's typed output schemas for agent results — ensuring structured, parseable responses — informed Monomind's `BaseIOSchema` typed contracts (also reinforced by atomic-agents) and the `Agent[Deps, Result]` pattern from pydantic-ai.

## How It Improved Monomind

crewAI's memory tier model is the most direct influence on Monomind's AgentDB design. The separation of concerns between short, long, entity, and contextual memory means the system can answer different classes of queries efficiently — recency for short-term, semantic similarity for long-term, fact retrieval for entities, and abstract reasoning for contextual.

## Key Files Influenced

- `packages/@monomind/memory/` — AgentDB memory tier implementation
- `.claude/helpers/memory-palace.cjs` — entity-tier knowledge graph
- `.claude/agents/*.md` — role/goal/backstory structure
- `hook-handler.cjs` `pre-task` / `post-task` — context chaining
