# Monograph Subsystem Concept & Architecture (`@monoes/monograph`)

> Public reference for Monograph, Monomind's codebase knowledge graph subsystem.
> Architectural guide and technical reference for `@monoes/monograph` `v1.5.5` (CLI integration `@monoes/monomindcli` `v2.8.3`).

---

## Executive Overview

Monomind Monograph (`@monoes/monograph` `v1.5.5`) is an in-process, SQLite-backed codebase knowledge graph subsystem. It parses source files into ASTs using Tree-sitter, extracts code symbols and structural relationships into SQLite database tables, performs graph analysis (blast radius calculation, HippoRAG-style PPR reranking, central god nodes detection, graph surprisingness, and community clustering), tracks graph freshness via Git commits and file content hashing, and exposes native MCP tools for agentic code intelligence.

Defined in `packages/@monomind/monograph/` ([package.json:3](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/monograph/package.json#L3)) and integrated into CLI MCP tools at `packages/@monomind/cli/src/mcp-tools/monograph-tools.ts`.

---

## 1. Tree-sitter AST Parsers & Extractor Infrastructure

Monograph uses Tree-sitter for deterministic, full-fidelity AST symbol extraction across 25 file extensions, with a regex-based parser fallback for 5 additional languages.

### Supported Language Extensions (30 total)

- **Tree-sitter AST Engine (25 extensions)**: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.go`, `.rs`, `.java`, `.c`, `.h`, `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hxx`, `.cs`, `.rb`, `.swift`, `.php`, `.vue` (isolated `<script>` blocks), `.kt`, `.kts`, `.dart` ([`loader.ts:85-106`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/monograph/src/parsers/loader.ts#L85-L106)).
- **Regex Fallback Extractor (5 languages)**: Scala (`.scala`, `.sc`), Lua (`.lua`), Zig (`.zig`), PowerShell (`.ps1`, `.psm1`), Elixir (`.ex`, `.exs`) ([`language-parsers.ts:1-121`](file:///Users/monomind/packages/@monomind/monograph/src/parsers/language-parsers.ts#L1-L121)).

### Parser & Extraction Workflow
1. **`getParser(ext)`** ([`loader.ts:64-83`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/monograph/src/parsers/loader.ts#L64-L83)): Dynamically loads and caches Tree-sitter parsers per file extension.
2. **`parseFile(...)`** ([`loader.ts:115-149`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/monograph/src/parsers/loader.ts#L115-L149)): Isolates script content in single-file components (`.vue`) before passing to Tree-sitter.
3. **`extractSymbols()`** ([`extractor.ts:7-98`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/monograph/src/parsers/extractor.ts#L7-L98)): Traverses the Tree-sitter syntax tree, creates root `File` nodes, matches node types against language config rules (`classNodeTypes`, `functionNodeTypes`, `methodNodeTypes`, `structNodeTypes`), and generates symbol nodes and `CONTAINS` edges.

---

## 2. Graph Database & SQLite Schema

Monograph persists the codebase graph in an embedded SQLite database (`.monomind/monograph/graph.db`) with FTS5 trigram search and automated triggers.

Defined in `packages/@monomind/monograph/src/storage/schema.ts`:

| Table | Primary Columns & Types | Purpose |
|---|---|---|
| `nodes` | `id (PK)`, `label`, `name`, `norm_label`, `file_path`, `start_line`, `end_line`, `community_id`, `is_exported`, `language`, `properties`, `embedding` | Code symbols, files, folders, and conceptual nodes. |
| `edges` | `id (PK)`, `source_id (FK)`, `target_id (FK)`, `relation`, `confidence`, `confidence_score`, `weight`, `reason`, `evidence` | Directed relationships between nodes. |
| `communities` | `id (PK)`, `label`, `size`, `cohesion_score` | Louvain community clusters. |
| `index_meta` | `key (PK)`, `value` | Commit metadata (e.g. `last_commit_hash`). |
| `file_cache` | `file_path (PK)`, `content_hash` (SHA-256), `last_parsed`, `node_count`, `edge_count` | Incremental parse cache tracking. |
| `nodes_fts` | FTS5 Virtual Table (`name`, `norm_label`, `file_path`) | Trigram-tokenized full-text search with SQLite auto-sync triggers (`FTS_SYNC_TRIGGERS`). |

---

## 3. Node Labels & Relationship Types

### Code & Graph Node Labels
- **AST / Code**: `File`, `Folder`, `Function`, `Class`, `Method`, `Interface`, `Variable`, `Struct`, `Enum`, `Macro`, `Typedef`, `Union`, `Namespace`, `Trait`, `Impl`, `TypeAlias`, `Const`, `Static`, `Property`, `Record`, `Delegate`, `Annotation`, `Constructor`, `Template`, `Module`, `Process`, `Route`, `Community`.
- **Knowledge & Concept**: `Concept`, `Section`, `Document`, `Tool`, `Entity`, `Field`.

### Edge Relationship Kinds (`EdgeRelation`)
- **Code & Structural**: `CONTAINS`, `DEFINES`, `CALLS`, `IMPORTS`, `RE_EXPORTS`, `EXTENDS`, `IMPLEMENTS`, `HAS_METHOD`, `HAS_PROPERTY`, `ACCESSES`, `METHOD_OVERRIDES`, `METHOD_IMPLEMENTS`, `MEMBER_OF`, `STEP_IN_PROCESS`, `HANDLES_ROUTE`, `FETCHES`, `HANDLES_TOOL`, `ENTRY_POINT_OF`, `WRAPS`, `QUERIES`, `REFERENCES`, `PARENT_SECTION`, `TAGGED_AS`, `HAS_FIELD`.
- **Semantic & Document**: `CO_OCCURS`, `DESCRIBES`, `CAUSES`, `CONTRASTS_WITH`, `PART_OF`, `RELATED_TO`, `USES`, `STRUCTURALLY_SIMILAR`.

### Confidence Levels
- `EXTRACTED` (`1.0`): Exact Tree-sitter AST parse.
- `INFERRED` (`0.5`): Heuristic symbol or import resolution.
- `AMBIGUOUS` (`0.2`): Multiple potential symbol candidates.

---

## 4. Blast Radius Calculation & Ripple Impact

Monograph computes change blast radius using a multi-hop Breadth-First Search (BFS) graph traversal engine.

### BFS Ripple Impact Algorithm
Located at `packages/@monomind/monograph/src/graph/ripple-impact.ts` ([`rippleImpactFromMap`, L51-84](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/monograph/src/graph/ripple-impact.ts#L51-L84)):

- **Traversal**: BFS traversal outward along directed outgoing edges up to a max depth (default `depth = 3`).
- **Decay Formula**: Calculates impact score using exponential depth decay:
  $$\text{ImpactScore} = \sum_{d=1}^{\text{maxDepth}} N_d \times (\text{decayFactor})^d$$
  *(where $N_d$ is the number of affected nodes at depth $d$, and $\text{decayFactor} = 0.5$)*.
- **LLM Context Formatting**: `formatRippleImpact()` ([`L108-131`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/monograph/src/graph/ripple-impact.ts#L108-L131)) transforms the graph traversal tree into a structured markdown report for AI model consumption.

---

## 5. Graph Freshness & Staleness Detection

Monograph guarantees index accuracy through a three-layer freshness system:

1. **Git Commit Hash Verification** ([`git-staleness.ts:13-66`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/monograph/src/staleness/git-staleness.ts#L13-L66)):
   Compares `last_commit_hash` in `index_meta` against `git rev-parse HEAD`. If different, runs `git diff --name-only <indexed>..HEAD` to detect changed files and mark graph nodes as stale.
2. **SHA-256 File Content Hashing** ([`file-cache.ts:12-21`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/monograph/src/storage/file-cache.ts#L12-L21)):
   Computes file content hashes and compares against the `file_cache` table to skip unchanged files during incremental graph builds.
3. **Live File System Watcher** ([`monograph-tools.ts:660-688`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/mcp-tools/monograph-tools.ts#L660-L688)):
   Listens for file system change events in `monograph_watch` to update SQLite nodes and edges incrementally during active editing sessions.

---

## 6. MCP Tools Suite (14 `monograph_*` Tools)

The CLI exposes 14 native `monograph_*` tools via `packages/@monomind/cli/src/mcp-tools/monograph-tools.ts`:

1. `monograph_build` ([L111](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/mcp-tools/monograph-tools.ts#L111)): Rebuilds or incrementally updates knowledge graph.
2. `monograph_query` ([L141](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/mcp-tools/monograph-tools.ts#L141)): BM25/FTS search with HippoRAG Personalized PageRank (PPR) reranking.
3. `monograph_stats` ([L249](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/mcp-tools/monograph-tools.ts#L249)): Reports node/edge totals and graph density metrics.
4. `monograph_health` ([L270](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/mcp-tools/monograph-tools.ts#L270)): Computes graph connectivity and complexity health scores.
5. `monograph_god_nodes` ([L321](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/mcp-tools/monograph-tools.ts#L321)): Identifies central high-degree nodes (architectural hubs).
6. `monograph_get_node` ([L366](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/mcp-tools/monograph-tools.ts#L366)): Retrieves attributes and edge connections for a specific node.
7. `monograph_shortest_path` ([L393](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/mcp-tools/monograph-tools.ts#L393)): Executes BFS pathfinding between two code nodes.
8. `monograph_community` ([L425](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/mcp-tools/monograph-tools.ts#L425)): Inspects Louvain community clusters.
9. `monograph_surprises` ([L459](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/mcp-tools/monograph-tools.ts#L459)): Detects unusual cross-boundary coupling and non-obvious dependencies.
10. `monograph_suggest` ([L513](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/mcp-tools/monograph-tools.ts#L513)): Recommends relevant code files for task prompts.
11. `monograph_staleness` ([L828](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/mcp-tools/monograph-tools.ts#L828)): Checks graph freshness against Git HEAD commit.
12. `monograph_context` ([L1036](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/mcp-tools/monograph-tools.ts#L1036)): Assembles deep multi-hop graph context for LLM prompts.
13. `monograph_impact` ([L1104](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/mcp-tools/monograph-tools.ts#L1104)): Computes change blast radius and affected downstream files.
14. `monograph_cypher` ([L1368](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/mcp-tools/monograph-tools.ts#L1368)): Executes custom subset Cypher pattern queries against the SQLite graph.
