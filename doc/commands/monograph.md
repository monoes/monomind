# Monograph Command Reference (`monomind monograph`)

> Command reference for `monomind monograph` CLI subcommands and native `monograph_*` MCP tools.
> Package Version: `@monoes/monograph` `v1.5.6` | CLI Integration: `@monoes/monomindcli` `v2.9.0`

---

## Overview

The `monomind monograph` command family manages Monomind's codebase knowledge graph (`@monoes/monograph` `v1.5.6`). It parses 25 Tree-sitter file extensions and 5 regex fallback languages into SQLite WAL-mode tables, tracks graph freshness via Git commits, calculates change blast radius, and generates automated wiki documentation.

Defined in `packages/@monomind/cli/src/commands/monograph.ts` and `packages/@monomind/cli/src/mcp-tools/monograph-tools.ts`.

---

## CLI Subcommands (7)

| Subcommand | Description | Key Flags | Source Reference |
|---|---|---|---|
| `review` | Reviews bounded existing code-graph neighborhoods with Claude | `--dry-run`, `--max-units N`, `--max-files N`, `--timeout N` | [`monograph.ts`](packages/@monomind/cli/src/commands/monograph.ts) |
| `build` | Builds or rebuilds knowledge graph using Tree-sitter parsers | `--force`, `--incremental`, `--concurrency N` | [`monograph.ts:592`](packages/@monomind/cli/src/commands/monograph.ts#L592) |
| `wiki` | Generates architectural Markdown wiki documentation from graph | `--output-dir`, `--format md` | [`wiki-build.ts`](packages/@monomind/monograph/src/mcp-tools/wiki-build.ts) |
| `search` | FTS5 trigram + vector search across codebase symbols | `--query`, `--limit N`, `--type symbol\|file` | [`query.ts`](packages/@monomind/monograph/src/mcp-tools/query.ts) |
| `stats` | Displays node/edge counts, communities, and complexity health metrics | `--json` | [`stats.ts`](packages/@monomind/monograph/src/graph/stats.ts) |
| `watch` | Starts background file watcher for incremental real-time AST updates | `--debounce-ms 300` | [`monograph-tools.ts:660`](packages/@monomind/cli/src/mcp-tools/monograph-tools.ts#L660) |
| `impact` | Calculates blast radius and ripple impact for a target node or file | `--target "..."`, `--depth N` | [`monograph-tools.ts:1104`](packages/@monomind/cli/src/mcp-tools/monograph-tools.ts#L1104) |

---

## AI code graph review

`monomind monograph review` is an explicit, post-build enrichment command. It
does not rebuild the graph and is not part of normal `monograph build` or watch
execution. The command ranks existing graph neighborhoods, sends bounded graph
metadata and source snippets through the configured Claude CLI, and validates
the structured response before considering any write.

```bash
# Validate and display findings without writing edges
monomind monograph review --dry-run

# Review fewer neighborhoods and files
monomind monograph review --max-units 4 --max-files 4

# Machine-readable result
monomind monograph review --format json
```

The initial implementation only permits relationships between nodes already in
the graph. Every accepted relationship is `INFERRED`, capped at a conservative
confidence score, and carries an AI-review reason plus repository-relative file
and line evidence in the existing `edges.evidence` JSON column. `EXTRACTED`
edges are protected. Existing `INFERRED` edges are updated only when the new
score and evidence are clearly stronger. Non-relationship findings are returned
by the command/API but are not persisted yet.

The graph must exist first. Claude CLI must be installed and authenticated; if
it is unavailable, review is skipped with an actionable message. Selected code
snippets leave the local machine through that configured Claude runtime, so
privacy policy and repository sensitivity must be considered. Validation blocks
invented node IDs, unsafe or missing files, out-of-range or undisplayed lines,
unsupported relations, self-links, duplicates, and malformed output, but it
cannot prove that a semantically plausible inference is correct.

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
