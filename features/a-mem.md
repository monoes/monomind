# A-MEM — Agentic Memory (arXiv:2502.12110)

**Source:** https://arxiv.org/abs/2502.12110  
**Category:** Memory System Research  
**Role in Monobrain:** Zettelkasten-style automatic note linking via HNSW neighbor edges

---

## What It Is

A-MEM (Agentic Memory) is a memory system for AI agents that organizes stored information as a Zettelkasten — a network of interlinked atomic notes rather than a flat list. The key contribution is **automatic linking**: when a new memory is stored, the system finds its k-nearest neighbors in the embedding space and creates semantic edges between them. This transforms an isolated collection of notes into a traversable knowledge network.

The paper demonstrates that this linked structure significantly improves retrieval for multi-hop queries — questions that require combining information from multiple related memories rather than finding a single relevant one.

## What We Extracted

### Zettelkasten-Style Automatic Note Linking

Every time `bridgeStoreEntry()` stores a new memory in Monobrain's AgentDB, the system runs a post-store HNSW query to find the top-3 nearest neighbors above a 0.7 cosine similarity threshold. For each neighbor found, `bridgeRecordCausalEdge()` creates a `similar` edge between the new entry and the neighbor.

This creates a graph of memory entries where semantically related memories are linked, even if they were stored weeks apart and in different sessions. The graph enables:

1. **HippoRAG-style retrieval**: Start with HNSW results, then follow `similar` edges to expand the candidate set (implemented separately in HippoRAG's PPR reranking)
2. **Context coherence**: When recalling a memory about "auth bug fix", related memories about "session management" and "token validation" are automatically surfaced via their `similar` edges
3. **Memory consolidation**: The `consolidate` background worker can traverse `similar` edge clusters to identify semantically redundant memories and merge them

The 0.7 threshold was chosen empirically — below 0.7 produces too many false-link edges that add noise; above 0.7 misses genuinely related memories that use different vocabulary.

## How It Improved Monobrain

A-MEM's automatic linking transformed AgentDB from a flat vector store into a knowledge network. The most visible improvement is in multi-session continuity: when a task references "the authentication system we built last month," the system can now find not just the directly relevant memory entry but also its linked neighbors — the debugging session, the test suite, the security audit — giving the agent a complete picture of the authentication system's history.

## Key Files Influenced

- `packages/@monobrain/memory/src/agent-db.ts` — `bridgeStoreEntry()` post-store linking
- `packages/@monobrain/memory/src/agent-db.ts` — `bridgeRecordCausalEdge()` edge creation
- `packages/@monobrain/memory/src/hnsw.ts` — neighbor query for linking
- `packages/@monobrain/cli/src/commands/hooks/consolidate-worker.ts` — edge-cluster merging
