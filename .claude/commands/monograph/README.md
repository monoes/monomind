---
name: monograph:README
description: Monograph skills index — build, search, and explore the knowledge graph across code, docs, and PDFs using real CLI subcommands and MCP tools
---

# Monograph Commands

Knowledge graph for code and documents — build, search, and explore relationships across your entire codebase and documentation.

Alias: `monomind kg`

## CLI Subcommands

| Subcommand | Description |
|---|---|
| `monograph build` | Build knowledge graph from code + docs + PDFs |
| `monograph wiki` | Scan all docs and PDFs into a searchable knowledge graph |
| `monograph search` | Search the graph (BM25 / semantic / hybrid) |
| `monograph stats` | Show node/edge counts and top concepts |
| `monograph watch` | Watch for file changes and rebuild incrementally |

## Quick Reference

```bash
# First-time build (code + all docs)
npx monomind monograph build

# Doc/wiki-focused build with Claude semantic extraction
npx monomind monograph wiki --llm

# Search
npx monomind monograph search -q "authentication flow"
npx monomind monograph search -q "pipeline" --mode semantic --label Section

# Stats
npx monomind monograph stats --top 20

# Auto-rebuild on changes
npx monomind monograph watch
```

## Files

- [monograph-build.md](./monograph-build.md) — Full build (code + docs + PDFs)
- [monograph-wiki.md](./monograph-wiki.md) — Doc/PDF-focused wiki build
- [monograph-search.md](./monograph-search.md) — Search the knowledge graph
- [monograph-stats.md](./monograph-stats.md) — Graph statistics
- [monograph-watch.md](./monograph-watch.md) — Watch mode (incremental rebuild)

## MCP Tools

The monograph MCP tools (available in Claude Code via monomind MCP server) provide programmatic access to the graph without invoking the CLI:

| Tool | Use When |
|---|---|
| `mcp__monomind__monograph_build` | Build/rebuild the graph |
| `mcp__monomind__monograph_query` | BM25 keyword search; returns file + line number |
| `mcp__monomind__monograph_suggest` | Start every task — returns relevant files ranked by task description |
| `mcp__monomind__monograph_god_nodes` | Find high-centrality internal files |
| `mcp__monomind__monograph_stats` | Node/edge counts |
| `mcp__monomind__monograph_report` | Generate GRAPH_REPORT.md |
| `mcp__monomind__monograph_shortest_path` | How two modules are connected |
| `mcp__monomind__monograph_community` | Files forming a cohesive cluster |
| `mcp__monomind__monograph_surprises` | Unexpected cross-community edges |
| `mcp__monomind__monograph_export` | Export graph in various formats |
| `mcp__monomind__monograph_watch` | Start watch mode via MCP |
| `mcp__monomind__monograph_watch_stop` | Stop watch mode |
| `mcp__monomind__monograph_context` | 360-degree view of a file: importers, imports, siblings |
| `mcp__monomind__monograph_health` | Index staleness (commits behind HEAD) |

## Node Types

| Type | Description |
|---|---|
| `File` | Source code or document file |
| `Section` | Markdown heading or document section |
| `Function` | Code function or method |
| `Class` | Code class or interface |
| `Concept` | Extracted semantic concept |
| `PDF` | PDF document chunk |

## Edge Types

| Relation | Meaning |
|---|---|
| `IMPORTS` | Code import dependency |
| `DEFINES` | File defines symbol |
| `TAGGED_AS` | Section tagged with concept |
| `CO_OCCURS` | Concepts appear together |
| `INFERRED` | Claude-extracted semantic relationship |
| `DESCRIBES` / `CAUSES` / `PART_OF` | LLM-enriched semantic edges |

## When to Use CLI vs MCP

- **CLI** (`npx monomind monograph ...`) — One-time builds, manual searches, watching from terminal
- **MCP tools** (`mcp__monomind__monograph_*`) — Claude Code integration, programmatic queries during tasks

## See Also

- `memory` — Vector memory storage (separate from graph)
- `hooks intelligence` — Pattern learning
- CLAUDE.md Knowledge Graph section — workflow guidance for multi-file tasks
