# @monoes/memory

[![license](https://img.shields.io/npm/l/@monoes/memory.svg?style=flat-square)](https://github.com/monoes/monomind/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-blue?style=flat-square)](https://nodejs.org)

**Persistent memory backends for Monomind agents** — SQLite (native or WASM) key-value storage, an optional LanceDB vector backend, a pure-JS HNSW index, JSONL episodic memory, and a chunked knowledge store.

> Part of the [Monomind](https://github.com/monoes/monomind) ecosystem. The only hard dependency is `sql.js` (WASM); `better-sqlite3` and `@lancedb/lancedb` are optional and loaded dynamically when installed.

## Install

```bash
npm install @monoes/memory

# optional: native SQLite and vector search
npm install better-sqlite3 @lancedb/lancedb apache-arrow
```

## What's in the box

| Export | What it does |
|---|---|
| `UnifiedMemoryService` | High-level store/get/search facade backed by `LanceDBBackend` |
| `SQLiteBackend` / `SqlJsBackend` | Structured key-value memory (native SQLite or zero-compile WASM) |
| `LanceDBBackend` | Vector memory via `@lancedb/lancedb` (optional dependency, loaded lazily) |
| `HNSWIndex` | Pure-JS approximate nearest-neighbor index with quantization support |
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

## Vector search (optional)

```typescript
import { UnifiedMemoryService } from '@monoes/memory';

// Requires @lancedb/lancedb + apache-arrow installed
const memory = new UnifiedMemoryService({
  persistencePath: './data/lancedb',
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
