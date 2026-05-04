---
name: monograph:monograph-search
description: Search the knowledge graph using BM25 keyword search, semantic (embedding) search, or hybrid RRF-merged results — filter by node type (Section, Function, Class, File, Concept)
---

# monograph search

Search the knowledge graph using BM25 keyword search, semantic (embedding) search, or hybrid RRF-merged results.

## Usage

```bash
npx monomind monograph search [options]
```

## Options

| Flag | Short | Type | Default | Required | Description |
|---|---|---|---|---|---|
| `--query` | `-q` | string | — | yes | Search query text |
| `--limit` | `-l` | number | `15` | no | Maximum results to return |
| `--label` | — | string | — | no | Filter by node type: `Section`, `Function`, `Concept`, `File`, `Class` |
| `--mode` | `-m` | string | `hybrid` | no | Search mode: `bm25`, `semantic`, `hybrid` |
| `--path` | `-p` | string | cwd | no | Root path (location of `.monomind/monograph.db`) |

## Examples

```bash
# Hybrid search (default) — best general-purpose
npx monomind monograph search -q "authentication flow"

# Keyword search — exact term matching
npx monomind monograph search -q "JWT" --mode bm25

# Semantic search — concept/meaning matching
npx monomind monograph search -q "pipeline architecture" --mode semantic

# Filter to doc sections only
npx monomind monograph search -q "API design" --label Section

# Find function definitions
npx monomind monograph search -q "parseToken" --label Function

# More results
npx monomind monograph search -q "error handling" -l 30
```

## Search Modes

| Mode | Algorithm | Best For |
|---|---|---|
| `hybrid` | RRF merge of BM25 + semantic | General purpose (recommended) |
| `bm25` | Full-text BM25 ranking | Exact term matching, known symbol names |
| `semantic` | Embedding cosine similarity | Conceptual queries, meaning-based lookup |

Hybrid mode runs both BM25 and semantic internally, then merges with Reciprocal Rank Fusion (RRF).

## Node Labels (--label filter)

| Label | Represents |
|---|---|
| `File` | Source or document files |
| `Section` | Markdown headings / doc sections |
| `Function` | Code functions and methods |
| `Class` | Code classes and interfaces |
| `Concept` | Extracted semantic concepts |

## Prerequisites

Run `monograph build` or `monograph wiki` first to create the index.

```bash
# If you see "No knowledge graph found":
npx monomind monograph build
```

## MCP Tool

The MCP equivalent for Claude Code integration:

```javascript
mcp__monomind__monograph_query({
  query: "authentication flow",
  limit: 15,
  label: "Section",
  mode: "hybrid"
})
```

Use `mcp__monomind__monograph_suggest` for task-oriented lookup that returns files ranked by relevance to your current work.

## See Also

- `monograph build` — build the graph index
- `monograph stats` — see what's indexed
- `monograph wiki` — doc-focused build
