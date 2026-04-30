# Monograph Core Engine — Design Spec

**Sub-project 1 of 4**
**Date:** 2026-04-30
**Status:** Approved for implementation planning

---

## Goal

Replace the Python `graphify` CLI dependency (`uv tool install graphifyy`) with a native TypeScript code intelligence engine called **Monograph**. Expose the same capabilities through a new `monograph_*` MCP tool surface. Rename all existing `graphify_*` references to `monograph_*` across the codebase.

## What ships in this sub-project

- `packages/@monomind/monograph/` — new standalone package
- 8-phase ingestion pipeline (tree-sitter AST → SQLite + graphology)
- Full `monograph_*` MCP tool surface (backward compat shims for `graphify_*`)
- Watch mode (incremental file-change rebuilds)
- Codebase-wide rename: graphify → monograph
- Languages: TypeScript/JavaScript (full), Python, Go, Rust, Java (Phase 1)

## What is explicitly out of scope

- Vector/semantic search (Sub-project 2)
- `context()` / `impact()` / `detect_changes()` tools (Sub-project 2)
- Route, ORM, process extraction (Sub-project 3)
- URL/doc ingestion (tweets, arxiv, PDFs) (Sub-project 3)
- Multi-repo groups and Contract Registry (Sub-project 4)

---

## Architecture

### Package layout

```
packages/@monomind/monograph/
├── src/
│   ├── index.ts                    # Public API
│   ├── pipeline/
│   │   ├── runner.ts               # Phase DAG executor
│   │   ├── phases/
│   │   │   ├── scan.ts
│   │   │   ├── structure.ts
│   │   │   ├── parse.ts
│   │   │   ├── cross-file.ts
│   │   │   ├── communities.ts
│   │   │   ├── god-nodes.ts
│   │   │   ├── surprises.ts
│   │   │   └── suggest.ts
│   │   └── types.ts
│   ├── parsers/
│   │   ├── loader.ts               # Tree-sitter lazy loader
│   │   ├── typescript.ts
│   │   ├── python.ts
│   │   ├── go.ts
│   │   ├── rust.ts
│   │   ├── java.ts
│   │   └── language-config.ts      # LanguageConfig interface
│   ├── storage/
│   │   ├── db.ts                   # better-sqlite3 connection + migrations
│   │   ├── schema.ts               # CREATE TABLE / FTS5 DDL
│   │   ├── node-store.ts           # read/write nodes
│   │   ├── edge-store.ts           # read/write edges
│   │   └── fts-store.ts            # FTS5 index queries (BM25)
│   ├── graph/
│   │   ├── loader.ts               # SQLite → graphology
│   │   ├── analyzer.ts             # god_nodes, shortest_path, surprises, suggest
│   │   └── diff.ts                 # graph_diff (old vs new)
│   ├── watch/
│   │   └── watcher.ts              # chokidar → incremental pipeline trigger
│   ├── mcp/
│   │   └── tools.ts                # monograph_* MCPTool definitions
│   └── cli/
│       └── build.ts                # monograph build <path> CLI entry
├── package.json
└── tsconfig.json
```

### Three-layer stack

```
┌──────────────────────────────────────────────────────────┐
│  MCP Tool Surface  (monograph_* tools, graphify_* shims) │
├──────────────────────────┬───────────────────────────────┤
│  Graph Engine            │  Search Engine                │
│  (graphology in-memory)  │  (SQLite FTS5, BM25)          │
├──────────────────────────┴───────────────────────────────┤
│  Ingestion Pipeline (8 phases, DAG runner)               │
├──────────────────────────────────────────────────────────┤
│  Language Parsers (tree-sitter Node.js bindings)         │
├──────────────────────────────────────────────────────────┤
│  Persistence (.monomind/monograph.db — SQLite)           │
└──────────────────────────────────────────────────────────┘
```

---

## Ingestion Pipeline

### Phase DAG

```
scan → structure → parse → cross-file → communities → god-nodes → surprises → suggest
```

All phases implement `PipelinePhase<Output>` with explicit `name`, `deps`, and `execute(ctx, deps)`. The runner does topological sort and Kahn's validation (cycle detection). Each phase receives only its declared deps — no hidden coupling.

### Phase contracts

| Phase | Inputs | Outputs | Derived from |
|---|---|---|---|
| `scan` | `repoPath`, ignore patterns | `{ filePaths: string[], totalBytes: number }` | GitNexus scan + graphify detect |
| `structure` | scan output | `{ fileNodes: Node[], folderNodes: Node[], containsEdges: Edge[] }` | GitNexus structure |
| `parse` | structure output, file paths | `{ symbolNodes: Node[], edges: Edge[], parseErrors: string[] }` | graphify extract + GitNexus parse |
| `cross-file` | parse output | `{ resolvedEdges: Edge[] }` — import targets resolved to concrete symbols | GitNexus crossFile |
| `communities` | cross-file output | `{ memberships: Map<nodeId, communityId>, communityLabels: Map<communityId, string> }` | graphify cluster + GitNexus communities |
| `god-nodes` | cross-file output | `{ godNodes: GodNode[] }` — top-N by degree, synthetic nodes filtered | graphify analyze.god_nodes |
| `surprises` | cross-file + communities output | `{ surprises: SurprisingConnection[] }` — cross-community unexpected edges | graphify analyze.surprising_connections |
| `suggest` | all above | `{ questions: SuggestedQuestion[] }` — graph-derived questions agents can ask | graphify analyze.suggest_questions |

### Context object (shared mutable)

```typescript
interface PipelineContext {
  repoPath: string;
  graph: MonographGraph;          // graphology MultiDiGraph
  db: MonographDb;                // better-sqlite3 Database
  onProgress: (p: PipelineProgress) => void;
  options: PipelineOptions;
}
```

---

## Language Parsers

### LanguageConfig interface (from graphify's extract.py)

```typescript
interface LanguageConfig {
  treeSitterModule: string;          // npm package name e.g. 'tree-sitter-typescript'
  language: () => Language;          // tree-sitter Language object
  classNodeTypes: Set<string>;       // AST node types that represent classes
  functionNodeTypes: Set<string>;    // AST node types that represent functions
  importNodeTypes: Set<string>;      // AST node types that represent imports
  callNodeTypes: Set<string>;        // AST node types that represent call expressions
  nameField: string;                 // field name for extracting symbol names ('name' | 'identifier')
  importExtractor?: ImportExtractor; // optional per-language import resolution
}
```

This interface makes adding a new language ~50 lines. All 5 Phase 1 languages implement it.

### Phase 1 languages

| Language | tree-sitter package | Key extractions |
|---|---|---|
| TypeScript/TSX | `tree-sitter-typescript` | Classes, interfaces, functions, arrow fns, imports, calls, extends/implements, tsconfig alias resolution |
| JavaScript/JSX | `tree-sitter-javascript` | Same minus type annotations |
| Python | `tree-sitter-python` | Classes, functions, imports, calls, decorators |
| Go | `tree-sitter-go` | Structs, functions, imports, calls, interfaces |
| Rust | `tree-sitter-rust` | Structs, enums, impl blocks, functions, use declarations, trait impls |
| Java | `tree-sitter-java` | Classes, interfaces, methods, imports, calls, extends/implements |

### Edge confidence levels (from graphify)

```typescript
type EdgeConfidence = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';
```

- `EXTRACTED` — direct AST evidence (explicit import, direct call)
- `INFERRED` — resolved through type inference or alias
- `AMBIGUOUS` — dynamic dispatch, could be multiple targets

---

## Storage Schema (SQLite)

### Tables

```sql
-- Nodes (all symbol types)
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,              -- 'File' | 'Folder' | 'Function' | 'Class' | 'Method' | 'Interface' | 'Variable'
  name TEXT NOT NULL,
  file_path TEXT,
  start_line INTEGER,
  end_line INTEGER,
  community_id INTEGER,
  is_exported INTEGER DEFAULT 0,
  properties TEXT                   -- JSON blob for extra fields
);

-- Edges (all relationship types)
CREATE TABLE edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation TEXT NOT NULL,           -- 'IMPORTS' | 'CALLS' | 'EXTENDS' | 'IMPLEMENTS' | 'CONTAINS' | 'DEFINES' | 'HAS_METHOD'
  confidence TEXT DEFAULT 'EXTRACTED',
  confidence_score REAL DEFAULT 1.0,
  FOREIGN KEY (source_id) REFERENCES nodes(id),
  FOREIGN KEY (target_id) REFERENCES nodes(id)
);

-- Communities
CREATE TABLE communities (
  id INTEGER PRIMARY KEY,
  label TEXT,
  size INTEGER,
  cohesion_score REAL
);

-- Index metadata (incremental rebuild support)
CREATE TABLE index_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- FTS5 index for BM25 search
CREATE VIRTUAL TABLE nodes_fts USING fts5(
  id UNINDEXED,
  name,
  file_path,
  label UNINDEXED,
  content='nodes',
  content_rowid='rowid'
);
```

### Key indexes

```sql
CREATE INDEX idx_nodes_file ON nodes(file_path);
CREATE INDEX idx_nodes_label ON nodes(label);
CREATE INDEX idx_edges_source ON edges(source_id);
CREATE INDEX idx_edges_target ON edges(target_id);
CREATE INDEX idx_edges_relation ON edges(relation);
```

---

## Watch Mode

Uses `chokidar` (already common in Node.js ecosystem). On file change:

1. Detect changed files (by path + mtime)
2. Re-run `parse` phase for changed files only
3. Diff old vs new edges for those files
4. Update SQLite incrementally (delete stale, insert new)
5. Reload graphology graph from SQLite
6. Re-run `communities`, `god-nodes`, `surprises`, `suggest` phases on full graph
7. Emit `monograph:updated` event

Incremental rebuild is code-only (no LLM) — same approach as graphify's `watch.py`.

---

## MCP Tool Surface

### New tools (monograph_*)

| Tool | Description | Backed by |
|---|---|---|
| `monograph_build` | Build (or rebuild) knowledge graph for a path | Full pipeline run |
| `monograph_query` | Keyword search: BM25 via SQLite FTS5 | FTS5 index |
| `monograph_suggest` | Get suggested questions from graph topology | suggest phase output |
| `monograph_god_nodes` | Top-N most-connected real entities | god-nodes phase output |
| `monograph_get_node` | Get a specific node by ID or name | SQLite nodes table |
| `monograph_shortest_path` | BFS shortest path between two nodes | graphology traversal |
| `monograph_community` | Get nodes in a community | communities table |
| `monograph_stats` | Node/edge/community counts, index freshness | SQLite counts |
| `monograph_surprises` | Cross-community unexpected edges | surprises phase output |
| `monograph_visualize` | Render graph as HTML (D3 force-directed) | graphology → JSON → HTML |
| `monograph_watch` | Start incremental file watcher | chokidar watcher |
| `monograph_watch_stop` | Stop the watcher | watcher teardown |
| `monograph_report` | Generate GRAPH_REPORT.md | all phase outputs |
| `monograph_health` | Check index staleness (git lastCommit vs HEAD) | git + index_meta |
| `monograph_diff` | Compare current graph against a previous snapshot | graph diff |

### Backward compat shims (graphify_* → monograph_*)

All existing `graphify_*` tool names are kept but emit a deprecation notice and proxy to `monograph_*`:

```typescript
// In graphify-tools.ts — shim wrapping the new tools
export const graphifyQueryTool: MCPTool = {
  name: 'graphify_query',
  description: '[DEPRECATED: use monograph_query] ' + monographQueryTool.description,
  handler: async (params) => {
    console.warn('[monograph] graphify_query is deprecated, use monograph_query');
    return monographQueryTool.handler(params);
  }
};
```

One release cycle, then `graphify_*` tools are removed entirely.

---

## Codebase Rename: graphify → monograph

All files and references to be updated as part of this sub-project:

| File | Change |
|---|---|
| `packages/@monomind/cli/src/mcp-tools/graphify-tools.ts` | Rename to `monograph-tools.ts`, replace tool implementations with new engine, keep shims |
| `.claude/commands/monomind-createtask.md` | `graphify_suggest` → `monograph_suggest`, `graphify_query` → `monograph_query` |
| `.claude/commands/monomind-idea.md` | Same |
| `.claude/commands/monomind-improve.md` | Same |
| `.claude/commands/monomind-do.md` | Same |
| `CLAUDE.md` | Update graphify section to monograph, update tool table |
| All `graphify_*` references in `.claude/skills/` | Rename to `monograph_*` |
| `packages/@monomind/cli/src/init/executor.ts` | `graphify update` subprocess call → `monograph build` via new package API |
| `.monomind/graph/graph.json` path handling | Update to `.monomind/monograph.db` |

---

## Error Handling

- If a file parse fails (tree-sitter syntax error): log warning, skip file, continue pipeline. Never throw.
- If SQLite open fails: throw `MonographError` with path + OS error.
- If no tree-sitter grammar installed for a language: log once, skip all files of that type, include count in stats.
- Watch mode errors: emit `monograph:error` event, keep watching (don't crash).

---

## Testing Strategy

- Unit tests per language parser: fixture file → expected nodes/edges JSON (same pattern as graphify tests)
- Pipeline phase tests: mock PipelineContext, verify phase output shape
- Integration test: run full pipeline on `packages/@monomind/monograph/` itself, verify stats
- MCP tool tests: verify tool handler returns correct shape, no Python subprocess called
- Watch mode test: write temp file, assert `monograph:updated` fires within 2s

---

## Dependencies Added

| Package | Version | Purpose |
|---|---|---|
| `better-sqlite3` | `^12.x` | SQLite persistence + FTS5 BM25 |
| `@types/better-sqlite3` | `^7.x` | TypeScript types |
| `tree-sitter` | `^0.22.x` | Tree-sitter core |
| `tree-sitter-typescript` | `^0.23.x` | TS/JS grammar |
| `tree-sitter-python` | `^0.23.x` | Python grammar |
| `tree-sitter-go` | `^0.23.x` | Go grammar |
| `tree-sitter-rust` | `^0.23.x` | Rust grammar |
| `tree-sitter-java` | `^0.23.x` | Java grammar |
| `chokidar` | `^3.x` | File watching |

**Already in deps (no change):**
- `graphology` — in-memory graph operations
- `graphology-communities-louvain` — community detection
- `graphology-shortest-path` — path finding
- `graphology-metrics` — degree/centrality calculations

**Removed dependency:**
- Python `graphifyy` (via `uv tool install`) — eliminated entirely

---

## Sub-project Sequence

| Sub-project | Scope | Unblocks |
|---|---|---|
| **1 (this)** | Core engine, AST pipeline, SQLite, all `monograph_*` tools | Everything |
| 2 | Vector search (monomind HNSW), `context()`, `impact()`, `detect_changes()` | Sub-project 1 |
| 3 | Execution processes, route/ORM extraction, URL/doc ingestion, wiki | Sub-project 1 |
| 4 | Multi-repo groups, Contract Registry, deep swarm hooks, web UI | Sub-projects 2+3 |

---

## Open Questions (resolved)

| Question | Decision |
|---|---|
| Graph DB: Kuzu vs SQLite? | **SQLite** — Kuzu is 500 MB installed, unacceptable for a CLI tool |
| MCP surface: rename or add new? | **Rename to monograph_*, keep graphify_* as deprecated shims** for one release |
| Language scope for Phase 1? | **TS/JS, Python, Go, Rust, Java** — others added incrementally via LanguageConfig |
| Persistence format? | **SQLite (.monomind/monograph.db)** replaces graph.json |
| Backward compat for graph.json readers? | **Migrate on first build** — detect legacy graph.json, offer migration path |
