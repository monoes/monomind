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
monomind monograph build

# Search the knowledge graph (BM25, semantic, or hybrid)
monomind monograph search -q "authentication flow"

# Show graph statistics
monomind monograph stats

# Watch for changes and rebuild incrementally
monomind monograph watch

# Start the LSP server for editor integration
monomind monograph lsp

# Build a document knowledge graph from docs & PDFs (separate from the code graph above)
monomind monograph wiki
```

> `impact` (blast radius), `god-nodes` (high-centrality files), and freshness/staleness checks have no CLI subcommand — they're MCP-tool-only (`monograph_impact`, `monograph_god_nodes`, `monograph_health`, `monograph_staleness`), see [MCP tools](#mcp-tools) below. `stats` above reports graph size, not freshness — don't confuse the two.

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
| `monograph_watch` | Start incremental file watcher — rebuilds on file changes |
| `monograph_watch_stop` | Stop the incremental file watcher |
| `monograph_health` | Manual, on-demand staleness check |
| `monograph_staleness` | Staleness check — auto-triggers a background rebuild if >3 commits behind HEAD |

## Supported languages & Parsers

Monograph utilizes a dual-tier parsing strategy for extracting code structure and symbols:

1. **Tree-sitter AST Parsers (25 supported extensions)**:
   - **Extensions**: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.go`, `.rs`, `.java`, `.c`, `.h`, `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hxx`, `.cs`, `.rb`, `.swift`, `.php`, `.vue`, `.kt`, `.kts`, `.dart`.
   - **Grammar Loader**: Dynamically loads and caches Tree-sitter grammars per extension via `getParser(ext)` ([`loader.ts:64-83`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/monograph/src/parsers/loader.ts#L64-L83)). Supports `<script>` block isolation for `.vue` files ([`loader.ts:128-142`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/monograph/src/parsers/loader.ts#L128-L142)).
2. **Regex Fallback Parsers (5 languages)**:
   - Lightweight regex-based symbol extractors for languages when Tree-sitter grammars are uninstalled or unsupported: **Scala**, **Lua**, **Zig**, **PowerShell**, and **Elixir** ([`language-parsers.ts:1-100`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/monograph/src/parsers/language-parsers.ts#L1-L100)).

## SQLite Database Schema

The graph is stored in a WAL-mode SQLite database (`PRAGMA journal_mode = WAL`) managed in [`schema.ts`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/monograph/src/storage/schema.ts) and [`db.ts`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/monograph/src/storage/db.ts):

- **`nodes`**: Code symbols and files (`id`, `label`, `name`, `norm_label`, `file_path`, `start_line`, `end_line`, `community_id`, `is_exported`, `language`, `properties`, `embedding`).
- **`edges`**: Directed relationships between nodes (`id`, `source_id`, `target_id`, `relation`, `confidence`, `confidence_score`, `weight`, `reason`, `evidence`).
- **`communities`**: Hierarchical community clusters (`id`, `label`, `size`, `cohesion_score`).
- **`file_cache`**: SHA-256 incremental parse cache (`file_path`, `content_hash`, `last_parsed`, `node_count`, `edge_count`).
- **`nodes_fts`**: Trigram-tokenized FTS5 virtual table (`tokenize='trigram'`) indexing `name`, `norm_label`, and `file_path` with sync triggers for rapid symbol and fuzzy text queries.
- **`index_meta`**: Key-value system index metadata (including `last_commit_hash`).

## Relationship Types

Monograph defines typed edges ([`types.ts:20-29`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/monograph/src/types.ts#L20-L29)) categorized into structural, static analysis, and semantic relationships:

- **`CONTAINS`**: Parent container to child element (e.g. File contains Class/Function, Class contains Method).
- **`IMPORTS`**: File/Module import dependency (`import { x } from './y'`).
- **`CALLS`**: Function/Method invocation between symbols.
- **`ENTRY_POINT_OF`**: Entry point symbol associated with an agent process or application workflow.
- Additional relations include `RE_EXPORTS`, `EXTENDS`, `IMPLEMENTS`, `HAS_METHOD`, `HAS_PROPERTY`, `ACCESSES`, `HANDLES_ROUTE`, `FETCHES`, `HANDLES_TOOL`, `WRAPS`, `QUERIES`, `REFERENCES`, `CO_OCCURS`, and LLM-inferred semantic relations (`DESCRIBES`, `CAUSES`, `CONTRASTS_WITH`, `PART_OF`, `RELATED_TO`, `USES`, `STRUCTURALLY_SIMILAR`).

## Blast Radius Calculation (`rippleImpact`)

Monograph calculates downstream cascade impact using the multi-hop `rippleImpact` BFS algorithm ([`ripple-impact.ts:51-84`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/monograph/src/graph/ripple-impact.ts#L51-L84)):

- **Algorithm**: Breadth-First Search propagating through outgoing directed edge adjacency maps.
- **Scoring Formula**:
  $$\text{TotalScore} = \sum_{\text{depth}=1}^{\text{maxDepth}} N_{\text{depth}} \times (\text{decayFactor})^{\text{depth}}$$
  *(Default `maxDepth = 3`, `decayFactor = 0.5`)*
- **Output**: Groups affected nodes by depth level (`byDepth: Record<number, string[]>`) and calculates a weighted decay impact score (`totalScore`). Exposes native blast radius insights via the `monograph_impact` MCP tool.

## Graph Freshness & Git Staleness Tracking

Monograph maintains graph synchronization with git repository state without full re-indexes ([`git-staleness.ts:13-66`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/monograph/src/staleness/git-staleness.ts#L13-L66)):

- **Commit Verification**: Compares stored `last_commit_hash` in `index_meta` against `git rev-parse HEAD`.
- **Change Diffing**: If hashes diverge, executes `git diff --name-only <indexedCommit>..HEAD` to populate `changedSince` files.
- **Divergence Timestamp**: Identifies `staleSince` ISO timestamp via `git log --format="%ai" <indexedCommit>..HEAD --reverse --max-count=1`.
- **File Content Caching**: Computes SHA-256 hashes (`file_cache` table) to skip parsing untouched files during incremental builds.

### Incremental Watch Mode

`monomind monograph watch` (and the `monograph_watch` MCP tool) debounces file changes by 3s ([`watcher.ts:108-110`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/monograph/src/watch/watcher.ts#L108-L110)), then updates the graph per changed file — delete existing nodes/edges for that file, re-parse, re-insert ([`orchestrator.ts:312-365`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/monograph/src/pipeline/orchestrator.ts#L312-L365)):

- **Incremental Threshold**: If a batch exceeds `INCREMENTAL_THRESHOLD` (20 changed files), it falls back to a full rebuild instead of per-file updates ([`orchestrator.ts:269-279`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/monograph/src/pipeline/orchestrator.ts#L269-L279)).
- **Deferred Full Rebuild**: After `FULL_REBUILD_IDLE_MS` (60s) with no further incremental activity, watch mode runs one full rebuild to refresh aggregate phases (communities, god-nodes, surprises, churn, report) that incremental updates don't recompute ([`watcher.ts:40-59`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/monograph/src/watch/watcher.ts#L40-L59)).

## Links

- [GitHub](https://github.com/monoes/monomind)
- [Documentation](https://monoes.github.io/monomind/)
- [Issues](https://github.com/monoes/monomind/issues)

## License

MIT

