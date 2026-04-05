# GraphRAG + Practical GraphRAG (arXiv:2404.16130 + 2507.03226)

**Source:** https://arxiv.org/abs/2404.16130 | https://arxiv.org/abs/2507.03226  
**Category:** Graph-Based RAG Research  
**Role in Monobrain:** Community-level global query answering via `MemoryGraph.getCommunitySummaries()`

---

## What It Is

GraphRAG (Microsoft Research, 2024) is a RAG approach that builds a knowledge graph from the document corpus, detects communities of related entities (using Louvain community detection), generates summary reports for each community, and uses those summaries to answer global queries that require thematic understanding rather than specific fact retrieval.

Standard RAG: "Find the k most similar chunks to the query." Answers specific factual questions well, fails on broad thematic questions.

GraphRAG: "Identify relevant communities, retrieve their summaries, synthesize a global answer." Answers thematic questions well: "What are the main themes?", "What is the overall architecture?", "What patterns recur throughout the codebase?"

Practical GraphRAG (2025 follow-up) refines the approach with efficiency improvements and demonstrates that even a simplified one-level community structure captures most of the benefit.

## What We Extracted

### `MemoryGraph.getCommunitySummaries()` for Thematic Retrieval

Monobrain implements GraphRAG's community summary approach in the memory graph layer:

**Community detection**: The memory graph's Louvain clustering (also used in `@monoes/graph` for codebase analysis) groups semantically related memory entries into communities. Each community is identified by its centroid topic — the dominant theme of its member entries.

**Community summaries**: The `consolidate` background worker (RAPTOR's implementation) generates one summary per community. These summaries are stored as `contextual`-tier memory entries tagged with `community_id`.

**`getCommunitySummaries(query, k)`**: Given a query, this function:
1. Identifies which communities are relevant to the query (by matching query embedding against community centroids)
2. Returns the top-k community summary entries
3. These summaries are prepended to semantic search results before the LLM sees them

This means the LLM gets both: the precise matching leaf entries (standard RAG) AND the thematic context of the communities those entries belong to (GraphRAG's addition).

**Statusline integration**: The `[ARCH]` row's "DDD ▰▰▱▱▱ 2/5 domains" display is computed from community detection over the codebase graph — each detected community corresponds to a domain boundary.

## How It Improved Monobrain

GraphRAG addressed the "forest for the trees" problem: when an agent asks "how does this codebase handle errors?", standard vector search returns the 5 most similar memory entries about errors — but these might all be about one specific error pattern, missing the broader picture. `getCommunitySummaries()` prepends the error-handling community summary, giving the agent the architectural overview before it dives into specifics.

The practical result: global architectural questions get qualitatively better answers without requiring expensive LLM calls over the full memory corpus.

## Key Files Influenced

- `packages/@monobrain/memory/src/memory-graph.ts` — `getCommunitySummaries()` implementation
- `packages/@monobrain/memory/src/memory-graph.ts` — Louvain community detection
- `packages/@monobrain/cli/src/commands/hooks/consolidate-worker.ts` — community summary generation
- `.claude/helpers/statusline.cjs` — DDD domain coverage from community count
- `packages/@monobrain/graph/src/` — codebase-level community detection (`@monoes/graph`)
