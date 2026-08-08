# Memory Command Reference (`monomind memory`)

> Reference for `monomind memory` CLI subcommands, search options, and storage management.
> CLI Version: `@monoes/monomindcli` `v2.9.0` | Memory Schema: `v3.0.0`

---

## Overview

The `monomind memory` command family provides direct CLI access to Monomind's persistent SQLite memory store (operating in WAL mode). Supports standalone `@monoes/memory` core schema (schema version 3 — `SCHEMA_VERSION` constant at [`sql-schema.ts:28`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/memory/src/sql-schema.ts#L28), applied via `PRAGMA user_version` — 5 tables: `memory_entries`, `memory_embeddings`, `memory_entry_tags`, `agent_reads`, plus the FTS5 virtual table `memory_entries_fts`) and CLI project memory schema (v3.0.0, 9 tables at [`memory-schema.ts:15`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/memory/memory-schema.ts#L15): `memory_entries`, `patterns`, `pattern_history`, `trajectories`, `trajectory_steps`, `migration_state`, `sessions`, `vector_indexes`, `metadata`).

Defined in `packages/@monomind/cli/src/commands/memory.ts` and `memory-transfer.ts`.

---

## Subcommands (12)

| Subcommand | Usage | Description |
|---|---|---|
| `init` | `monomind memory init` | Initialize local SQLite memory database (`.monomind/memory/memory.db`) and schema v3.0.0. |
| `store` | `monomind memory store -k <key> -v <val> [-n <ns>] [-t <tags>]` | Store a key-value entry in the specified namespace (default: `default`) with temporal decay tracking. |
| `edit` | `monomind memory edit -k <key> -v <val> [-n <ns>]` | Update an existing memory entry content and metadata. |
| `retrieve` | `monomind memory retrieve -k <key> [-n <ns>]` | Retrieve a specific entry by key and namespace. |
| `search` | `monomind memory search <query> [--limit <n>] [--build-hnsw]` | Execute hybrid search across dense vector cosine distance and BM25 lexical rank. Optional `--build-hnsw` flag triggers fallback HNSW graph build. |
| `list` | `monomind memory list [-n <ns>] [--limit <n>]` | List stored entries filtered by namespace and page size. |
| `delete` | `monomind memory delete -k <key> [-n <ns>]` | Delete an entry from the specified namespace. |
| `templates` | `monomind memory templates` | Manage reusable memory schemas and entry templates. |
| `stats` | `monomind memory stats` | Display memory subsystem database metrics, total entries, table counts, and vector index status. |
| `configure` | `monomind memory configure [--decay-rate <r>]` | Adjust global memory configuration parameters (decay rates, confidence thresholds). |
| `export` | `monomind memory export --format okf -o <dir> [-s <scope>]` | Export memory entries and namespaces to an Open Knowledge Format (OKF) directory bundle with Markdown files and YAML frontmatter. (`--format okf` required). |
| `import` | `monomind memory import --format okf -i <dir> [-s <scope>]` | Import memory entries from an OKF directory bundle. (`--format okf` required). |

---

## Hybrid Search Architecture & Options

`monomind memory search` uses Reciprocal Rank Fusion (RRF) combining two retrieval pathways:

1. **Dense Vector Search**: Powered by `Alibaba-NLP/gte-modernbert-base` (768 dimensions).
2. **Lexical Search**: Okapi BM25 ($k_1=1.2, b=0.75$) with tokenizer parity.

```bash
# Execute hybrid RRF search
monomind memory search "authentication token expiration handling"

# Build fallback HNSW index (consulted only if SQLite bridge is unavailable)
monomind memory search --build-hnsw
```

---

## OKF Transfer Format

OKF (Open Knowledge Format) allows exporting and importing memory entries across workspaces using human-readable Markdown files with structured YAML headers.

```bash
# Export memory to OKF bundle
monomind memory export --format okf -o ./memory-backup

# Import memory from OKF bundle
monomind memory import --format okf -i ./memory-backup
```
