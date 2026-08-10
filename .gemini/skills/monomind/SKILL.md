---
name: monomind
description: Complete integration with Monomind — codebase knowledge graph (Monograph), persistent memory (L1/L2), Second Brain document vector search, autonomous agent orgs, and real-time statusline.
---

# Monomind Skill for Antigravity

Monomind extends Antigravity with a local codebase knowledge graph, persistent cross-session memory, semantic document search, autonomous agent orgs, and a real-time system statusline.

## Core Rules & Workflow Integration

### 1. Codebase Knowledge Graph (Monograph)
Before searching or modifying code touching 3+ files or exploring a new module:
- Call `mcp__monomind__monograph_suggest` to discover relevant files, bridge nodes, and isolated nodes.
- Call `mcp__monomind__monograph_query` for symbol/keyword search with HippoRAG-style PPR graph reranking.
- Call `mcp__monomind__monograph_impact` before editing to compute the exact blast radius of a symbol or class change.

### 2. Persistent Memory Loop
- **Recall**: Use `mcp__monomind__memory_search` to query past learnings, architectural rules, and session history before reinventing solutions.
- **Feedback**: After using memory search, call `mcp__monomind__memory_feedback` with entry IDs and outcome quality to continuously train search ranking.
- **Store**: Distill durable insights (entities, relations, lessons) into L2 memory via `mcp__monomind__memory_kg_ingest` or `mcp__monomind__memory_store`.

### 3. Second Brain (Document Vector Search)
- Project specs, handbooks, and notes indexed in `.monomind/data` or global brain (`~/.monomind/global-brain`) can be queried using `mcp__monomind__knowledge_search` or `npx monomind doc search -q "<query>"`.

### 4. Autonomous Orgs Daemon
- Run background role-based agent organizations using `monomind org run <name>`.
- Monitor active orgs via `monomind org status` or `monomind org list`.
- Check live agent questions using `monomind org questions <name>` and respond with `monomind org answer <name> <q-id> "<answer>"`.

### 5. Monomind Statusline
To inspect real-time project progress, domain coverage, graph node counts, and session cost metrics:
- Execute `node .gemini/helpers/statusline.cjs` (or `node .claude/helpers/statusline.cjs` / `npx monomind statusline`).

```bash
# Example statusline execution
node .gemini/helpers/statusline.cjs
```
