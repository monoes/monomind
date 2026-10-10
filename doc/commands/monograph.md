# Monograph Command Reference (`monomind monograph`)

> Command reference for `monomind monograph` CLI subcommands and native `monograph_*` MCP tools.
> Engine: `@monoes/monograph`; the CLI version is whatever `monomind --version` prints.

---

## Overview

The `monomind monograph` command family manages Monomind's knowledge graph (`@monoes/monograph`). It parses code with Tree-sitter WASM grammars (no native builds), indexes documents (md/txt/rst) and PDFs next to it, and stores everything in SQLite WAL-mode tables. It tracks graph freshness via Git commits, calculates change blast radius, and builds a wiki-style document graph.

Defined in `packages/@monomind/cli/src/commands/monograph.ts` and `packages/@monomind/cli/src/mcp-tools/monograph-tools.ts`.

---

## CLI Subcommands (6)

Every subcommand takes `-p, --path <dir>` for the root to work on (default: the current directory).

| Subcommand | Description | Key Flags | Source Reference |
|---|---|---|---|
| `build` | Builds or rebuilds the graph from code, docs and PDFs | `-f, --force` (full rebuild even if the index is fresh), `--code-only` (skip documents), `--llm` and `--llm-sections <n>` (Claude semantic extraction, default 50 sections), `--report-path <path>` (where `GRAPH_REPORT.md` goes; default `.monomind/GRAPH_REPORT.md`, env `MONOGRAPH_REPORT_PATH`) | [`monograph-build.ts → buildCommand`](packages/@monomind/cli/src/commands/monograph-build.ts#buildCommand) |
| `wiki` | Scans all docs and PDFs in the project into a searchable document graph | `-f, --force`, `--llm`, `--llm-sections <n>` (default 100) | [`monograph-wiki.ts`](packages/@monomind/cli/src/commands/monograph-wiki.ts) |
| `search` | Searches the graph | `-q, --query` (required), `-l, --limit` (default 15), `-m, --mode bm25\|semantic\|hybrid` (default `hybrid`), `--label <type>` (filter by node type such as `Section`, `Function`, `Concept`, `File`) | [`monograph-search.ts`](packages/@monomind/cli/src/commands/monograph-search.ts) |
| `stats` | Displays node counts, edge types and top concepts | `--top <n>` (default 10) | [`monograph-stats.ts`](packages/@monomind/cli/src/commands/monograph-stats.ts) |
| `watch` | Starts a background file watcher that rebuilds incrementally | `--llm` (enrich on rebuild), `--timeout <seconds>` (stop watching after N seconds, for scripted checks) | [`monograph-watch.ts → watchCommand`](packages/@monomind/cli/src/commands/monograph-watch.ts#watchCommand) |
| `lsp` | Starts the Monograph LSP server over stdio, for editor integration | | [`monograph-lsp.ts`](packages/@monomind/cli/src/commands/monograph-lsp.ts) |

Blast-radius analysis is not a CLI subcommand: it is the `monograph_impact` MCP tool (see below), which you can call from the CLI with `monomind mcp exec -t monograph_impact -p '{"name":"<symbol>"}'`.

### `watch` and the build lock

A rebuild holds `.monomind/monograph.db.build-lock` until it finishes. Ctrl+C
during a rebuild exits at once (it no longer waits for the rebuild to end first)
and releases the lock; Ctrl+C between rebuilds prints `Watch stopped.` A build
that exits through `process.exit()` — an MCP server shutting down mid-rebuild,
for example — also releases a lock it still holds. If a previous `watch` was
killed while holding the lock, the next `watch`/`build` takes over a stale lock
automatically: one from a previous boot, one from a different pid namespace
(sandboxed tools give each command its own, with small reused pids — that lock is
stale once its heartbeat has gone silent for 2 minutes), or one in the same pid
namespace whose holder has not refreshed it for 30 minutes. While it waits, it prints
`Rebuild deferred — another build is in progress` naming the holder (e.g.
`pid 1234, running 2m`); after 10 minutes of deferral it stops retrying and
reports which pid and lock file block it. Files changed during the deferral are
picked up on the next change.

---

## Native MCP Tools

Monomind exposes 19 core `monograph_*` tools for Model Context Protocol integration ([`monograph-tools.ts`](packages/@monomind/cli/src/mcp-tools/monograph-tools.ts)). A further 27 advanced tools register only when `MONOGRAPH_MCP_ADVANCED=1` is set.

| Tool Name | Key Arguments | Purpose |
|---|---|---|
| `monograph_build` | `path`, `codeOnly`, `force`, `incremental` | Build or update the knowledge graph. |
| `monograph_query` | `query` (required), `limit`, `label`, `mode`, `expandNeighbors`, `damping`, `tokenBudget` | Lexical keyword search; `mode=hybrid` (default) ranks by BM25, LIKE fallback and fuzzy matching, `mode=bm25` by BM25 only. |
| `monograph_suggest` | `task`, `limit`, `checkStaleness` | Nodes most relevant to a task, with `file:line`; without `task`, graph-topology questions. |
| `monograph_impact` | `name` (required), `nodeId`, `filePath`, `depth` | Blast radius: direct and transitive callers of a symbol, with a risk score. When a name matches several definitions the candidates are listed; re-query with `nodeId` or `filePath`. |
| `monograph_context` | `name` (required), `nodeId`, `filePath` | 360-degree view of a symbol: callers, callees, imports, importedBy, community and processes. |
| `monograph_neighbors` | `name`, `nodeId`, `filePath`, `relationFilter`, `includeInbound`, `limit` | Directly connected nodes with their relation types. |
| `monograph_dead_code` | `path`, `categories` | Exported functions with no inbound references, files nothing imports, stale `dist` artifacts. Verify candidates before deleting. |
| `monograph_stats` | *(none)* | Node, edge and community counts and index freshness. |
| `monograph_health` | *(none)* | Index freshness as an explicit state (fresh, stale, building, partial, unknown) with indexed revision, scope, dirty-worktree status and last refresh error. |
| `monograph_augment` | `query` (required), `topK`, `format` | Graph-RAG context block for injection into a prompt. |
| `monograph_god_nodes` | `limit` | Most connected real code entities. |
| `monograph_detect_changes` | `baseBranch`, `includeTests` | Git diff mapped to the indexed symbols in the changed files. |
| `monograph_get_node` | `id` (required) | One node by exact ID or name. |
| `monograph_api_impact` | `routePath` (required), `method` | Blast radius of an HTTP route: finds the handler and walks forward through call edges. |
| `monograph_route_map` | `prefix`, `method`, `includeMiddleware` | HTTP routes with their handlers. |
| `monograph_staleness` | `path` | Index freshness against Git HEAD: `commitsBehind`, `status`, `triggered`, plus the evidence. |
| `monograph_watch` | `path` | Start the incremental file watcher (3 s debounce). |
| `monograph_watch_stop` | `path` | Stop the watcher. |
| `monograph_doctor` | *(none)* | Platform diagnostics: Node version, SQLite health, node count, disk space. |

The advanced set adds, among others, `monograph_cypher`, `monograph_shortest_path`, `monograph_community`, `monograph_surprises`, `monograph_rename`, `monograph_snapshot`, `monograph_diff`, `monograph_visualize` and the `monograph_group_*` tools.

---

## Blast Radius Calculation (`monograph_impact`)

The blast radius calculator evaluates the ripple impact of modifying a specific symbol:

```bash
# Blast radius of one symbol, up to depth 3
monomind mcp exec -t monograph_impact -p '{"name":"loadParser","depth":3}'
```

It walks callers breadth-first and returns a risk score with the affected downstream symbols and files.

---

## Freshness & Staleness Detection

Monograph checks graph freshness against Git commits (`git rev-parse HEAD` vs `last_commit_hash` in `index_meta` table). When commits drift, `monograph_staleness` reports stale file paths needing re-indexing.
