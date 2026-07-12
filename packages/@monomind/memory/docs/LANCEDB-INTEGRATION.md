# LanceDB Integration Guide

## Overview

`@monoes/memory` ships an optional vector backend, `LanceDBBackend`, built on
[`@lancedb/lancedb`](https://www.npmjs.com/package/@lancedb/lancedb). It is
loaded dynamically: the package works without it, and the backend throws a
clear install hint if the dependency is missing.

```bash
npm install @lancedb/lancedb apache-arrow
```

## LanceDBBackend

```typescript
import { LanceDBBackend } from '@monoes/memory';

const backend = new LanceDBBackend({
  dbPath: './data/lancedb',        // default: ~/.monomind/lancedb
  namespace: 'default',            // also used as the table name
  vectorDimension: 1536,           // must match your embedding generator
  embeddingGenerator: async (text) => embeddings.embed(text),
});

await backend.initialize();

await backend.store({
  id: 'entry-1',
  key: 'auth-patterns',
  content: 'OAuth 2.0 implementation patterns for secure authentication',
  type: 'semantic',
  namespace: 'default',
});

// Vector search with a pre-computed embedding
const results = await backend.search(queryEmbedding, { k: 10, threshold: 0.7 });
```

For text-in / results-out semantic search, use `UnifiedMemoryService.semanticSearch(text, k)`
(it embeds the query via your `embeddingGenerator` first).

### Configuration (`LanceDBBackendConfig`)

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
   * Enables text search after the first write.
   */
  enableFts?: boolean;

  /**
   * IVF-PQ search probes (default: 20). Higher = better recall, slower.
   * Ignored until the IVF-PQ index is built (auto-triggered at 50k rows).
   */
  nProbes?: number;
}
```

### Behavior notes

- **Namespaces map to tables.** Table names are sanitized (`[^A-Za-z0-9_.-]`
  → `_`) because invalid names crash the native binding.
- **ANN indexing is automatic.** Small tables use brute-force scan; an IVF-PQ
  index is built automatically once a table reaches 50k rows.
- **Full-text search** (`enableFts`) requires at least one record in the
  table before the index can be created (LanceDB limitation).

## UnifiedMemoryService

The high-level facade wraps `LanceDBBackend` with lifecycle events and
auto-embedding:

```typescript
import { UnifiedMemoryService } from '@monoes/memory';

const memory = new UnifiedMemoryService({
  persistencePath: './data/lancedb',
  dimensions: 1536,
  embeddingGenerator: embedFn,
});
await memory.initialize();
```

## When not to use it

For structured key-value memory without vector search, use `SQLiteBackend`
(native) or `SqlJsBackend` (WASM, zero compilation) — see
`CROSS_PLATFORM.md`. The pure-JS `HNSWIndex` export is also available if you
want ANN search without any native dependency.
