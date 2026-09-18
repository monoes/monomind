# Monograph Subsystem Concept & Architecture (`@monoes/monograph`)

> Public reference for Monograph, Monomind's codebase knowledge graph subsystem.
> Architectural guide and technical reference for `@monoes/monograph` `v1.5.6` (CLI integration `@monoes/monomindcli` `v2.9.0`).

---

## Executive Overview

Monomind Monograph (`@monoes/monograph` `v1.5.6`) is an in-process, SQLite-backed codebase knowledge graph subsystem. It parses source files into ASTs using Tree-sitter, extracts code symbols and structural relationships into SQLite database tables, performs graph analysis (blast radius calculation, one-hop neighbor-expansion reranking, central god nodes detection, graph surprisingness, and community clustering), tracks graph freshness via Git commits and file content hashing, and exposes native MCP tools for agentic code intelligence.

Defined in `packages/@monomind/monograph/` ([package.json](packages/@monomind/monograph/package.json)) and integrated into CLI MCP tools at `packages/@monomind/cli/src/mcp-tools/monograph-tools.ts`.

---

## 1. Tree-sitter AST Parsers & Extractor Infrastructure

Monograph uses Tree-sitter for deterministic, full-fidelity AST symbol extraction across 25 file extensions, with a regex-based parser fallback for 5 additional languages.

### Supported Language Extensions (30 total)

- **Tree-sitter AST Engine (25 extensions)**: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.go`, `.rs`, `.java`, `.c`, `.h`, `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hxx`, `.cs`, `.rb`, `.swift`, `.php`, `.vue` (isolated `<script>` blocks), `.kt`, `.kts`, `.dart` ([`loader.ts → loadConfig`](packages/@monomind/monograph/src/parsers/loader.ts#loadConfig)).
- **Regex Fallback Extractor (5 languages)**: Scala (`.scala`, `.sc`), Lua (`.lua`), Zig (`.zig`), PowerShell (`.ps1`, `.psm1`), Elixir (`.ex`, `.exs`) ([`language-parsers.ts → extractSymbolsForLanguage`](packages/@monomind/monograph/src/parsers/language-parsers.ts#extractSymbolsForLanguage)).

### Parser & Extraction Workflow
1. **`getParser(ext)`** ([`loader.ts → getParser`](packages/@monomind/monograph/src/parsers/loader.ts#getParser)): Dynamically loads and caches Tree-sitter parsers per file extension.
2. **`parseFile(...)`** ([`loader.ts → parseFile`](packages/@monomind/monograph/src/parsers/loader.ts#parseFile)): Isolates script content in single-file components (`.vue`) before passing to Tree-sitter.
3. **`extractSymbols()`** ([`extractor.ts → extractSymbols`](packages/@monomind/monograph/src/parsers/extractor.ts#extractSymbols)): Traverses the Tree-sitter syntax tree, creates root `File` nodes, matches node types against language config rules (`classNodeTypes`, `functionNodeTypes`, `methodNodeTypes`, `structNodeTypes`), and generates symbol nodes and `CONTAINS` edges.

---

## 2. Graph Database & SQLite Schema

Monograph persists the codebase graph in an embedded SQLite database (`.monomind/monograph.db`) with FTS5 trigram search and automated triggers.

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
Located at `packages/@monomind/monograph/src/graph/ripple-impact.ts` ([`rippleImpactFromMap`](packages/@monomind/monograph/src/graph/ripple-impact.ts#rippleImpactFromMap)):

- **Traversal**: BFS traversal outward along directed outgoing edges up to a max depth (default `depth = 3`).
- **Decay Formula**: Calculates impact score using exponential depth decay:
  $$\text{ImpactScore} = \sum_{d=1}^{\text{maxDepth}} N_d \times (\text{decayFactor})^d$$
  *(where $N_d$ is the number of affected nodes at depth $d$, and $\text{decayFactor} = 0.5$)*.
- **LLM Context Formatting**: `formatRippleImpact()` ([`formatRippleImpact`](packages/@monomind/monograph/src/graph/ripple-impact.ts#formatRippleImpact)) transforms the graph traversal tree into a structured markdown report for AI model consumption.

---

## 5. Graph Freshness & Staleness Detection

Monograph detects likely staleness through a three-layer system. It reduces the chance of serving an outdated graph; it does not guarantee the index matches the working tree — see the limitations below before relying on a freshness result:

1. **Git Commit Hash Verification** ([`git-staleness.ts → checkStaleness`](packages/@monomind/monograph/src/staleness/git-staleness.ts#checkStaleness)):
   Compares `last_commit_hash` in `index_meta` against `git rev-parse HEAD`. If different, runs `git diff --name-only <indexed>..HEAD` to detect changed files and mark graph nodes as stale.
2. **SHA-256 File Content Hashing** ([`file-cache.ts → hashFileContent`](packages/@monomind/monograph/src/storage/file-cache.ts#hashFileContent)):
   Computes file content hashes and compares against the `file_cache` table to skip unchanged files during incremental graph builds.
3. **Live File System Watcher** (`monograph_watch`, [`mcp-tools/monograph/build-tools.ts → monographWatchTool`](packages/@monomind/cli/src/mcp-tools/monograph/build-tools.ts#monographWatchTool), backed by [`packages/@monomind/monograph/src/watch/watcher.ts`](packages/@monomind/monograph/src/watch/watcher.ts)):
   Listens for file system change events and keeps the graph in sync during an active editing session, with two distinct thresholds:
   - **`INCREMENTAL_THRESHOLD = 20`** ([`monograph/src/pipeline/orchestrator.ts → buildIncrementalAsync`](packages/@monomind/monograph/src/pipeline/orchestrator.ts#buildIncrementalAsync)) — if a batch of changed files exceeds 20, the watcher falls back to a full rebuild instead of an incremental update.
   - **`FULL_REBUILD_IDLE_MS = 60_000`** ([`watch/watcher.ts → FULL_REBUILD_IDLE_MS`](packages/@monomind/monograph/src/watch/watcher.ts#FULL_REBUILD_IDLE_MS)) — after 60s of no further file-change events, the watcher schedules one deferred full rebuild to reconcile any drift from the incremental updates it applied in between.

   (This is unrelated to any separate watcher idle/auto-stop timeout elsewhere in the CLI — the two numbers above are the incremental-vs-full-rebuild mechanics specific to this watcher, not a "stop watching" timeout.)

### Known freshness limitations

Layer 1 compares committed revisions, so a "fresh" result does not mean the index
matches what is currently on disk:

- **Uncommitted working-tree edits are invisible to it.** A file edited but not yet
  committed leaves `last_commit_hash` equal to `HEAD`, so the index reports fresh
  while the graph still describes the pre-edit code.
- **When Git is unavailable, staleness cannot be determined**, and the check does not
  report the index as stale in that case — so a non-Git checkout, a missing `git`
  binary, or a shallow/detached state yields a not-stale answer that carries no
  evidence behind it.
- **A watcher is not always running.** Layers 2 and 3 only narrow the window while a
  build or an active watch session is in progress; neither runs continuously by
  default.

Treat a fresh result as "no committed change detected", not as a guarantee. When
coverage or freshness matters for a decision, verify against the files themselves
rather than relying on the graph alone.

---

## 6. MCP Tools Suite (Selected `monograph_*` Tools)

`packages/@monomind/cli/src/mcp-tools/monograph-tools.ts` is now an 8-line backward-compat
re-export shim — the real implementations live in individual files under
`packages/@monomind/cli/src/mcp-tools/monograph/`. The 15 tools below are selected examples,
not a curated "top 15" or a meaningful tier — see the note after the list for the real
category boundary (default vs. advanced-gated):

1. `monograph_build` ([`build-tools.ts → monographBuildTool`](packages/@monomind/cli/src/mcp-tools/monograph/build-tools.ts#monographBuildTool)): Rebuilds or incrementally updates the knowledge graph.
2. `monograph_watch` ([`build-tools.ts → monographWatchTool`](packages/@monomind/cli/src/mcp-tools/monograph/build-tools.ts#monographWatchTool)): Starts the live file-watcher described in §5.3 above.
3. `monograph_query` ([`query-tools.ts → monographQueryTool`](packages/@monomind/cli/src/mcp-tools/monograph/query-tools.ts#monographQueryTool)): BM25/FTS search with optional one-hop neighbor-expansion reranking (a single outgoing hop taking the maximum propagated score — not iterative Personalized PageRank).
4. `monograph_stats` ([`health-tools.ts → monographStatsTool`](packages/@monomind/cli/src/mcp-tools/monograph/health-tools.ts#monographStatsTool)): Reports node/edge totals and graph density metrics.
5. `monograph_health` ([`health-tools.ts → monographHealthTool`](packages/@monomind/cli/src/mcp-tools/monograph/health-tools.ts#monographHealthTool)): Computes graph connectivity and complexity health scores.
6. `monograph_god_nodes` ([`query-tools.ts → monographGodNodesTool`](packages/@monomind/cli/src/mcp-tools/monograph/query-tools.ts#monographGodNodesTool)): Identifies central high-degree nodes (architectural hubs).
7. `monograph_get_node` ([`query-tools.ts → monographGetNodeTool`](packages/@monomind/cli/src/mcp-tools/monograph/query-tools.ts#monographGetNodeTool)): Retrieves attributes and edge connections for a specific node.
8. `monograph_shortest_path` ([`query-tools.ts → monographShortestPathTool`](packages/@monomind/cli/src/mcp-tools/monograph/query-tools.ts#monographShortestPathTool)): Executes BFS pathfinding between two code nodes.
9. `monograph_community` ([`group-tools.ts → monographCommunityTool`](packages/@monomind/cli/src/mcp-tools/monograph/group-tools.ts#monographCommunityTool)): Inspects Louvain community clusters.
10. `monograph_surprises` ([`group-tools.ts → monographSurprisesTool`](packages/@monomind/cli/src/mcp-tools/monograph/group-tools.ts#monographSurprisesTool)): Detects unusual cross-boundary coupling and non-obvious dependencies.
11. `monograph_suggest` ([`query-tools.ts → monographSuggestTool`](packages/@monomind/cli/src/mcp-tools/monograph/query-tools.ts#monographSuggestTool)): Recommends relevant code files for task prompts.
12. `monograph_staleness` ([`health-tools.ts → monographStalenessTool`](packages/@monomind/cli/src/mcp-tools/monograph/health-tools.ts#monographStalenessTool)): Checks graph freshness against the Git HEAD commit.
13. `monograph_context` ([`query-tools.ts → monographContextTool`](packages/@monomind/cli/src/mcp-tools/monograph/query-tools.ts#monographContextTool)): Assembles deep multi-hop graph context for LLM prompts.
14. `monograph_impact` ([`impact-tools.ts → monographImpactTool`](packages/@monomind/cli/src/mcp-tools/monograph/impact-tools.ts#monographImpactTool)): Computes change blast radius and affected downstream files.
15. `monograph_cypher` ([`query-tools.ts → monographCypherTool`](packages/@monomind/cli/src/mcp-tools/monograph/query-tools.ts#monographCypherTool)): Executes custom subset Cypher pattern queries against the SQLite graph.

> **The 15 tools listed above are not a meaningful subset — they're carried over from an
> earlier, smaller version of this section (14 tools) plus the one addition below, not a
> deliberately curated "most important" or "most used" list.** The real, principled category
> boundary is default vs. advanced-gated. The full registry
> ([`mcp-tools/monograph/index.ts`](packages/@monomind/cli/src/mcp-tools/monograph/index.ts)) exposes **19 tools by default** plus **27 more
> gated behind `MONOGRAPH_MCP_ADVANCED=1`** — 46 total (matching the count already correctly
> stated in `doc/index.html`'s package table). Of the 15 above, `monograph_shortest_path`,
> `monograph_community`, `monograph_surprises`, and `monograph_cypher` happen to be in the
> advanced-gated set ([`index.ts → advancedMonographTools`](packages/@monomind/cli/src/mcp-tools/monograph/index.ts#advancedMonographTools)); the other 11 happen to be in the default set. The
> remaining ~31 tools (including `monograph_doctor`, `monograph_dead_code`, `monograph_rename`,
> `monograph_wiki`, the `monograph_group_*` family, `monograph_agent_*` family, and more)
> aren't individually catalogued here yet.

---

## 7. LSP Server

Monograph ships a Language Server Protocol server as a real, separate capability from the
MCP tool suite above:

- **Package export:** `@monoes/monograph` exposes a dedicated `./lsp` subpath
  ([`package.json`](packages/@monomind/monograph/package.json): `import "@monoes/monograph/lsp"` resolves to `dist/src/lsp/server.js`).
- **CLI subcommand:** `monomind monograph lsp` ([`commands/monograph.ts → lspCommand`](packages/@monomind/cli/src/commands/monograph.ts#lspCommand)) starts it.
- **Source:** [`packages/@monomind/monograph/src/lsp/`](packages/@monomind/monograph/src/lsp/).
- **Test coverage:** 6 dedicated suites under [`tests/monograph/lsp/`](tests/monograph/lsp/) — `server`, `hover`, `code-lens`, `code-actions`, `diagnostics`, `diagnostics-ext`.
