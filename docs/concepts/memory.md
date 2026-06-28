# Memory Systems

> Monomind has three memory layers that work together: Memory Palace (BM25 verbatim search), LanceDB (vector semantic search with HNSW), and Monograph (code knowledge graph). Each serves a different retrieval pattern.

---

## Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         MEMORY ARCHITECTURE                         │
│                                                                      │
│  L0 Identity (static)        L1 Story (top-5 scored)               │
│  .monomind/palace/           .monomind/palace/                      │
│  identity.md                 drawers.jsonl                           │
│         ↓ injected at session start                                 │
│                                                                      │
│  LanceDB (semantic)          Monograph (code graph)                 │
│  .monomind/*.db              .monomind/monograph.db                 │
│  HNSW vector index           SQLite + dependency graph              │
│                                                                      │
│  Hybrid mode (default): SQLite + LanceDB                            │
│  Solo mode: LanceDB only (no SQLite)                                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. Memory Palace

**Files:** `.monomind/palace/`  
**Package:** `.claude/helpers/memory-palace.cjs`  
**Zero AI calls** — entirely deterministic, runs locally.

### Storage Layers

| Layer | File | What | When |
|---|---|---|---|
| L0 Identity | `identity.md` | Project name, stack, key packages, working style | Injected on EVERY session start |
| L1 Story | `drawers.jsonl` (top-5 scored) | Recent high-value task outcomes | Injected on session start |
| L2 On-demand | `drawers.jsonl` (namespace filter) | `recall(wing, room, limit)` call | Explicit retrieval |
| L3 Deep search | `drawers.jsonl` (BM25) | `search(query, wing?, room?, limit?)` | Most comprehensive |

### Drawers (Verbatim Chunks)

Every stored content is split into **800-character chunks with 100-character overlap** (step=700):

```json
{
  "id": "a3f9b2c1-...",
  "content": "800 char verbatim slice...",
  "wing": "tasks|sessions|architecture|debugging|general",
  "room": "default|archive|active|{agentSlug}",
  "hall": "2026-04-15|{taskId}|optional-subdomain",
  "score": 3.5,
  "ts": "2026-04-15T07:49:00.000Z"
}
```

**Score semantics:** Starts at 1.0. Every retrieval bumps the score. High-score drawers rise to L1 (auto-injected). Low-score drawers drift to L3 (deep search only).

**Wing taxonomy:**
- `tasks` — post-task hook output (what was accomplished)
- `sessions` — session-end markers and summaries
- `architecture` — architectural decisions
- `debugging` — bug fix records
- `general` — catch-all

### BM25 Search (L3)

Parameters: K1=1.5 (term saturation), B=0.75 (length normalization).

**Closet boost:** Each `closets.jsonl` topic term matching the query adds +0.5 to that drawer's score. Closets are extracted automatically via regex (no AI): markdown headers, action phrases, proper nouns, quoted passages.

### Temporal Knowledge Graph (`kg.json`)

Triples with `valid_from`/`valid_to` for bi-temporal queries:

```json
{
  "subject": "session-1713...",
  "predicate": "ended_at",
  "object": "2026-04-15T11:30:00Z",
  "valid_from": "2026-04-15T11:30:00Z",
  "confidence": 1.0
}
```

---

## 2. LanceDB (`@monomind/memory`)

**Package:** `packages/@monomind/memory/`  
**Default backend:** HybridBackend (SQLite + LanceDB per ADR-009)

LanceDB is a first-class backend option. It uses LanceDB's columnar format, native IVF-PQ ANN search, SQL predicate push-down, and optional full-text search — all in one embedded Rust engine with no server process.

**Peer dependencies (optional):**

```bash
npm install @lancedb/lancedb apache-arrow
```

### Architecture

```
UnifiedMemoryService
  └── TierManager
        ├── Tier 1: ShortTermMemory (in-memory LRU, capacity 500, current run only)
        ├── Tier 2: SQLiteBackend (ACID, structured queries, exact matches) [hybrid mode only]
        ├── Tier 3: LanceDBBackend (semantic/vector via HNSW)
        └── Tier 4: DiskAnnBackend (optional, large-scale ANN)
```

### Operation Modes

#### Hybrid Mode (Default)

The default mode runs SQLite alongside LanceDB. Structured queries (exact matches, prefix, tag filters) route to SQLite; semantic and vector queries route to LanceDB. Dual-write keeps both backends in sync.

```
HybridBackend
  ├── SQLiteBackend  ← structured queries (exact/prefix/tag), ACID transactions
  └── LanceDBBackend ← semantic/vector search (HNSW + IVF-PQ)
```

#### Solo LanceDB Mode (SQLite-free)

When `semanticBackend` is set to `'lancedb'`, SQLiteBackend is never instantiated. Both the structured routing path and the semantic routing path point to the same `LanceDBBackend` instance. Dual-write is automatically disabled to prevent double-writes.

This mode is useful when you want a single-file columnar store with no SQLite dependency, or when deploying to environments where SQLite is unavailable.

```
HybridBackend (solo mode)
  └── LanceDBBackend ← all queries: structured + semantic + vector
```

**All routing paths (exact, prefix, tag, semantic, hybrid) transparently use LanceDB in solo mode.**

### Configuration

#### Environment variable

```bash
MONOMIND_MEMORY_BACKEND=lancedb
```

#### `monomind.config.json`

```json
{
  "memory": {
    "semanticBackend": "lancedb",
    "lancedb": {
      "dbPath": "./.monomind/lancedb"
    }
  }
}
```

#### Programmatic API

```typescript
// Solo LanceDB mode — no SQLite
const backend = new HybridBackend({
  semanticBackend: 'lancedb',
  lancedb: { dbPath: './.monomind/lancedb' },
});

// Hybrid mode (default) — SQLite + LanceDB
const backend = new HybridBackend({
  sqlite: { dbPath: './.monomind/memory.db' },
  lancedb: { dbPath: './.monomind/lancedb' },
  dualWrite: true,
});
```

### HNSW Index

Pure-TypeScript Hierarchical Navigable Small World implementation:

- **Complexity:** O(log n) query vs O(n) brute force
- **Optimizations:** BinaryMinHeap/BinaryMaxHeap for O(log n) priority queue, pre-normalized vectors for O(1) cosine, bounded max-heap for top-k
- **Distance metrics:** `cosine` (default), `euclidean`, `dot`, `manhattan`

### Backends

| Backend | Use case | Mode |
|---|---|---|
| `SQLiteBackend` | ACID, exact matches, metadata filters | Hybrid only |
| `LanceDBBackend` | Semantic vector search via HNSW + IVF-PQ; wraps `@lancedb/lancedb` | Both modes |
| `HybridBackend` | Default: routes semantic → LanceDB, structured → SQLite; or solo LanceDB when `semanticBackend='lancedb'` | Configurable |
| `SqljsBackend` | sql.js WASM fallback (browser/edge) | — |
| `PartitionedHNSW` | Timestamp-partitioned HNSW for temporally-local search | — |
| `DiskAnnBackend` | Disk-resident ANN graph for large corpora (Tier 4) | — |

### LanceDB Backend Configuration

```typescript
interface LanceDBBackendConfig {
  /** Directory for the Lance database files (default: ~/.monomind/lancedb) */
  dbPath?: string;

  /** Default namespace — also used as the table name (default: 'default') */
  namespace?: string;

  /** Vector dimension. Must match your embedding generator (default: 1536). */
  vectorDimension?: number;

  /** Embedding generator function */
  embeddingGenerator?: EmbeddingGenerator;

  /**
   * Build a full-text search index on content + key columns.
   * Requires at least one record in the table.
   */
  enableFts?: boolean;

  /**
   * IVF-PQ search probes (default: 20).
   * Higher = better recall, slower. Only applies after IVF-PQ index is built
   * (auto-triggered at 50k rows).
   */
  nProbes?: number;
}
```

### LanceDB Implementation Notes

The following behaviors are enforced in the current implementation:

- **Phantom table prevention:** Read paths (`get`, `getByKey`, `query`, `search`) use `openExistingTable()`, which checks `db.tableNames()` before opening. A namespace table is never created as a side effect of a read.
- **nProbes applied:** The `nProbes` config option is passed directly to `table.search().nprobes()` on every vector query, giving you control over recall vs. latency without code changes.
- **Zero-embedding prevention on `update()`:** `update()` performs a read-then-write round-trip via `get()` + `store()`. The existing `embedding` field is preserved from the stored record through `fromRecord()`, so calling `update()` with a partial payload never zeroes out an entry's vector.
- **Arrow upper bound fix:** Table creation uses a schema-inference placeholder row that is deleted immediately after the table is established, avoiding Arrow type inference issues with empty arrays.

### Memory Entry Schema

```typescript
interface MemoryEntry {
  id: string;
  key: string;
  content: string;
  embedding: Float32Array;
  type: 'episodic' | 'semantic' | 'procedural' | 'working' | 'cache';
  namespace: string;
  tags: string[];
  metadata: Record<string, unknown>;
  ownerId?: string;
  accessLevel: 'private' | 'team' | 'swarm' | 'public' | 'system';
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  eventAt?: number;          // bi-temporal model
  version: number;
  importanceScore: number;   // forgetting-curve replay weight
}
```

### Query API

```typescript
// Semantic search
await memory.semanticSearch("JWT authentication", 5);

// Fluent builder
await memory.query()
  .semantic()
  .inNamespace("auth")
  .withTags(["security"])
  .threshold(0.7)
  .limit(10)
  .build();
```

### MCP Tools (use inside Claude Code sessions)

```
mcp__monomind__memory_store      — store a memory entry
mcp__monomind__memory_search     — semantic + BM25 hybrid search
mcp__monomind__memory_retrieve   — get by id or key
mcp__monomind__memory_delete     — delete entry
mcp__monomind__memory_list       — list with filters
```

### CLI Commands

```bash
monomind memory init             # initialize memory backend
monomind memory store            # store entry (--content, --namespace, --tags)
monomind memory search "query"   # search (--mode semantic|bm25|hybrid, --threshold)
monomind memory list             # list entries (--namespace, --type, --limit)
monomind memory stats            # usage statistics
monomind memory cleanup          # prune expired/low-importance entries
monomind memory export           # export to JSON
monomind memory import           # import from JSON
```

---

## 3. Monograph (Code Knowledge Graph)

**Package:** `packages/@monomind/monograph/`  
**Database:** `.monomind/monograph.db` (SQLite)  
**Tools:** 43 MCP tools (`mcp__monomind__monograph_*`)

### What It Is

A static analysis engine that builds a dependency graph of the entire codebase. Nodes = files/symbols, edges = imports/exports/calls. Enables blast-radius analysis, architectural hotspot detection, and semantic code search.

### Building the Graph

```bash
# Code-only (fast, recommended for most tasks)
monomind monograph build --code-only

# Full build with LLM semantic extraction
monomind monograph build --llm

# Incremental watch mode
monomind monograph watch
```

### MCP Tools Quick Reference

| Tool | When to use |
|---|---|
| `monograph_suggest` | **Start every task** — returns files + relationships for your task description |
| `monograph_query` | Primary lookup — BM25 keyword search returning file + line number |
| `monograph_god_nodes` | Find high-centrality internal files (architectural hotspots) |
| `monograph_impact` | **Before changing anything** — blast radius: all upstream/downstream dependents |
| `monograph_context` | 360° view of a file: who imports it, what it imports |
| `monograph_shortest_path` | How two modules are connected |
| `monograph_community` | Which files form a cohesive module cluster |
| `monograph_rename` | Dry-run multi-file rename — all graph + text occurrences |
| `monograph_neighbors` | N-hop BFS neighborhood of a node |
| `monograph_bridge` | Cross-community connectors (architectural coupling points) |
| `monograph_cohesion` | Community quality: internal-to-max-possible edge ratio |
| `monograph_diff` | Compare two graph snapshots — added/removed nodes and edges |
| `monograph_snapshot` | Save graph state for before/after diffing |
| `monograph_cypher` | Ad-hoc graph queries: `MATCH (n)-[:IMPORTS]->(b) RETURN n.name` |
| `monograph_detect_changes` | Map current git diff to affected graph nodes + dependents |
| `monograph_health` | Index staleness: commits behind HEAD |
| `monograph_stats` | Node/edge counts |
| `monograph_build` | Trigger graph build |

### Additional Capabilities

- **Complexity metrics:** cyclomatic complexity, CRAP score, maintainability index per file
- **Clone detection:** near-duplicate code blocks
- **Health scoring:** A–F letter grade with badge export
- **CODEOWNERS:** GitHub/GitLab ownership analytics, bus factor
- **Coverage gaps:** untested exported functions
- **LSP server:** publishes diagnostics over Language Server Protocol
- **CI templates:** emits workflow YAML for GitHub Actions / CircleCI / GitLab CI
- **Export formats:** JSON, SVG, GraphML, Cypher, HTML, Markdown, SARIF, CodeClimate

---

## 4. Auto-Memory Bridge

The `AutoMemoryBridge` (`packages/@monomind/memory/`) automatically captures memory from hooks:

- `PostToolUse(Edit)` → records edit event → `pending-insights.jsonl`
- `post-task` → chunks task description → `drawers.jsonl`
- `session-end` → consolidates pending insights, archives session marker

### Cross-Session Persistence

All memory persists across sessions in `.monomind/`:

```
.monomind/
├── palace/
│   ├── identity.md          ← L0: static project identity (edit manually)
│   ├── drawers.jsonl        ← L1-L3: scored verbatim chunks
│   ├── closets.jsonl        ← topic index
│   └── kg.json              ← temporal knowledge graph triples
├── data/
│   ├── auto-memory-store.json  ← intelligence patterns
│   ├── ranked-context.json     ← pre-computed context rankings
│   └── pending-insights.jsonl  ← unsaved edit events (cleared on consolidate)
├── lancedb/                 ← LanceDB columnar files (solo or hybrid mode)
└── monograph.db             ← code knowledge graph
```

---

## 5. Learning Pipeline

The lean build records trajectories and outcomes rather than training a neural model.
During `session-end` and `consolidate`:

- **Trajectory + outcome logging** — steps and trajectories are recorded (`intelligence.ts`); command and route outcomes are tracked (`command-outcomes.ts`, `route-outcomes.ts`)
- **Consolidation** — dedup, detect contradictions, prune old patterns from `patterns.json`

Optional extensions:
- **EMBED** — ONNX document indexing
- **HYPERBOLIC** — Poincaré ball projection for hierarchy-preserving embeddings

These are backed by specialized workers (`ERLWorker`, `TextGradWorker`, `MARWorker`, `RaptorWorker`, `ForgettingCurveWorker`) running on a 30-minute interval in the background.

> The neural judge/distill loop (LLM-as-judge, strategy distillation, EWC++ consolidation) lives on the `monoes-full-loop` branch.
