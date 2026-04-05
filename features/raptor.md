# RAPTOR — Recursive Abstractive Tree Indexing (arXiv:2401.18059)

**Source:** https://arxiv.org/abs/2401.18059  
**Category:** RAG Architecture Research  
**Role in Monobrain:** Cluster-then-summarize tree built inside the consolidate background worker

---

## What It Is

RAPTOR (Recursive Abstractive Processing for Tree Organized Retrieval) is a technique for improving RAG retrieval over large document collections. Standard RAG stores raw chunks and retrieves similar ones. RAPTOR additionally builds a tree of abstractions:

1. Cluster leaf chunks by semantic similarity (e.g., using Gaussian Mixture Models)
2. Summarize each cluster into an abstract node
3. Recursively cluster and summarize the abstract nodes
4. Store all levels of the tree — both leaf chunks and abstractions

At query time, retrieval can match against any level: precise leaf chunks for specific factual queries, higher-level abstractions for broad thematic queries. This enables "global" queries ("what are the main architectural themes of this codebase?") that standard chunk-level retrieval cannot answer.

## What We Extracted

### RAPTOR Tree via the `consolidate` Background Worker

Monobrain implements RAPTOR's key step — cluster episodic entries → summarize → store as higher-tier entries — inside the `consolidate` background worker (`runConsolidateWorker`):

**Step 1 — Cluster episodic entries**: The worker runs k-means clustering (simplified from GMM) over the HNSW embedding vectors of recent episodic-tier memory entries. Entries with cosine similarity > 0.75 are grouped into a cluster.

**Step 2 — Summarize each cluster**: For each cluster, the worker generates a summary using the LLM (Haiku tier — low cost). The summary captures the theme of the cluster without repeating all the details.

**Step 3 — Store as `contextual`-tier entry**: The summary is stored as a new `MemoryEntry` with `tier: 'contextual'`. This entry contains the abstract theme and references to all the leaf entries in its cluster.

**Step 4 — Recursive (one level)**: Monobrain implements one level of recursion: contextual-tier entries from multiple consolidation runs are themselves clustered and summarized into `executive`-tier entries (the highest abstraction level).

At retrieval time, global queries ("what are the main themes?") retrieve `executive`-tier and `contextual`-tier entries; specific queries retrieve `episodic`-tier entries; and PPR reranking (HippoRAG) bridges between levels.

## How It Improved Monobrain

RAPTOR solved the "global query" problem that pure vector search cannot handle. Before RAPTOR, asking "what are the recurring patterns in how we've solved authentication problems?" would return a handful of similar leaf memories but no coherent synthesis. After RAPTOR, the `consolidate` worker has already built a contextual-tier summary of the authentication cluster, and that summary becomes the retrieval target for broad thematic queries.

## Key Files Influenced

- `packages/@monobrain/cli/src/commands/hooks/consolidate-worker.ts` — `runConsolidateWorker()` RAPTOR implementation
- `packages/@monobrain/memory/src/agent-db.ts` — `MemoryEntry.tier` field (`episodic`/`contextual`/`executive`)
- `packages/@monobrain/memory/src/hnsw.ts` — embedding vectors used for clustering
- `hook-handler.cjs` `session-end` — triggers consolidate worker via intelligence.consolidate()
