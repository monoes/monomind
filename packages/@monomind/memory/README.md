<p align="center">
  <img src="https://raw.githubusercontent.com/monoes/monomind/main/assets/packages/memory.png" alt="@monoes/memory" width="600" />
</p>

# @monoes/memory

[![npm version](https://img.shields.io/npm/v/@monoes/memory?style=flat-square)](https://www.npmjs.com/package/@monoes/memory)
[![license](https://img.shields.io/npm/l/@monoes/memory.svg?style=flat-square)](https://github.com/monoes/monomind/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-blue?style=flat-square)](https://nodejs.org)

**Persistent memory backends for Monomind agents** — SQLite (native or WASM) key-value storage with brute-force cosine vector search, a standalone pure-JS HNSW index, JSONL episodic memory, and a chunked knowledge store.

> Part of the [Monomind](https://github.com/monoes/monomind) ecosystem. The only hard dependency is `sql.js` (WASM); `better-sqlite3` is optional and loaded dynamically when installed. LanceDB support was removed — SQLite is the only backend now.

## Install

```bash
npm install @monoes/memory

# optional: native SQLite (faster than the sql.js WASM fallback)
npm install better-sqlite3
```

## What's in the box

| Export | What it does |
|---|---|
| `UnifiedMemoryService` | High-level store/get/search facade backed by `SQLiteBackend` |
| `SQLiteBackend` / `SqlJsBackend` | Structured key-value memory with brute-force cosine vector search (native SQLite or zero-compile WASM) |
| `HNSWIndex` | Pure-JS approximate nearest-neighbor index with quantization support — standalone, not wired into `SQLiteBackend.search()` (see the honesty review's HNSW growth plan for why and when to change that) |
| `EpisodicStore` | JSON-lines episodic memory — accumulates agent runs into summarized episodes |
| `chunkDocument`, `KnowledgeStore`, `KnowledgeRetriever` | Document chunking + retrieval for knowledge bases |
| `QueryBuilder` / `query()` | Fluent query construction (namespace, tags, threshold, sort) |
| `CacheManager`, `TieredCacheManager` | LRU caching with size/TTL limits |
| `createDatabase`, `getPlatformInfo` | Platform-aware provider selection (better-sqlite3 → sql.js → JSON fallback) |
| `SwarmCheckpointer` | Persist/restore swarm agent state snapshots |
| `MemoryMigrator` | Import from SQLite, JSON, or Markdown sources |
| `PromptVersionStore`, `ControllerRegistry` | Prompt version history; init-level controller registry |

Note: Monomind's live hook/routing hot path uses plain JSON pattern files and
keyword-based episodic recall — the vector backends here are opt-in, used when
an embedding generator and the optional native dependencies are provided.

## Quick start — key-value memory

```typescript
import { SQLiteBackend } from '@monoes/memory';

const backend = new SQLiteBackend({ databasePath: './data/memory.db' });
await backend.initialize();

await backend.store({
  id: 'mem-1',
  key: 'user-preference',
  content: 'User prefers dark mode',
  type: 'semantic',
  namespace: 'preferences',
  tags: ['ui'],
});

const entry = await backend.getByKey('preferences', 'user-preference');
```

## Vector search

```typescript
import { UnifiedMemoryService } from '@monoes/memory';

// Backed by SQLiteBackend — brute-force cosine similarity, no extra install
const memory = new UnifiedMemoryService({
  persistencePath: './data/memory.db',
  dimensions: 1536,
  embeddingGenerator: async (text) => myEmbedder.embed(text),
});
await memory.initialize();
```

Or use the standalone pure-JS index directly:

```typescript
import { HNSWIndex } from '@monoes/memory';

const index = new HNSWIndex({ dimensions: 1536, M: 16, efConstruction: 200, metric: 'cosine' });
await index.addPoint('mem-1', new Float32Array(embedding));
const results = await index.search(queryVector, 10);
// [{ id: 'mem-1', distance: 0.05 }, ...]
```

## Episodic memory

```typescript
import { EpisodicStore } from '@monoes/memory';

const store = new EpisodicStore({ filePath: './data/episodes.jsonl', maxRunsPerEpisode: 20 });
// Accumulates agent runs into episodes, one JSON object per line
```

## Query builder

```typescript
import { query } from '@monoes/memory';

const q = query()
  .semantic('authentication patterns')
  .inNamespace('security')
  .withTags(['auth'])
  .threshold(0.7)
  .limit(20)
  .sortByNewest()
  .build();
```

## Cross-platform notes

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
