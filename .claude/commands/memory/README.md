---
name: memory:README
---

# Memory Commands

Commands for the AgentDB memory system — vector search, namespaced storage, HNSW indexing, and cross-session persistence.

## Available Subcommands

| Subcommand | Description |
|---|---|
| `memory init` | Initialize memory backend (agentdb, sqlite, hybrid) |
| `memory store` | Store a memory entry with optional vector embedding |
| `memory retrieve` | Retrieve a memory entry by key |
| `memory search` | Search memory (semantic / keyword / hybrid) |
| `memory list` | List all memory entries with optional filters |
| `memory edit` | Update an existing memory entry |
| `memory delete` | Delete one or more memory entries |
| `memory templates` | Manage memory templates |
| `memory stats` | Show memory usage statistics |
| `memory configure` | Configure memory backend settings |
| `memory cleanup` | Remove expired or stale entries |
| `memory compress` | Compress stored data and rebuild indexes |
| `memory export` | Export memories to JSON/JSONL file |
| `memory import` | Import memories from a file |

## Quick Reference

```bash
# Initialize
npx monomind memory init --backend hybrid

# Store
npx monomind memory store --key "auth-pattern" --value "Use JWT with refresh tokens" --namespace "patterns"

# Search
npx monomind memory search --query "authentication" --type hybrid --build-hnsw

# Retrieve exact key
npx monomind memory retrieve --key "auth-pattern"

# List all in namespace
npx monomind memory list --namespace "patterns"

# Export / Import
npx monomind memory export --output backup.json --format json
npx monomind memory import --input backup.json --merge
```

## Files

- [memory-search.md](./memory-search.md) — Search memory (semantic/keyword/hybrid + HNSW)

## MCP Tools

| Tool | Purpose |
|---|---|
| `mcp__monomind__memory_store` | Store a memory entry |
| `mcp__monomind__memory_retrieve` | Retrieve by key |
| `mcp__monomind__memory_search` | Search memory |
| `mcp__monomind__memory_list` | List entries |
| `mcp__monomind__memory_delete` | Delete entries |
| `mcp__monomind__memory_stats` | Usage statistics |
| `mcp__monomind__memory_migrate` | Migrate between backends |

## Backends

| Backend | Description | Recommended |
|---|---|---|
| `agentdb` | Full AgentDB with HNSW vector search | Production |
| `sqlite` | SQLite-only, no vector search | Lightweight |
| `hybrid` | SQLite + AgentDB HNSW | Default (recommended) |

## See Also

- `hooks intelligence` — pattern learning on top of memory
- `neural` — neural pattern training
- `session` — session state (separate from memory)
