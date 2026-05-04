---
name: monomind-memory
description: AgentDB memory system — store, search, retrieve, list, delete, and manage cross-session persistent memory with vector embeddings
---

# Monomind Memory System

Persistent memory backed by AgentDB with HNSW vector indexing for semantic search (150x-12,500x faster than brute-force). Supports cross-session and cross-agent collaboration.

## Subcommands

| Subcommand | Alias | Description |
|---|---|---|
| `init` | — | Initialize memory database (sql.js + AgentDB) |
| `store` | — | Store a key/value entry |
| `edit` | — | Edit an existing entry |
| `retrieve` | `get` | Retrieve entry by key |
| `search` | — | Semantic/vector search |
| `list` | `ls` | List memory entries |
| `delete` | `rm` | Delete an entry |
| `templates` | — | Show best-practice entry templates |
| `stats` | — | Show memory statistics |
| `configure` | `config` | Configure memory backend |
| `cleanup` | — | Clean expired/stale entries |
| `compress` | — | Compress and optimize storage |
| `export` | — | Export memory to file |
| `import` | — | Import memory from file |

## init — Initialize Database

```bash
npx monomind memory init
npx monomind memory init --backend agentdb --verbose --verify
npx monomind memory init --force  # Overwrite existing
```

**Flags:** `--backend hybrid|sqlite|agentdb` (default: `hybrid`), `--path`, `--force`, `--verbose`, `--verify` (default: true), `--load-embeddings`

## store — Store Data

```bash
# Store with specific namespace
npx monomind memory store --key "arch/api-design" --value "RESTful microservices" --namespace arch

# With tags and TTL
npx monomind memory store --key "pattern/auth" --value "JWT + refresh tokens" --namespace patterns --tags "auth,security" --ttl 86400

# Upsert (update if exists)
npx monomind memory store --key "bug/null-check" --value "Fixed null check in parser" --upsert
```

**Flags:**

| Flag | Short | Default | Description |
|---|---|---|---|
| `--key` | `-k` | — | Storage key (required) |
| `--value` | — | — | Value to store (required) |
| `--namespace` | `-n` | `default` | Memory namespace |
| `--ttl` | — | — | Time to live in seconds |
| `--tags` | — | — | Comma-separated tags |
| `--vector` | — | `false` | Store as vector embedding |
| `--upsert` | `-u` | `false` | Update if key exists |

## search — Semantic Search

```bash
# Semantic search (default)
npx monomind memory search --query "authentication patterns"

# Keyword search
npx monomind memory search --query "JWT" --type keyword

# Hybrid search with namespace filter
npx monomind memory search --query "error handling" --namespace patterns --limit 5

# Build HNSW index first for max speed
npx monomind memory search --query "API design" --build-hnsw
```

**Flags:**

| Flag | Short | Default | Description |
|---|---|---|---|
| `--query` | `-q` | — | Search query (required) |
| `--namespace` | `-n` | all | Filter by namespace |
| `--limit` | `-l` | `10` | Maximum results |
| `--threshold` | — | `0.7` | Similarity threshold (0-1) |
| `--type` | `-t` | `semantic` | `semantic`, `keyword`, `hybrid` |
| `--build-hnsw` | — | `false` | Rebuild HNSW index before search |

## retrieve — Get by Key

```bash
npx monomind memory retrieve --key "arch/api-design"
npx monomind memory retrieve --key "pattern/auth" --namespace patterns
```

**Flags:** `--key/-k` (required), `--namespace/-n` (default: `default`)

## list — Browse Entries

```bash
npx monomind memory list
npx monomind memory list --namespace patterns --limit 20
```

**Flags:** `--namespace/-n`, `--limit/-l` (default: `20`)

## delete — Remove Entry

```bash
npx monomind memory delete --key "old-pattern"
npx monomind memory delete --key "temp-key" --namespace temp --force
```

**Flags:** `--key/-k` (required), `--namespace/-n` (default: `default`), `--force/-f` (skip confirmation)

## templates — Entry Templates

```bash
npx monomind memory templates
npx monomind memory templates --type feedback
```

Types: `user`, `feedback`, `project`, `reference` — scaffolds for the auto-memory format.

## stats — Storage Overview

```bash
npx monomind memory stats
```

Shows backend, total entries, storage size, oldest/newest entry.

## configure — Backend Settings

```bash
npx monomind memory configure --backend agentdb
npx monomind memory configure --backend hybrid --cache-size 512 --hnsw-m 16 --hnsw-ef 200
```

**Flags:** `--backend/-b`, `--path`, `--cache-size`, `--hnsw-m`, `--hnsw-ef`

## cleanup — Remove Stale Entries

```bash
# Preview without deleting
npx monomind memory cleanup --dry-run

# Delete entries older than 30 days
npx monomind memory cleanup --older-than 30d

# Remove expired TTL entries only
npx monomind memory cleanup --expired-only

# Clean specific namespace
npx monomind memory cleanup --namespace temp --older-than 7d --force
```

**Flags:** `--dry-run/-d`, `--older-than/-o` (e.g., `7d`, `30d`), `--expired-only/-e`, `--namespace/-n`, `--force/-f`

## compress — Optimize Storage

```bash
npx monomind memory compress
npx monomind memory compress --quantize --bits 4  # 32x size reduction
npx monomind memory compress --level max --target vectors
```

**Flags:** `--level fast|balanced|max` (default: `balanced`), `--target vectors|text|patterns|all`, `--quantize/-z`, `--bits 4|8|16`, `--rebuild-index/-r` (default: true)

## export / import

```bash
# Export all to JSON
npx monomind memory export --output ./backup.json

# Export specific namespace to CSV
npx monomind memory export --output ./patterns.csv --format csv --namespace patterns

# Import
npx monomind memory import --input ./backup.json
npx monomind memory import --input ./backup.json --namespace archive
```

## Namespaces

`default`, `agents`, `tasks`, `sessions`, `swarm`, `project`, `spec`, `arch`, `impl`, `test`, `debug`, `patterns`, `solutions`

## MCP Tools

```javascript
// Store
mcp__monomind__memory_store({ key: "pattern/auth", value: "JWT + refresh", namespace: "patterns" })

// Search
mcp__monomind__memory_search({ query: "authentication", namespace: "patterns" })

// Retrieve
mcp__monomind__memory_retrieve({ key: "pattern/auth", namespace: "patterns" })

// List
mcp__monomind__memory_list({ namespace: "patterns" })

// Delete
mcp__monomind__memory_delete({ key: "pattern/auth", namespace: "patterns" })

// Stats
mcp__monomind__memory_stats({})
```

## Common Workflows

### Store successful pattern after completing a task

```bash
npx monomind memory store --key "pattern/oauth-integration" --value "Use PKCE flow, store tokens in httpOnly cookies" --namespace patterns --tags "auth,oauth"
```

### Search before starting a task

```bash
npx monomind memory search --query "OAuth integration patterns" --namespace patterns --limit 5
```

### Backup before major refactor

```bash
npx monomind memory export --output "./backups/memory-$(date +%Y%m%d).json"
```
