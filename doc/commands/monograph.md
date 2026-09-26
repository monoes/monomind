# Monograph Command Reference (`monomind monograph`)

> Command reference for `monomind monograph` CLI subcommands and native `monograph_*` MCP tools.
> Package Version: `@monoes/monograph` `v1.5.6` | CLI Integration: `@monoes/monomindcli` `v2.9.0`

---

## Overview

The `monomind monograph` command family manages Monomind's codebase knowledge graph (`@monoes/monograph` `v1.5.6`). It parses 25 Tree-sitter file extensions and 5 regex fallback languages into SQLite WAL-mode tables, tracks graph freshness via Git commits, calculates change blast radius, and generates automated wiki documentation.

Defined in `packages/@monomind/cli/src/commands/monograph.ts` and `packages/@monomind/cli/src/mcp-tools/monograph-tools.ts`.

---

## CLI Subcommands (6)

| Subcommand | Description | Key Flags | Source Reference |
|---|---|---|---|
| `build` | Builds or rebuilds knowledge graph using Tree-sitter parsers | `--force`, `--incremental`, `--concurrency N` | [`monograph.ts → buildCommand`](packages/@monomind/cli/src/commands/monograph.ts#buildCommand) |
| `wiki` | Generates architectural Markdown wiki documentation from graph | `--output-dir`, `--format md` | [`wiki-build.ts`](packages/@monomind/monograph/src/mcp-tools/wiki-build.ts) |
| `search` | FTS5 trigram + vector search across codebase symbols | `--query`, `--limit N`, `--type symbol\|file` | [`query.ts`](packages/@monomind/monograph/src/mcp-tools/query.ts) |
| `stats` | Displays node/edge counts, communities, and complexity health metrics | `--json` | [`stats.ts`](packages/@monomind/monograph/src/graph/stats.ts) |
| `watch` | Starts background file watcher for incremental real-time AST updates | `--debounce-ms 300` | [`monograph.ts → watchCommand`](packages/@monomind/cli/src/commands/monograph.ts#watchCommand) |
| `impact` | Calculates blast radius and ripple impact for a target node or file | `--target "..."`, `--depth N` | [`impact-tools.ts → monographImpactTool`](packages/@monomind/cli/src/mcp-tools/monograph/impact-tools.ts#monographImpactTool) |

### `watch` and the build lock

A rebuild holds `.monomind/monograph.db.build-lock` until it finishes. Ctrl+C
during a rebuild exits at once (it no longer waits for the rebuild to end first)
and releases the lock; Ctrl+C between rebuilds prints `Watch stopped.` A build
that exits through `process.exit()` — an MCP server shutting down mid-rebuild,
for example — also releases a lock it still holds. If a previous `watch` was
killed while holding the lock, the next `watch`/`build` takes over a stale lock
automatically: one that predates the last boot (a recycled pid) or one whose
holder has not refreshed it for 30 minutes. While it waits, it prints
`Rebuild deferred — another build is in progress` naming the holder (e.g.
`pid 1234, running 2m`); after 10 minutes of deferral it stops retrying and
reports which pid and lock file block it. Files changed during the deferral are
picked up on the next change. (`@monoes/monograph` `1.6.11`.)

---

## Native MCP Tools (14)

In addition to CLI commands, Monomind exposes 14 native `monograph_*` tools for Model Context Protocol integration ([`monograph-tools.ts`](packages/@monomind/cli/src/mcp-tools/monograph-tools.ts)):

| Tool Name | Key Arguments | Purpose |
|---|---|---|
| `monograph_build` | `force: boolean` | Build or update knowledge graph. |
| `monograph_query` | `query: string, ppr: boolean` | Hybrid FTS + PPR graph search. |
| `monograph_stats` | *(none)* | High-level graph metrics. |
| `monograph_health` | *(none)* | Graph connectivity and complexity health. |
| `monograph_god_nodes` | `limit: number` | Find central high-degree hub nodes. |
| `monograph_get_node` | `id: string` | Inspect single node properties and edges. |
| `monograph_shortest_path` | `sourceId: string, targetId: string` | BFS pathfinding between code nodes. |
| `monograph_community` | `communityId: string` | Inspect Louvain community details. |
| `monograph_surprises` | `limit: number` | Surface unexpected cross-boundary couplings. |
| `monograph_suggest` | `prompt: string` | Suggest relevant files for user prompts. |
| `monograph_staleness` | *(none)* | Check graph freshness against Git HEAD commit. |
| `monograph_context` | `prompt: string, depth: number` | Build deep multi-hop graph context. |
| `monograph_impact` | `target: string, depth: number` | Calculate change blast radius and affected downstream files. |
| `monograph_cypher` | `query: string` | Execute custom Cypher pattern query. |

---

## Blast Radius Calculation (`monograph_impact`)

The blast radius calculator evaluates the ripple impact of modifying a specific symbol or file:

```bash
# Calculate blast radius up to depth 3
monomind monograph impact --target "packages/@monomind/monograph/src/parsers/loader.ts" --depth 3
```

Algorithm uses Breadth-First Search (BFS) with depth score decay:
$$\text{ImpactScore} = \sum_{d=1}^{\text{maxDepth}} N_d \times (0.5)^d$$

---

## Freshness & Staleness Detection

Monograph checks graph freshness against Git commits (`git rev-parse HEAD` vs `last_commit_hash` in `index_meta` table). When commits drift, `monograph_staleness` reports stale file paths needing re-indexing.
