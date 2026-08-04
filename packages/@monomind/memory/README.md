<p align="center">
  <img src="https://raw.githubusercontent.com/monoes/monomind/main/assets/packages/memory.png" alt="@monoes/memory" width="600" />
</p>

# @monoes/memory

[![npm version](https://img.shields.io/npm/v/@monoes/memory?style=flat-square)](https://www.npmjs.com/package/@monoes/memory)
[![license](https://img.shields.io/npm/l/@monoes/memory.svg?style=flat-square)](https://github.com/monoes/monomind/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-blue?style=flat-square)](https://nodejs.org)

**Persistent memory backends for Monomind agents** — SQLite in WAL journal mode (`PRAGMA journal_mode = WAL`, schema v3.0.0) key-value storage with dense ONNX ModernBERT 768d + Okapi BM25 RRF hybrid search, surface query routing, Open Knowledge Format (OKF) transfer, Cognee-style knowledge graph triplets, and EWC pattern consolidation.

> Part of the [Monomind](https://github.com/monoes/monomind) ecosystem. The embedded storage layer uses `better-sqlite3` with `sql.js` (WASM zero-compile fallback).

## Install

```bash
npm install @monoes/memory

# optional: native SQLite (faster than the sql.js WASM fallback)
npm install better-sqlite3
```

## Core Architecture & Schema v3.0.0

### Schema Architecture & Storage Engine
- **Storage Driver**: Operates over SQLite with WAL mode (`PRAGMA journal_mode = WAL`) using `better-sqlite3` with a WASM `sql.js` fallback.
- **Dual Schema Support**:
  - Standalone `@monoes/memory` core schema ([`packages/@monomind/memory/src/sql-schema.ts:28`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/memory/src/sql-schema.ts#L28)): `SCHEMA_VERSION = 2` managing **4 tables** (`memory_entries`, `memory_embeddings`, `memory_entry_tags`, `agent_reads`).
  - CLI project memory schema ([`packages/@monomind/cli/src/memory/memory-schema.ts:15`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/memory/memory-schema.ts#L15)): Schema version `3.0.0` managing **9 tables** (`memory_entries`, `patterns`, `pattern_history`, `trajectories`, `trajectory_steps`, `migration_state`, `sessions`, `vector_indexes`, `metadata`).

## Hybrid Search: ONNX ModernBERT 768d + BM25 RRF

Retrieval uses a dual-arm hybrid search architecture combined with Reciprocal Rank Fusion (RRF):

1. **Dense Vector Search**:
   - Model: `Alibaba-NLP/gte-modernbert-base` (768 dimensions).
   - Embedding Pipeline: `@xenova/transformers` ONNX feature extraction.
   - Acceleration: Standalone pure-JS `HNSWIndex` (`dimensions=768`, `M=16`, `efConstruction=200`, `metric='cosine'`).
2. **Lexical Arm (In-Process Okapi BM25)**:
   - Parameters: $k_1 = 1.2$, $b = 0.75$.
   - Tokenizer: Exact parity with the evaluation harness (`text-tokens.ts`).
   - Live-Only Indexing: Built dynamically over live chunks with warning thresholds at 50,000 chunks (`LIVE_CHUNK_WARN_THRESHOLD`) and persistent review at 1,000,000 chunks (`SCALING_REVIEW_CHUNKS`).
3. **Reciprocal Rank Fusion (RRF)**:
   - Fuses ranked candidate lists using adaptive constant $k = \max(30, \min(60, 20 + 2 \times \text{top\_k}))$:
     $$\text{Score}(d) = \sum_{m} \frac{1}{\text{rrf\_k} + \text{rank}_m + 1} \times (0.75 + 0.5 \times \text{importance})$$

## Surface Query Router

The `QueryRouter` (`query-router.ts`) evaluates queries across 4 target surfaces: `chunks` (prior 0.5), `kg` (wt 2), `rules` (wt 2), and `memory` (wt 2):
- **Negation Gate**: Uses a 20-character pre-match window (`NEGATION_RE`) to bypass negated query phrases.
- **Confidence Gate**: Requires top surface score $\ge 2 \times$ runner-up score; low-confidence queries query all surfaces and fuse results.
- **Telemetry Persistence**: Cross-process misroutes are recorded to `.monomind/metrics/route-overrides.json`.

## Open Knowledge Format (OKF) Bundles

Supports document and memory export/import via Open Knowledge Format (OKF) Markdown files with YAML frontmatter headers:
- **Document OKF**: Exported via `exportToOKF()` with frontmatter (`type: Document`, `title`, `description`, `resource`, `tags`, `timestamp`, `contentHash`, `chunkCount`) and an `index.md` manifest.
- **Memory Transfer OKF**: CLI commands `monomind memory export` and `import` export/restore key-value memory entries across namespace directory trees.

## EWC Pattern Consolidation & SONA Router

- **EWC Consolidation** (`ewc-consolidation.ts`): Applies Elastic Weight Consolidation using an EMA-updated Fisher information matrix (`computeFisherMatrix`) persisted in `.swarm/ewc-fisher.json` to prevent catastrophic forgetting during pattern updates.
- **SONA Router** (`sona-optimizer.ts`): Extracts routing patterns from `hooksTrajectoryEnd` events into `.swarm/sona-patterns.json`.

## Exported Components

| Export | What it does |
|---|---|
| `UnifiedMemoryService` | High-level store/get/search facade backed by `SQLiteBackend` |
| `SQLiteBackend` / `SqlJsBackend` | Structured key-value storage in SQLite WAL mode |
| `HNSWIndex` | Standalone pure-JS approximate nearest-neighbor index (`768d`) |
| `EpisodicStore` | JSON-lines episodic memory store |
| `chunkDocument`, `KnowledgeStore`, `KnowledgeRetriever` | Document chunking + retrieval pipeline |
| `QueryBuilder` / `query()` | Fluent query construction |
| `CacheManager`, `TieredCacheManager` | LRU caching with size/TTL limits |
| `createDatabase`, `getPlatformInfo` | Platform-aware provider selection (`better-sqlite3` native → `sql.js` WASM) |
| `SwarmCheckpointer` | Persist/restore swarm agent state snapshots |
| `MemoryMigrator` | Import from SQLite, JSON, or Markdown sources |
| `PromptVersionStore`, `ControllerRegistry` | Prompt version history & controller registry |

## Cross-Platform Notes

`createDatabase()` picks the best available provider per platform:
`better-sqlite3` (native, fastest) → `sql.js` (WASM, zero compilation, works
everywhere including Windows without a toolchain) → JSON file fallback. See
`docs/CROSS_PLATFORM.md` and `docs/WINDOWS_SUPPORT.md`.

## Links

- [GitHub](https://github.com/monoes/monomind)
- [Documentation](https://monoes.github.io/monomind/)
- [Issues](https://github.com/monoes/monomind/issues)

## License

MIT

