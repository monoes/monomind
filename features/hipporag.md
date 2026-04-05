# HippoRAG 2 — PPR Graph Retrieval (arXiv:2405.14831)

**Source:** https://arxiv.org/abs/2405.14831  
**Category:** Graph-Based RAG Research  
**Role in Monobrain:** Personalized PageRank reranking over the memory reference graph

---

## What It Is

HippoRAG 2 is a retrieval-augmented generation system inspired by the hippocampus's role in human memory — specifically its ability to form associative links between related memories and traverse those links during recall. The key innovation is using Personalized PageRank (PPR) over a knowledge graph of memory entries to expand and rerank HNSW vector search results.

Standard vector search finds the k most similar entries to a query. PPR graph retrieval starts from those k entries, then "flows" through the memory graph's reference edges, boosting entries that are reachable from multiple starting points. Entries that bridge several memory clusters (high betweenness centrality) receive the largest boosts.

The paper demonstrates up to 20% improvement on multi-hop QA benchmarks where the answer requires combining facts from two or more related memories.

## What We Extracted

### `MemoryGraph.pprRerank()` — One-Hop PPR Expansion

Monobrain implements a one-hop approximation of PPR reranking in `MemoryGraph.pprRerank()`:

1. **Start with HNSW candidates**: The standard vector search returns top-k entries by cosine similarity
2. **One-hop expansion**: For each HNSW candidate, load its `MemoryEntry.references` array (populated by A-MEM's automatic linking via `bridgeRecordCausalEdge`)
3. **Frequency-based boosting**: Count how many HNSW candidates each reachable entry appears in (via direct reference). Entries referenced by 2+ candidates receive a boost proportional to their reference frequency
4. **Reranked output**: The final result list merges the original HNSW scores with PPR boost scores, weighted 0.7 (vector) + 0.3 (PPR)

This is a significant simplification of full PPR (which uses the stationary distribution of a random walk), but it captures the core benefit: surfacing associative "bridging" memories that connect multiple relevant clusters.

**Example**: A query about "the login flow" retrieves memories about:
- `auth.ts` (direct HNSW match)
- `session.ts` (direct HNSW match)

PPR then boosts `token-validator.ts` because it appears in the `references` of both `auth.ts` and `session.ts` — it bridges them. Without PPR, `token-validator.ts` might not make the top-k even though it's central to understanding the login flow.

## How It Improved Monobrain

HippoRAG's insight that vector similarity alone misses associative knowledge is particularly important for a coding assistant. Code has deep dependency structures — understanding a bug requires knowing not just the file where it occurs but the chain of callers, the shared utilities, and the configuration that controls behavior. PPR reranking surfaces this associative context automatically.

## Key Files Influenced

- `packages/@monobrain/memory/src/memory-graph.ts` — `pprRerank()` implementation
- `packages/@monobrain/memory/src/agent-db.ts` — `MemoryEntry.references` field (set by A-MEM linker)
- `packages/@monobrain/memory/src/hnsw.ts` — base vector search feeding PPR expansion
- Memory search pipeline — combined vector + PPR scoring
