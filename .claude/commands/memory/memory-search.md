---
name: memory:memory-search
---

# memory search

Search stored memory using semantic, keyword, or hybrid search.

## Usage

```bash
npx monomind memory search [options]
```

## Options

| Flag | Short | Type | Default | Description |
|---|---|---|---|---|
| `--query` | `-q` | string | — | Search query text |
| `--namespace` | `-n` | string | `default` | Namespace to search |
| `--limit` | `-l` | number | `10` | Maximum results to return |
| `--threshold` | — | number | `0.7` | Minimum similarity threshold (0–1) |
| `--type` | `-t` | string | `hybrid` | Search type: `semantic`, `keyword`, `hybrid` |
| `--build-hnsw` | — | boolean | `false` | Build HNSW index before search (150x–12,500x speedup) |
| `--format` | — | string | — | Output format: `json` |

## Examples

```bash
# Semantic search
npx monomind memory search --query "authentication patterns"

# Keyword search
npx monomind memory search -q "JWT" --type keyword

# Hybrid search with namespace
npx monomind memory search -q "error handling" -n "project-x" --type hybrid

# Build HNSW index first for large datasets
npx monomind memory search -q "config" --build-hnsw --limit 20

# High-precision search with threshold
npx monomind memory search -q "OAuth flow" --threshold 0.9

# JSON output
npx monomind memory search -q "auth" --format json
```

## Search Types

| Type | Description | Best For |
|---|---|---|
| `semantic` | Vector similarity search | Concept/meaning matching |
| `keyword` | BM25 full-text search | Exact term matching |
| `hybrid` | Combined semantic + keyword | General purpose (recommended) |

## HNSW Index

Use `--build-hnsw` when searching large memory stores (1,000+ entries). The HNSW index provides 150x–12,500x search speedup after the one-time build cost.

## MCP Tool

```javascript
mcp__monomind__memory_search({
  query: "authentication patterns",
  namespace: "default",
  limit: 10,
  threshold: 0.7,
  type: "hybrid"
})
```

## See Also

- `memory store` — store new memories
- `memory list` — list all memories
- `memory retrieve` — retrieve by exact key
