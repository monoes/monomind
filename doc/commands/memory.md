# Memory Command Reference (`monomind memory`)

> Reference for `monomind memory` CLI subcommands, search options, and storage management.
> Core store schema: `PRAGMA user_version` 4 | CLI project memory schema: `v3.0.0`

---

## Overview

The `monomind memory` command family provides direct CLI access to Monomind's persistent SQLite memory store (operating in WAL mode). Supports standalone `@monoes/memory` core schema (schema version 4 — `SCHEMA_VERSION` constant at [`sql-schema.ts → SCHEMA_VERSION`](../../packages/@monomind/memory/src/sql-schema.ts#SCHEMA_VERSION), applied via `PRAGMA user_version` — 5 tables: `memory_entries`, `memory_embeddings`, `memory_entry_tags`, `agent_reads`, plus the FTS5 virtual table `memory_entries_fts`) and CLI project memory schema (v3.0.0, 9 tables at [`memory-schema.ts → MEMORY_SCHEMA`](../../packages/@monomind/cli/src/memory/memory-schema.ts#MEMORY_SCHEMA): `memory_entries`, `patterns`, `pattern_history`, `trajectories`, `trajectory_steps`, `migration_state`, `sessions`, `vector_indexes`, `metadata`).

Defined in `packages/@monomind/cli/src/commands/memory.ts` and `memory-transfer.ts`.

---

## Subcommands (12)

| Subcommand | Usage | Description |
|---|---|---|
| `init` | `monomind memory init [-b hybrid\|sqlite\|lancedb] [-p <path>] [-f] [--verify] [--load-embeddings]` | Create the legacy fallback database `.swarm/memory.db` (copied to `.claude/memory.db`), used only when the SQLite memory bridge (`@monoes/memory`) cannot load. The normal store, `~/.monomind/projects/<project>-<hash>/lancedb/`, needs no init: `memory store` creates it. The backend defaults to `hybrid`; `lancedb` is a legacy alias for the SQLite backend. `--verify` (default on) runs verification tests afterwards; `--load-embeddings` pre-loads the ONNX model instead of loading it lazily. `monomind init` runs this automatically unless given `--no-memory`. |
| `store` | `monomind memory store -k <key> --value <val> [-n <ns>] [--ttl <s>] [--tags a,b] [--vector] [-u]` | Store a key-value entry in a namespace (default: `default`). `--ttl` expires it after N seconds, `--vector` stores it as a vector embedding, and `-u, --upsert` replaces an existing key instead of failing. |
| `edit` | `monomind memory edit -k <key> --value <val> [-n <ns>] [-s sqlite\|palace\|knowledge] [--id <id>]` | Update an existing entry. `--source palace` or `knowledge` edits a Memory Palace drawer or a knowledge chunk by `--id`. `palace` is a legacy source: it works on `.monomind/palace/drawers.jsonl`, which nothing writes since the Memory Palace helper was removed ([#417](https://github.com/monoes/monomind/issues/417)). |
| `retrieve` | `monomind memory retrieve -k <key> [-n <ns>]` | Retrieve a specific entry by key and namespace. Alias: `get`. |
| `search` | `monomind memory search -q <query> [-n <ns>] [-l <n>] [--threshold <0-1>] [-t semantic\|keyword\|hybrid] [--build-hnsw]` | Search memory; the query can also be the first positional argument. `--limit` defaults to 10, `--type` to `semantic`. `--type` does not choose the search path: it is not passed to the backend, and the command only warns when the method that ran differs from the one requested. `--build-hnsw` force-builds the HNSW ANN index now; search otherwise builds and uses it automatically once the store passes `MONOMIND_HNSW_THRESHOLD` (default 100,000 embedded entries). |
| `list` | `monomind memory list [-n <ns>] [-t <tags>] [-l <n>]` | List stored entries filtered by namespace and tags; `--limit` defaults to 20. Alias: `ls`. |
| `delete` | `monomind memory delete -k <key> [-n <ns>] [-s lancedb\|palace\|knowledge] [--id <id>] [-f]` | Delete an entry. The default source is the SQLite store. The flag value is still `lancedb`, a historical name: the store is SQLite; `palace` (legacy, see `edit`) and `knowledge` delete by `--id`. `-f` skips the confirmation. Alias: `rm`. |
| `templates` | `monomind memory templates [-t user\|feedback\|project\|reference]` | Print best-practice templates for memory entries. |
| `stats` | `monomind memory stats` | Display memory subsystem database metrics, total entries, table counts, and vector index status. |
| `configure` | `monomind memory configure [-b <backend>] [--path <p>] [--cache-size <mb>] [--hnsw-m <n>] [--hnsw-ef <n>]` | Save memory settings to the project config. HNSW flag defaults: `M` 16, `ef` 200. These values are recorded but not applied: nothing reads them, and the HNSW index is built with its own defaults. Alias: `config`. |
| `export` | `monomind memory export -o <dir> [-f okf] [-n <ns>]` | Export entries to an Open Knowledge Format (OKF) directory bundle: one Markdown file with YAML frontmatter per entry, in a directory per namespace. `okf` is the only format; at most 10,000 entries are exported. |
| `import` | `monomind memory import -i <dir> [-m] [-n <ns>]` | Import an OKF directory of `.md` files. `--namespace` overrides the namespace in each file; `--merge` (default on) skips existing keys. |

---

## Hybrid Search Architecture & Options

`monomind memory search` runs two retrieval pathways and merges their results: the union by key, where a semantic hit wins over a keyword hit for the same key and keyword-only hits are appended.

1. **Dense Vector Search**: Powered by `Alibaba-NLP/gte-modernbert-base` (768 dimensions).
2. **Lexical Search**: always runs. SQLite FTS5 when the backend has it; otherwise in-process Okapi BM25 ($k_1=1.2, b=0.75$) for stores of up to 1,500 entries and a token-overlap scan above that (`MONOMIND_BM25=0` uses the scan at every size).

This is the path through the SQLite memory bridge. Only when the bridge cannot load does a legacy sql.js path run instead, a brute-force vector scan over `.swarm/memory.db`.

Results below the similarity threshold are dropped; it defaults to `0.3`
(`DEFAULT_SEARCH_THRESHOLD`,
[`memory-bridge-core.ts`](../../packages/@monomind/cli/src/memory/memory-bridge-core.ts#DEFAULT_SEARCH_THRESHOLD)),
loosened from an earlier `0.7` default that missed relevant paraphrases. Override it per call with
`--threshold <0-1>`.

```bash
# Semantic + keyword search
monomind memory search -q "authentication token expiration handling"

# Search with a stricter threshold than the 0.3 default
monomind memory search -q "authentication token expiration handling" --threshold 0.6

# Force-build the HNSW ANN index now (search uses it automatically above 100,000 entries)
monomind memory search -q "test" --build-hnsw
```

---

## OKF Transfer Format

OKF (Open Knowledge Format) allows exporting and importing memory entries across workspaces using human-readable Markdown files with structured YAML headers.

```bash
# Export memory to OKF bundle
monomind memory export -o ./memory-backup

# Import memory from OKF bundle
monomind memory import -i ./memory-backup
```
