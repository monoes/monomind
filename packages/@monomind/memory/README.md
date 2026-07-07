# @monomind/memory

[![npm version](https://img.shields.io/npm/v/@monomind/memory.svg?style=flat-square)](https://www.npmjs.com/package/@monomind/memory)
[![license](https://img.shields.io/npm/l/@monomind/memory.svg?style=flat-square)](https://github.com/monoes/monomind/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-blue?style=flat-square)](https://nodejs.org)

**Persistent vector memory for AI agents** — LanceDB + SQLite hybrid backend with HNSW indexing, semantic search, knowledge graph, and auto memory bridge for Claude Code.

> Part of the [Monomind](https://github.com/monoes/monomind) ecosystem.

## Install

```bash
npm install @monomind/memory
```

## Quick start

```typescript
import { HNSWIndex } from '@monomind/memory';

const index = new HNSWIndex({
  dimensions: 1536,
  M: 16,
  efConstruction: 200,
  metric: 'cosine',
});

await index.addPoint('mem-1', new Float32Array(embedding));
const results = await index.search(queryVector, 10);
// [{ id: 'mem-1', distance: 0.05 }, ...]
```

## LanceDB adapter

```typescript
import { LanceDBAdapter } from '@monomind/memory';

const adapter = new LanceDBAdapter({
  dimensions: 1536,
  cacheEnabled: true,
  embeddingGenerator: async (text) => myEmbedder.embed(text),
});

await adapter.initialize();

await adapter.store({
  id: 'mem-1',
  key: 'user-preference',
  content: 'User prefers dark mode',
  type: 'semantic',
  namespace: 'preferences',
  tags: ['ui'],
});

const results = await adapter.semanticSearch('dark mode', 10, 0.7);
```

## Query builder

```typescript
import { query } from '@monomind/memory';

const q = query()
  .semantic('authentication patterns')
  .inNamespace('security')
  .withTags(['auth'])
  .threshold(0.7)
  .limit(20)
  .sortByNewest()
  .build();
```

## Auto memory bridge

Bidirectional sync between Claude Code's auto memory files and LanceDB.

```typescript
import { AutoMemoryBridge } from '@monomind/memory';

const bridge = new AutoMemoryBridge(backend, {
  workingDir: '/workspaces/my-project',
  syncMode: 'on-session-end',
});

await bridge.recordInsight({
  category: 'debugging',
  summary: 'HNSW index requires init before search',
  confidence: 0.95,
});

await bridge.syncToAutoMemory();
```

## Features

- **HNSW vector index** — Pure-JS approximate nearest neighbor search
- **Hybrid backend** — SQLite for structured data + LanceDB for vectors
- **Quantization** — Binary (32x), scalar (4x), and product (8x) compression
- **Distance metrics** — Cosine, Euclidean, dot product, Manhattan
- **Knowledge graph** — PageRank + community detection + HippoRAG PPR re-ranking
- **Agent-scoped memory** — 3 scopes (project/local/user) with cross-agent transfer
- **Auto memory bridge** — Sync with Claude Code's `~/.claude/projects/*/memory/`
- **Cache manager** — LRU with configurable size and TTL
- **Migration tools** — Import from SQLite, JSON, or Markdown sources

## Links

- [GitHub](https://github.com/monoes/monomind)
- [Documentation](https://monoes.github.io/monomind/)
- [Issues](https://github.com/monoes/monomind/issues)

## License

MIT
