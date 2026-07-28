<p align="center">
  <img src="https://raw.githubusercontent.com/monoes/monomind/main/assets/packages/monograph.png" alt="@monoes/monograph" width="600" />
</p>

# @monoes/monograph

[![npm version](https://img.shields.io/npm/v/@monoes/monograph?style=flat-square)](https://www.npmjs.com/package/@monoes/monograph)
[![license](https://img.shields.io/npm/l/@monoes/monograph?style=flat-square)](https://github.com/monoes/monomind/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)

**Code intelligence as a graph** — tree-sitter parses your codebase into a SQLite-backed knowledge graph of files, functions, classes, imports, and call relationships. Query blast radius, find callers, and navigate architecture without grep.

> Part of the [Monomind](https://github.com/monoes/monomind) ecosystem.

## Install

```bash
npm install @monoes/monograph
```

## What it does

Monograph walks your source tree with [tree-sitter](https://tree-sitter.github.io/tree-sitter/), extracts symbols and their relationships, and stores them in a SQLite database. The result is a queryable graph where:

- **Nodes** are files, functions, classes, methods, and exports
- **Edges** are imports, calls, extends, and contains relationships

## CLI usage

```bash
# Build the graph for the current project
monograph build

# Query symbols
monograph query "UserService"

# Find blast radius of a change
monograph impact src/auth.ts

# Check index freshness
monograph health

# Find high-centrality files
monograph god-nodes
```

## Programmatic usage

```typescript
import { MonographEngine } from '@monoes/monograph';

const engine = new MonographEngine({ projectRoot: process.cwd() });
await engine.build();

const results = engine.query('authenticate');
const impact = engine.impact('src/auth/login.ts');
const godNodes = engine.godNodes({ limit: 10 });
```

## MCP tools

When used via Monomind's MCP server, monograph exposes 19 tools by default (+27 advanced via `MONOGRAPH_MCP_ADVANCED=1`):

| Tool | Purpose |
|---|---|
| `monograph_suggest` | Start every task — ranked relevant files |
| `monograph_query` | BM25 keyword search with PPR graph reranking |
| `monograph_impact` | Blast radius analysis (upstream + downstream) |
| `monograph_god_nodes` | High-centrality internal files |
| `monograph_context` | 360° view of a file |
| `monograph_augment` | Graph-RAG context retrieval |
| `monograph_dead_code` | Dead exports, orphan files, stale dist |
| `monograph_detect_changes` | Map git diff to affected graph nodes |
| `monograph_route_map` | List HTTP routes with handlers |

## Supported languages

Tree-sitter parsers for TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, Ruby, and more — language support depends on installed tree-sitter grammars.

## Links

- [GitHub](https://github.com/monoes/monomind)
- [Documentation](https://monoes.github.io/monomind/)
- [Issues](https://github.com/monoes/monomind/issues)

## License

MIT
