# @monobrain/memory

[![npm version](https://img.shields.io/npm/v/@monobrain/memory.svg)](https://www.npmjs.com/package/@monobrain/memory)
[![npm downloads](https://img.shields.io/npm/dm/@monobrain/memory.svg)](https://www.npmjs.com/package/@monobrain/memory)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Performance](https://img.shields.io/badge/Performance-150x--12500x%20Faster-brightgreen.svg)](https://github.com/nokhodian/monobrain)

> High-performance memory module for Monobrain V1 - AgentDB unification, HNSW indexing, vector search, self-learning knowledge graph, and hybrid SQLite+AgentDB backend (ADR-009).

## Features

- **150x-12,500x Faster Search** - HNSW (Hierarchical Navigable Small World) vector index for ultra-fast similarity search
- **Hybrid Backend** - SQLite for structured data + AgentDB for vectors (ADR-009)
- **Auto Memory Bridge** - Bidirectional sync between Claude Code auto memory and AgentDB (ADR-048)
- **Self-Learning** - LearningBridge connects insights to SONA/ReasoningBank neural pipeline (ADR-049)
- **Knowledge Graph** - PageRank + label propagation community detection + HippoRAG PPR re-ranking (ADR-049)
- **Agent-Scoped Memory** - 3-scope agent memory (project/local/user) with cross-agent knowledge transfer (ADR-049)
- **Vector Quantization** - Binary, scalar, and product quantization for 4-32x memory reduction
- **Multiple Distance Metrics** - Cosine, Euclidean, dot product, and Manhattan distance
- **Query Builder** - Fluent API for building complex memory queries
- **Cache Manager** - LRU caching with configurable size and TTL
- **Migration Tools** - Seamless migration from V2 memory systems
- **DiskANN Backend** - SSD-resident Vamana ANN graph for million-scale entry search (arXiv:2305.04359)
- **A-MEM Auto-Linking** - Bidirectional reference edges auto-created on store (arXiv:2409.11987)
- **GraphRAG Community Retrieval** - Community-level summaries annotate semantic search results (arXiv:2404.16130)
- **HippoRAG PPR Re-ranking** - Personalised PageRank re-ranks semantic results via knowledge graph (arXiv:2405.14831)
- **Collaborative Memory Promotion** - Entries auto-promoted to team scope after 3+ agent reads/24 h (arXiv:2505.18279)
- **Temporal Knowledge Graph** - Causal/temporal edge typing inspired by Zep/Graphiti (arXiv:2501.13956)
- **Injection Filter** - Structural prompt-injection detection on semantic search results (arXiv:2302.12173, arXiv:2310.12815)

## Installation

```bash
npm install @monobrain/memory
```

## Quick Start

```typescript
import { HNSWIndex, AgentDBAdapter, CacheManager } from '@monobrain/memory';

// Create HNSW index for vector search
const index = new HNSWIndex({
  dimensions: 1536,  // OpenAI embedding size
  M: 16,             // Max connections per node
  efConstruction: 200,
  metric: 'cosine'
});

// Add vectors
await index.addPoint('memory-1', new Float32Array(embedding));
await index.addPoint('memory-2', new Float32Array(embedding2));

// Search for similar vectors
const results = await index.search(queryVector, 10);
// [{ id: 'memory-1', distance: 0.05 }, { id: 'memory-2', distance: 0.12 }]
```

## API Reference

### HNSW Index

```typescript
import { HNSWIndex } from '@monobrain/memory';

const index = new HNSWIndex({
  dimensions: 1536,
  M: 16,                    // Max connections per layer
  efConstruction: 200,      // Construction-time search depth
  maxElements: 1000000,     // Max vectors
  metric: 'cosine',         // 'cosine' | 'euclidean' | 'dot' | 'manhattan'
  quantization: {           // Optional quantization
    type: 'scalar',         // 'binary' | 'scalar' | 'product'
    bits: 8
  }
});

// Add vectors
await index.addPoint(id: string, vector: Float32Array);

// Search
const results = await index.search(
  query: Float32Array,
  k: number,
  ef?: number  // Search-time depth (higher = more accurate)
);

// Search with filters
const filtered = await index.searchWithFilters(
  query,
  k,
  (id) => id.startsWith('session-')
);

// Remove vectors
await index.removePoint(id);

// Get statistics
const stats = index.getStats();
// { vectorCount, memoryUsage, avgSearchTime, compressionRatio }
```

### AgentDB Adapter

```typescript
import { AgentDBAdapter } from '@monobrain/memory';

const adapter = new AgentDBAdapter({
  dimension: 1536,
  indexType: 'hnsw',
  metric: 'cosine',
  hnswM: 16,
  hnswEfConstruction: 200,
  enableCache: true,
  cacheSizeMb: 256
});

await adapter.initialize();

// Store memory
await adapter.store({
  id: 'mem-123',
  content: 'User prefers dark mode',
  embedding: vector,
  metadata: { type: 'preference', agentId: 'agent-1' }
});

// Semantic search
const memories = await adapter.search(queryVector, {
  limit: 10,
  threshold: 0.7,
  filter: { type: 'preference' }
});

// Cross-agent memory sharing
await adapter.enableCrossAgentSharing({
  shareTypes: ['patterns', 'preferences'],
  excludeTypes: ['secrets']
});
```

### Cache Manager

```typescript
import { CacheManager } from '@monobrain/memory';

const cache = new CacheManager({
  maxSize: 1000,
  ttlMs: 3600000,  // 1 hour
  strategy: 'lru'
});

// Cache operations
cache.set('key', value);
const value = cache.get('key');
const exists = cache.has('key');
cache.delete('key');
cache.clear();

// Statistics
const stats = cache.getStats();
// { size, hits, misses, hitRate }
```

### Query Builder

```typescript
import { QueryBuilder } from '@monobrain/memory';

const results = await new QueryBuilder()
  .semantic(queryVector)
  .where('agentId', '=', 'agent-1')
  .where('type', 'in', ['pattern', 'strategy'])
  .where('createdAt', '>', Date.now() - 86400000)
  .orderBy('relevance', 'desc')
  .limit(20)
  .execute();
```

### Migration

```typescript
import { MemoryMigration } from '@monobrain/memory';

const migration = new MemoryMigration({
  source: './data/v2-memory.db',
  destination: './data/v1-memory.db'
});

// Dry run
const preview = await migration.preview();
console.log(`Will migrate ${preview.recordCount} records`);

// Execute migration
await migration.execute({
  batchSize: 1000,
  onProgress: (progress) => console.log(`${progress.percent}%`)
});
```

## Quantization Options

```typescript
// Binary quantization (32x compression)
const binaryIndex = new HNSWIndex({
  dimensions: 1536,
  quantization: { type: 'binary' }
});

// Scalar quantization (4x compression)
const scalarIndex = new HNSWIndex({
  dimensions: 1536,
  quantization: { type: 'scalar', bits: 8 }
});

// Product quantization (8x compression)
const productIndex = new HNSWIndex({
  dimensions: 1536,
  quantization: { type: 'product', subquantizers: 8 }
});
```

## Auto Memory Bridge (ADR-048)

Bidirectional sync between Claude Code's [auto memory](https://code.claude.com/docs/en/memory) files and AgentDB. Auto memory is a persistent directory (`~/.claude/projects/<project>/memory/`) where Claude writes learnings as markdown. `MEMORY.md` (first 200 lines) is loaded into the system prompt; topic files are read on demand.

### Quick Start

```typescript
import { AutoMemoryBridge } from '@monobrain/memory';

const bridge = new AutoMemoryBridge(memoryBackend, {
  workingDir: '/workspaces/my-project',
  syncMode: 'on-session-end', // 'on-write' | 'on-session-end' | 'periodic'
  pruneStrategy: 'confidence-weighted', // 'confidence-weighted' | 'fifo' | 'lru'
});

// Record an insight (stores in AgentDB + optionally writes to files)
await bridge.recordInsight({
  category: 'debugging',
  summary: 'HNSW index requires initialization before search',
  source: 'agent:tester',
  confidence: 0.95,
});

// Sync buffered insights to auto memory files
const syncResult = await bridge.syncToAutoMemory();

// Import existing auto memory files into AgentDB (on session start)
const importResult = await bridge.importFromAutoMemory();

// Curate MEMORY.md index (stays under 200-line limit)
await bridge.curateIndex();

// Check status
const status = bridge.getStatus();
```

### Sync Modes

| Mode | Behavior |
|------|----------|
| `on-write` | Writes to files immediately on `recordInsight()` |
| `on-session-end` | Buffers insights, flushes on `syncToAutoMemory()` |
| `periodic` | Auto-syncs on a configurable interval |

### Insight Categories

| Category | Topic File | Description |
|----------|-----------|-------------|
| `project-patterns` | `patterns.md` | Code patterns and conventions |
| `debugging` | `debugging.md` | Bug fixes and debugging insights |
| `architecture` | `architecture.md` | Design decisions and module relationships |
| `performance` | `performance.md` | Benchmarks and optimization results |
| `security` | `security.md` | Security findings and CVE notes |
| `preferences` | `preferences.md` | User and project preferences |
| `swarm-results` | `swarm-results.md` | Multi-agent swarm outcomes |

### Key Optimizations

- **Batch import** - `bulkInsert()` instead of individual `store()` calls
- **Pre-fetched hashes** - Single query for content-hash dedup during import
- **Async I/O** - `node:fs/promises` for non-blocking writes
- **Exact dedup** - `hasSummaryLine()` uses bullet-prefix matching, not substring
- **O(1) sync tracking** - `syncedInsightKeys` Set prevents double-write race
- **Prune-before-build** - Avoids O(n^2) index rebuild loop

### Utility Functions

```typescript
import {
  resolveAutoMemoryDir,  // Derive auto memory path from working dir
  findGitRoot,           // Walk up to find .git root
  parseMarkdownEntries,  // Parse ## headings into structured entries
  extractSummaries,      // Extract bullet summaries, strip metadata
  formatInsightLine,     // Format insight as markdown bullet
  hashContent,           // SHA-256 truncated to 16 hex chars
  pruneTopicFile,        // Keep topic files under line limit
  hasSummaryLine,        // Exact bullet-prefix dedup check
} from '@monobrain/memory';
```

### Types

```typescript
import type {
  AutoMemoryBridgeConfig,
  MemoryInsight,
  InsightCategory,
  SyncDirection,
  SyncMode,
  PruneStrategy,
  SyncResult,
  ImportResult,
} from '@monobrain/memory';
```

## Self-Learning Bridge (ADR-049)

Connects insights to the `@monobrain/neural` learning pipeline. When neural is unavailable, all operations degrade to no-ops.

### Quick Start

```typescript
import { AutoMemoryBridge, LearningBridge } from '@monobrain/memory';

const bridge = new AutoMemoryBridge(backend, {
  workingDir: '/workspaces/my-project',
  learning: {
    sonaMode: 'balanced',
    confidenceDecayRate: 0.005,   // Per-hour decay
    accessBoostAmount: 0.03,      // Boost per access
    consolidationThreshold: 10,   // Min insights before consolidation
  },
});

// Insights now trigger learning trajectories automatically
await bridge.recordInsight({
  category: 'debugging',
  summary: 'Connection pool exhaustion on high load',
  source: 'agent:tester',
  confidence: 0.9,
});

// Consolidation runs JUDGE/DISTILL/CONSOLIDATE pipeline
await bridge.syncToAutoMemory(); // Calls consolidate() first
```

### Standalone Usage

```typescript
import { LearningBridge } from '@monobrain/memory';

const lb = new LearningBridge(backend, {
  // Optional: inject neural loader for custom setups
  neuralLoader: async () => {
    const { NeuralLearningSystem } = await import('@monobrain/neural');
    return new NeuralLearningSystem();
  },
});

// Boost confidence when insight is accessed
await lb.onInsightAccessed('entry-123'); // +0.03 confidence

// Apply time-based decay
const decayed = await lb.decayConfidences('default'); // -0.005/hour

// Find similar patterns via ReasoningBank
const patterns = await lb.findSimilarPatterns('connection pooling');

// Get learning statistics
const stats = lb.getStats();
// { totalTrajectories, activeTrajectories, completedTrajectories,
//   totalConsolidations, accessBoosts, ... }
```

### Confidence Lifecycle

| Event | Effect | Range |
|-------|--------|-------|
| Insight recorded | Initial confidence from source | 0.1 - 1.0 |
| Insight accessed | +0.03 per access | Capped at 1.0 |
| Time decay | -0.005 per hour since last access | Floored at 0.1 |
| Consolidation | Neural pipeline may adjust | 0.1 - 1.0 |

## Knowledge Graph (ADR-049)

Pure TypeScript knowledge graph with PageRank and community detection. No external graph libraries required.

### Quick Start

```typescript
import { AutoMemoryBridge, MemoryGraph } from '@monobrain/memory';

const bridge = new AutoMemoryBridge(backend, {
  workingDir: '/workspaces/my-project',
  graph: {
    similarityThreshold: 0.8,
    pageRankDamping: 0.85,
    maxNodes: 5000,
  },
});

// Graph builds automatically on import
await bridge.importFromAutoMemory();

// Curation uses PageRank to prioritize influential insights
await bridge.curateIndex();
```

### Standalone Usage

```typescript
import { MemoryGraph } from '@monobrain/memory';

const graph = new MemoryGraph({
  pageRankDamping: 0.85,
  pageRankIterations: 50,
  pageRankConvergence: 1e-6,
  maxNodes: 5000,
});

// Build from backend entries
await graph.buildFromBackend(backend, 'my-namespace');

// Or build manually
graph.addNode(entry);
graph.addEdge('entry-1', 'entry-2', 'reference', 1.0);
graph.addEdge('entry-1', 'entry-3', 'similar', 0.9);

// Compute PageRank (power iteration)
const ranks = graph.computePageRank();

// Detect communities (label propagation)
const communities = graph.detectCommunities();

// Graph-aware ranking: blend vector score + PageRank
const ranked = graph.rankWithGraph(searchResults, 0.7);
// alpha=0.7 means 70% vector score + 30% PageRank

// Get most influential insights for MEMORY.md
const topNodes = graph.getTopNodes(20);

// BFS traversal for related insights
const neighbors = graph.getNeighbors('entry-1', 2); // depth=2
```

### Edge Types

| Type | Source | Description |
|------|--------|-------------|
| `reference` | `MemoryEntry.references` | Explicit cross-references between entries |
| `similar` | HNSW search | Auto-created when similarity > threshold |
| `temporal` | Timestamps | Entries created in same time window |
| `co-accessed` | Access patterns | Entries frequently accessed together |
| `causal` | Learning pipeline | Cause-effect relationships |

### Performance

| Operation | Result | Target |
|-----------|--------|--------|
| Graph build (1k nodes) | 2.78 ms | <200 ms |
| PageRank (1k nodes) | 12.21 ms | <100 ms |
| Community detection (1k) | 19.62 ms | — |
| `rankWithGraph(10)` | 0.006 ms | — |
| `getTopNodes(20)` | 0.308 ms | — |
| `getNeighbors(d=2)` | 0.005 ms | — |

## Agent-Scoped Memory (ADR-049)

Maps Claude Code's 3-scope agent memory directories for per-agent knowledge isolation and cross-agent transfer.

### Quick Start

```typescript
import { createAgentBridge, transferKnowledge } from '@monobrain/memory';

// Create a bridge for a specific agent scope
const agentBridge = createAgentBridge(backend, {
  agentName: 'my-coder',
  scope: 'project', // 'project' | 'local' | 'user'
  workingDir: '/workspaces/my-project',
});

// Record insights scoped to this agent
await agentBridge.recordInsight({
  category: 'debugging',
  summary: 'Use connection pooling for DB calls',
  source: 'agent:my-coder',
  confidence: 0.95,
});

// Transfer high-confidence insights between agents
const result = await transferKnowledge(sourceBackend, targetBridge, {
  sourceNamespace: 'learnings',
  minConfidence: 0.8,   // Only transfer confident insights
  maxEntries: 20,
  categories: ['debugging', 'architecture'],
});
// { transferred: 15, skipped: 5 }
```

### Scope Paths

| Scope | Directory | Use Case |
|-------|-----------|----------|
| `project` | `<gitRoot>/.claude/agent-memory/<agent>/` | Project-specific learnings |
| `local` | `<gitRoot>/.claude/agent-memory-local/<agent>/` | Machine-local data |
| `user` | `~/.claude/agent-memory/<agent>/` | Cross-project user knowledge |

### Utilities

```typescript
import {
  resolveAgentMemoryDir,  // Get scope directory path
  createAgentBridge,       // Create scoped AutoMemoryBridge
  transferKnowledge,       // Cross-agent knowledge sharing
  listAgentScopes,         // Discover existing agent scopes
} from '@monobrain/memory';

// Resolve path for an agent scope
const dir = resolveAgentMemoryDir('my-agent', 'project');
// → /workspaces/my-project/.claude/agent-memory/my-agent/

// List all agent scopes in a directory
const scopes = await listAgentScopes('/workspaces/my-project');
// [{ agentName: 'coder', scope: 'project', path: '...' }, ...]
```

## A-MEM Auto-Linking (arXiv:2409.11987)

When `HybridBackend` is configured with an `embeddingGenerator`, every stored entry
automatically discovers its top-3 semantic neighbors and creates bidirectional
`references` edges — implementing the Zettelkasten note-linking structure from A-MEM.

```typescript
const backend = new HybridBackend({
  embeddingGenerator: async (text) => myEmbeddingModel.embed(text),
  // A-MEM auto-linking is automatically active when embeddingGenerator is set
});

// Store any entry — references are linked asynchronously, best-effort
await backend.store(entry);

// After linking, querySemantic PPR re-ranking propagates scores through the
// newly created reference graph, improving recall for connected knowledge.
backend.on('amem:linked', ({ id, linkedTo }) =>
  console.log(`Linked ${id} to ${linkedTo.join(', ')}`));
```

## Injection-Safe Semantic Search

Set `filterInjection: true` to remove entries containing prompt-injection patterns
from semantic search results before they reach the agent context:

```typescript
const backend = new HybridBackend({
  embeddingGenerator: myEmbedder,
  filterInjection: true,    // Screen RAG results for indirect injection
});

// Filtered result — entries matching injection patterns are silently dropped
const entries = await backend.querySemantic({ content: 'OAuth patterns', k: 10 });

// Blocked entries are observable via event
backend.on('injection:blocked', ({ id, namespace }) =>
  securityLogger.warn(`Injection blocked from entry ${id}`));
```

Source: arXiv:2302.12173, arXiv:2310.12815 — indirect prompt injection in RAG pipelines.

## GraphRAG Community Retrieval (arXiv:2404.16130)

`querySemantic()` now captures community summaries from `MemoryGraph.getCommunitySummaries()`
and annotates each returned entry with its GraphRAG community metadata. This implements
the community-level summarisation strategy from Microsoft GraphRAG.

```typescript
const entries = await backend.querySemantic({ content: 'authentication patterns', k: 10 });
// Each entry now carries:
//   entry.community             — community ID string
//   entry.communityNodeCount    — number of nodes in that community
//   entry.communityAvgPageRank  — mean PageRank of community members
```

PPR re-ranking is handled by HippoRAG-style personalised PageRank (arXiv:2405.14831),
which propagates query-node scores through the knowledge graph before returning results.

## Collaborative Memory Promotion (arXiv:2505.18279)

`HybridBackend.get(id, agentId?)` accepts an optional `agentId` parameter. When
provided, it fires a read-tracking call to the SQLite backend, which promotes the
entry's `AccessLevel` from `'private'` to `'team'` once **3 or more distinct agents**
have accessed it within a 24-hour window.

```typescript
// Each agent reads with its own ID — no other change required
const entry = await backend.get('entry-id-123', 'coder-agent');

// After the third distinct agent reads it within 24 h:
// entry.accessLevel === 'team'
// (auto-promoted, visible to peer agents in the same namespace)
```

Collaborative promotion is transparent to callers that don't pass `agentId` —
`get(id)` continues to work exactly as before (backwards-compatible).

## Knowledge Graph & Temporal Edges (arXiv:2501.13956)

`MemoryGraph` models causal and temporal relationships between entries as typed
edges, inspired by the Zep/Graphiti episodic knowledge graph (arXiv:2501.13956).
Edge types include `REFERENCES`, `CAUSES`, `PRECEDED_BY`, `RELATED_TO`, and
`CONTRADICTS`, enabling episodic reasoning over the agent's memory history.

```typescript
import { MemoryGraph, type EdgeType } from '@monobrain/memory';

const graph = new MemoryGraph();
graph.addEdge('plan-123', 'code-456', EdgeType.CAUSES, 0.9);
graph.addEdge('code-456', 'test-789', EdgeType.PRECEDED_BY, 1.0);

const ranked = graph.pprRerank(['plan-123'], candidates, 0.85);
// Entries causally downstream of 'plan-123' score higher in PPR
```

## μACP Learning-Bridge Integration (arXiv:2601.03938)

`LearningBridge` integrates with the μACP coordination substrate: when consolidation
detects a pattern conflict between agents, it initiates a μACP round to resolve which
variant to promote. The result is stored as a causal edge in `MemoryGraph`.

```typescript
// Conflict resolution is automatic during consolidation:
await learningBridge.consolidate();
// Internally calls MuACP.coordinate() when divergent patterns are detected,
// then records the winning pattern as a CAUSES edge.
```

Source: arXiv:2601.03938.

## Bi-Temporal Query Filtering (arXiv:2501.13956)

`MemoryQuery` now supports `eventAfter` and `eventBefore` filters that operate on the
`eventAt` field — the timestamp of *when the event occurred* (T), as opposed to
`createdAt` which records *when the entry was ingested* (T'). This is the bi-temporal
model from Zep/Graphiti that prevents retrieval failures when data arrives out-of-order
or is backdated.

```typescript
const entries = await backend.query({
  type: 'hybrid',
  namespace: 'incidents',
  limit: 50,
  // Filter by WHEN THE INCIDENT HAPPENED — not when it was logged
  eventAfter:  new Date('2026-01-01').getTime(),
  eventBefore: new Date('2026-04-01').getTime(),
});

// Store with explicit event time (e.g. a past incident being recorded now)
await backend.store({
  key: 'outage-2026-02-14',
  content: 'DB connection pool exhausted during peak traffic',
  type: 'episodic',
  namespace: 'incidents',
  eventAt: new Date('2026-02-14T03:22:00Z').getTime(),  // event time
  // createdAt is auto-set to Date.now() (ingestion time)
  // ...
});
```

Source: arXiv:2501.13956 — Zep/Graphiti bi-temporal knowledge graph.

## MemoRAG Query Rewriting (arXiv:2409.05591)

`HybridBackend` supports a `memoragRewriter` configuration option that adds a
"draft clue" query-expansion stage before HNSW search. When configured, `querySemantic()`
calls the rewriter to generate 2-3 reformulated sub-queries, searches HNSW independently
for each, then fuses all ranked result lists using **Reciprocal Rank Fusion (RRF)** before
continuing with HippoRAG PPR re-ranking and GraphRAG community annotation.

This addresses the MemoRAG insight that naive RAG fails when the user query does not
directly match any retrievable chunk — paraphrased sub-queries dramatically improve recall.

```typescript
import { HybridBackend } from '@monobrain/memory';

const backend = new HybridBackend({
  embeddingGenerator: myEmbedder,
  memoragRewriter: async (query) => {
    // Use a cheap LLM (Haiku) or deterministic rules to produce sub-queries
    const reformulated = await callClaude({
      model: 'claude-haiku-4-5',
      prompt: `Generate 3 alternative search queries for: "${query}"\nRespond with a JSON array of strings.`,
    });
    return JSON.parse(reformulated); // e.g. ["...", "...", "..."]
  },
});

// querySemantic() now automatically expands + fuses results
const results = await backend.querySemantic({ content: 'memory leak in production' });
// RRF-fused results from sub-queries: "heap usage spike", "GC pressure", "OOM error"
```

Source: arXiv:2409.05591 — MemoRAG (TheWebConf 2025).

## DiskANN Backend — Large-Scale ANN at Disk Scale (arXiv:2305.04359)

`DiskAnnBackend` is an `IMemoryBackend` decorator that activates SSD-resident Vamana ANN search above entry-count thresholds. Wraps any existing backend (typically the long-term SQLite/AgentDB backend in `TierManager`).

### Architecture

- **Disk-persisted adjacency list** — Vamana graph written to `graphPath` as JSON
- **In-memory Int8-quantised vectors** — `Map<string, Int8Array>` for fast beam search
- **Beam search** — BFS traversal using Int8 dot-product as the candidate scorer
- **Full-precision cosine re-ranking** — fetches raw embeddings from the delegate backend

### Quick Start

```typescript
import { DiskAnnBackend, type DiskAnnBackendConfig } from '@monobrain/memory';

// Wrap any IMemoryBackend
const diskann = new DiskAnnBackend(existingBackend, {
  graphPath: './data/diskann.graph.json',
  R: 32,          // Max graph degree (default: 32)
  L: 64,          // Beam width (default: 64)
  beamWidth: 10,  // Search beam candidates (default: 10)
  dimensions: 128, // Vector dimensions (default: 128)
});

// All CRUD proxies through to the wrapped backend
await diskann.store(entry);
await diskann.get(id);

// ANN search uses beam traversal + cosine re-ranking
const results = await diskann.search(queryVector, { k: 5 });
// [{ entry: MemoryEntry, score: number }, ...]
```

### TierManager Integration

Pass `diskAnnConfig` to activate DiskANN on the long-term backend:

```typescript
import { TierManager } from '@monobrain/memory';

const tier = new TierManager(
  longTermBackend,
  { shortTermCapacity: 1000 },
  {}, // PartitionedHNSW config
  {   // DiskAnnBackendConfig — activates DiskANN
    graphPath: './data/diskann.graph.json',
    R: 32,
    beamWidth: 12,
  },
);

// tier.diskann is now populated — search() includes DiskANN results
const results = await tier.search('authentication patterns', 10);
```

### DiskAnnBackendConfig

| Field | Default | Description |
|-------|---------|-------------|
| `graphPath` | `'./diskann.graph.json'` | Path for persisted Vamana adjacency list |
| `R` | `32` | Max out-degree per node |
| `L` | `64` | Beam width during construction |
| `beamWidth` | `10` | Beam width during search |
| `dimensions` | `128` | Vector dimensions |

## Performance Benchmarks

| Operation | V2 Performance | V1 Performance | Improvement |
|-----------|---------------|----------------|-------------|
| Vector Search | 150ms | <1ms | **150x** |
| Bulk Insert | 500ms | 5ms | **100x** |
| Memory Write | 50ms | <5ms | **10x** |
| Cache Hit | 5ms | <0.1ms | **50x** |
| Index Build | 10s | 800ms | **12.5x** |

### ADR-049 Benchmarks

| Operation | Actual | Target | Headroom |
|-----------|--------|--------|----------|
| Graph build (1k nodes) | 2.78 ms | <200 ms | **71.9x** |
| PageRank (1k nodes) | 12.21 ms | <100 ms | **8.2x** |
| Insight recording | 0.12 ms/each | <5 ms/each | **41.0x** |
| Consolidation | 0.26 ms | <500 ms | **1,955x** |
| Confidence decay (1k) | 0.23 ms | <50 ms | **215x** |
| Knowledge transfer | 1.25 ms | <100 ms | **80.0x** |

## TypeScript Types

```typescript
import type {
  // Core
  HNSWConfig, HNSWStats, SearchResult, MemoryEntry,
  QuantizationConfig, DistanceMetric,

  // Auto Memory Bridge (ADR-048)
  AutoMemoryBridgeConfig, MemoryInsight, InsightCategory,
  SyncDirection, SyncMode, PruneStrategy,
  SyncResult, ImportResult,

  // Learning Bridge (ADR-049)
  LearningBridgeConfig, LearningStats,
  ConsolidateResult, PatternMatch,

  // Knowledge Graph (ADR-049)
  MemoryGraphConfig, GraphNode, GraphEdge,
  GraphStats, RankedResult, EdgeType,

  // Agent Scope (ADR-049)
  AgentMemoryScope, AgentScopedConfig,
  TransferOptions, TransferResult,
} from '@monobrain/memory';
```

## Dependencies

- `agentdb` - Vector database engine
- `better-sqlite3` - SQLite driver (native)
- `sql.js` - SQLite driver (WASM fallback)
- `@monobrain/neural` - **Optional peer dependency** for self-learning (graceful fallback when unavailable)

## Related Packages

- [@monobrain/neural](../neural) - Neural learning integration (SONA, ReasoningBank, EWC++)
- [@monobrain/shared](../shared) - Shared types and utilities
- [@monobrain/hooks](../hooks) - Session lifecycle hooks for auto memory sync

## License

MIT
