# Memory Systems

> Monomind has three memory layers that work together: Memory Palace (BM25 verbatim search), a JSON pattern store with episodic recall (the hot path — no vector database involved), and Monograph (code knowledge graph). Each serves a different retrieval pattern.

---

## Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         MEMORY ARCHITECTURE                         │
│                                                                      │
│  L0 Identity (static)        L1 Story (top-5 scored)               │
│  .monomind/palace/           .monomind/palace/                      │
│  identity.md                 drawers.jsonl                           │
│         ↓ injected at session start                                 │
│                                                                      │
│  Pattern store + episodic    Monograph (code graph)                 │
│  patterns.json,              .monomind/monograph.db                 │
│  auto-memory-store.json,     SQLite + dependency graph              │
│  episodic/episodes.jsonl                                             │
│         ↓ recall injected at prompt time                            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. Memory Palace

**Files:** `.monomind/palace/`  
**Package:** `.claude/helpers/memory-palace.cjs`  
**Zero AI calls** — entirely deterministic, runs locally.

### Storage Layers

| Layer | File | What | When |
|---|---|---|---|
| L0 Identity | `identity.md` | Project name, stack, key packages, working style | Injected on EVERY session start |
| L1 Story | `drawers.jsonl` (top-5 scored) | Recent high-value task outcomes | Injected on session start |
| L2 On-demand | `drawers.jsonl` (namespace filter) | `recall(wing, room, limit)` call | Explicit retrieval |
| L3 Deep search | `drawers.jsonl` (BM25) | `search(query, wing?, room?, limit?)` | Most comprehensive |

### Drawers (Verbatim Chunks)

Every stored content is split into **800-character chunks with 100-character overlap** (step=700):

```json
{
  "id": "a3f9b2c1-...",
  "content": "800 char verbatim slice...",
  "wing": "tasks|sessions|architecture|debugging|general",
  "room": "default|archive|active|{agentSlug}",
  "hall": "2026-04-15|{taskId}|optional-subdomain",
  "score": 3.5,
  "ts": "2026-04-15T07:49:00.000Z"
}
```

**Score semantics:** Starts at 1.0. Every retrieval bumps the score. High-score drawers rise to L1 (auto-injected). Low-score drawers drift to L3 (deep search only).

**Wing taxonomy:**
- `tasks` — post-task hook output (what was accomplished)
- `sessions` — session-end markers and summaries
- `architecture` — architectural decisions
- `debugging` — bug fix records
- `general` — catch-all

### BM25 Search (L3)

Parameters: K1=1.5 (term saturation), B=0.75 (length normalization).

**Closet boost:** Each `closets.jsonl` topic term matching the query adds +0.5 to that drawer's score. Closets are extracted automatically via regex (no AI): markdown headers, action phrases, proper nouns, quoted passages.

### Temporal Knowledge Graph (`kg.json`)

Triples with `valid_from`/`valid_to` for bi-temporal queries:

```json
{
  "subject": "session-1713...",
  "predicate": "ended_at",
  "object": "2026-04-15T11:30:00Z",
  "valid_from": "2026-04-15T11:30:00Z",
  "confidence": 1.0
}
```

---
## 2. Memory Subsystem Architecture (v3.0.0 Schema)

**Schema Architecture**: Embedded SQLite database operating in **WAL mode** (`PRAGMA journal_mode = WAL`); the database file itself is created `chmod 0600` (owner read/write only). Supports standalone `@monoes/memory` core schema (schema version **3** — `SCHEMA_VERSION` constant, [`sql-schema.ts:L28`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/memory/src/sql-schema.ts#L28), applied via `PRAGMA user_version`; previously documented here as "v2", now stale) — **5 tables**: `memory_entries`, `memory_embeddings`, `memory_entry_tags`, `agent_reads`, plus the FTS5 full-text virtual table `memory_entries_fts` ([`sql-schema.ts:L187-218`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/memory/src/sql-schema.ts#L187-L218), added for issue #66) — and CLI project memory schema (v3.0.0, 9 tables at [`memory-schema.ts:15`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/memory/memory-schema.ts#L15): `memory_entries`, `patterns`, `pattern_history`, `trajectories`, `trajectory_steps`, `migration_state`, `sessions`, `vector_indexes`, `metadata`).

### Key Memory Stores

| Store Type | Namespace / Location | Implementation File | Feature Highlights |
|---|---|---|---|
| **Episodic & Semantic** | Namespace `default` (or custom) in `memory_entries` | [`memory-crud.ts:28-115`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/memory/memory-crud.ts#L28-L115), [`memory-bridge.ts:167-270`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/memory/memory-bridge.ts#L167-L270) | Temporal decay (`decay_rate = 0.01`), access frequency tracking, confidence score, importance weighting (`0.5` default). |
| **Pattern Store** | `patterns` table & `.swarm/sona-patterns.json` | [`sona-optimizer.ts:43-58`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/memory/sona-optimizer.ts#L43-L58), [`memory-schema.ts:61-76`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/memory/memory-schema.ts#L61-L76) | Learned task routing patterns based on keyword extraction, success/failure counts, and EWC diagonal Fisher regularization (`.swarm/ewc-fisher.json`). |
| **Document Store** | `memory_entries` (`doc:<hash>:<chunk>`) | [`document-pipeline.ts:120-180`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/knowledge/document-pipeline.ts#L120-L180), [`bm25-index.ts:71-75`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/memory/bm25-index.ts#L71-L75) | Multi-format document ingestion, content-hash chunking, Okapi BM25 lexical indexing. |
| **Knowledge Graph (KG)** | `kg:nodes`, `kg:edges`, `rules` in `memory_entries` | [`memory-kg.ts:34-36`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/memory/memory-kg.ts#L34-L36), [`memory-kg.ts:70-84`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/memory/memory-kg.ts#L70-L84) | Cognee-style concept triplets. Nodes: `n:<normalized-name>`, Edges: `e:<src>\|<rel>\|<dst>`. Deterministic entity keys and rule deduplication threshold (`0.78`). |

---

## 3. Retrieval & Hybrid Search Architecture

Monomind uses Reciprocal Rank Fusion (RRF) to combine dense vector representations with lexical BM25 retrieval across multiple memory surfaces.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        HYBRID RRF SEARCH PIPELINE                           │
│                                                                             │
│                        Query Input: "auth token"                            │
│                                     │                                       │
│                ┌────────────────────┴────────────────────┐                  │
│                ▼                                         ▼                  │
│     Dense Arm (ModernBERT 768d)               Lexical Arm (Okapi BM25)      │
│     Alibaba-NLP/gte-modernbert-base           k1=1.2, b=0.75                │
│     ONNX + HNSW fallback                      Exact Tokenizer Parity        │
│                │                                         │                  │
│                └────────────────────┬────────────────────┘                  │
│                                     ▼                                       │
│                        Query Router & Surface Rules                         │
│                        Negation Gate & 2x Confidence Gate                   │
│                                     │                                       │
│                                     ▼                                       │
│                       Reciprocal Rank Fusion (RRF)                          │
│         Score(d) = Σ [ 1 / (rrf_k + rank + 1) ] * (0.75 + 0.5 * importance) │
│                       Adaptive rrf_k ∈ [30, 60]                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1. Dense Embeddings
- **Model:** `Alibaba-NLP/gte-modernbert-base` (768 dimensions) ([`memory-bridge.ts:39-40`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/memory/memory-bridge.ts#L39-L40)).
- **Engine:** `@xenova/transformers` ONNX feature extraction (`embedding-operations.ts:84-100`).
- **HNSW Fallback:** Pure-JS `HNSWIndex` used if native SQLite binary loading fails ([`hnsw-operations.ts:29-38`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/memory/hnsw-operations.ts#L29-L38)).

### 2. Lexical Okapi BM25
- **Parameters:** `BM25_K1 = 1.2`, `BM25_B = 0.75` ([`bm25-index.ts:68-69`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/memory/bm25-index.ts#L68-L69)).
- **Tokenizer:** Shared `contentTokens` ([`text-tokens.ts:55-100`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/memory/text-tokens.ts#L55-L100)) ensuring exact evaluation harness parity.
- **Scaling Thresholds:** Live chunk warning at 50,000 chunks; index review threshold at 1,000,000 chunks ([`bm25-index.ts:58-65`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/memory/bm25-index.ts#L58-L65)).

### 3. Query Router & Surface Fusion
- **Surface Routing:** Evaluates rules across `chunks` (prior=0.5), `kg` (wt=2), `rules` (wt=2), `memory` (wt=2) ([`query-router.ts:71-92`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/memory/query-router.ts#L71-L92)).
- **Gates:** 20-character negation pre-match window skips negated query terms ([`query-router.ts:43`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/memory/query-router.ts#L43)). Top routing surface must score ≥ 2× runner-up or query broadcasts to all surfaces.
- **Telemetry:** Override telemetry is logged to `.monomind/metrics/route-overrides.json`.

---

## 4. Open Knowledge Format (OKF) & 20 MCP Tools

### OKF Transfer Engine
MonoMind supports export/import of memory entries and knowledge documents using the Open Knowledge Format (OKF):
- **Document OKF:** [`document-pipeline.ts:852-940`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/knowledge/document-pipeline.ts#L852-L940) exports/imports documents with standard YAML frontmatter headers and `index.md` manifest logs.
- **Memory OKF:** [`memory-transfer.ts:10-207`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/commands/memory-transfer.ts#L10-L207) transfers memory key-values across filesystem boundaries (`monomind memory export --format okf`).

### 20 MCP Memory Tools (`packages/@monomind/cli/src/mcp-tools/memory-tools.ts`)

| Category | Tools | Description |
|---|---|---|
| **System & Health** | `memory_health`, `memory_controllers` | Subsystem status, table counts, controller listings |
| **Pattern & Learning** | `memory_pattern-store`, `memory_pattern-search`, `memory_feedback`, `memory_consolidate` | Stores and searches routing patterns, EWMA feedback updates, EWC consolidation |
| **Knowledge Graph** | `memory_causal-edge`, `memory_kg_ingest`, `memory_kg_search`, `memory_kg_rollback`, `memory_kg_consolidate`, `memory_kg_stats` | Triplet ingest, edge creation, neighborhood search, extraction rollback, distilled rule ingest |
| **Routing & Context** | `memory_route`, `memory_semantic-route`, `memory_context-synthesize` | Surface routing, embedding-based route selection, multi-surface context synthesis |
| **Sessions & Trees** | `memory_session-start`, `memory_session-end`, `memory_hierarchical-store`, `memory_hierarchical-recall`, `memory_batch` | Agent session tracking, tree-structured storage/recall, batch operations |

---

## 5. CLI Memory Commands

```bash
monomind memory init                             # initialize SQLite memory database (schema v3.0.0)
monomind memory store -k <key> -v <val>          # store entry (--namespace, --tags, --confidence)
monomind memory edit -k <key> -v <val>           # update memory entry
monomind memory retrieve -k <key>                # retrieve entry by key
monomind memory search "query"                   # execute RRF hybrid search (vector + BM25)
monomind memory list                             # list entries (--namespace, --limit)
monomind memory delete -k <key>                  # delete entry
monomind memory stats                            # view table counts and vector status
monomind memory export --format okf -o <dir>     # export to OKF Markdown bundle
monomind memory import --format okf -i <dir>     # import from OKF Markdown bundle
```

---

## 3. Monograph (Code Knowledge Graph)

**Engine package:** `packages/@monomind/monograph/` (published as `@monoes/monograph`, v1.5.6) — the lower-level parse/storage/query engine: tree-sitter across 14 grammars (15 recognized languages — the TypeScript grammar also parses JavaScript), `better-sqlite3` storage, `graphology` for graph algorithms.  
**MCP tool layer:** registration and gating for all 19+27 tools actually lives in the CLI package at `packages/@monomind/cli/src/mcp-tools/monograph-tools.ts`, **not** inside `packages/@monomind/monograph/` itself — the CLI wraps the engine and exposes it over MCP, same split pattern as the memory subsystem's `memory-bridge.ts`.  
**Database:** `.monomind/monograph.db` (SQLite)  
**Tools:** 19 MCP tools by default (`mcp__monomind__monograph_*`); 27 more advanced tools are exposed when `MONOGRAPH_MCP_ADVANCED=1` is set

### What It Is

A static analysis engine that builds a dependency graph of the entire codebase. Nodes = files/symbols, edges = imports/exports/calls. Enables blast-radius analysis, architectural hotspot detection, and semantic code search.

### Building the Graph

```bash
# Code-only (fast, recommended for most tasks)
monomind monograph build --code-only

# Full build with LLM semantic extraction
monomind monograph build --llm

# Incremental watch mode
monomind monograph watch
```

### MCP Tools Quick Reference

| Tool | When to use |
|---|---|
| `monograph_suggest` | **Start every task** — returns files + relationships for your task description |
| `monograph_query` | Primary lookup — BM25 keyword search returning file + line number |
| `monograph_god_nodes` | Find high-centrality internal files (architectural hotspots) |
| `monograph_impact` | **Before changing anything** — blast radius: all upstream/downstream dependents |
| `monograph_context` | 360° view of a file: who imports it, what it imports |
| `monograph_neighbors` | Direct inbound/outbound edges of a node |
| `monograph_dead_code` | Dead exported functions, orphan files, stale dist artifacts |
| `monograph_detect_changes` | Map current git diff to affected graph nodes + dependents |
| `monograph_health` | Index staleness: commits behind HEAD |
| `monograph_stats` | Node/edge counts |
| `monograph_build` | Trigger graph build |

**Staleness mechanics:** `monograph_health`/`monograph_staleness` compare the index's recorded `index_meta.last_commit_hash` against HEAD via `git rev-list --count`; once the index is more than `STALENESS_THRESHOLD` (3) commits behind, `monograph_suggest --checkStaleness` auto-triggers a background rebuild. Useful for debugging "why is monograph returning stale results" — check `monograph_health` first before assuming a bug.

**Advanced tools** (set `MONOGRAPH_MCP_ADVANCED=1` to expose over MCP): `monograph_cypher`, `monograph_shortest_path`, `monograph_community`, `monograph_surprises`, `monograph_shape_check`, `monograph_rename`, `monograph_tool_map`, `monograph_serve`, `monograph_visualize`, `monograph_snapshot`, `monograph_diff`, `monograph_report`, `monograph_export`, wiki/skill generation, and the multi-repo group tools.

### Additional Capabilities

- **Complexity metrics:** cyclomatic complexity, CRAP score, maintainability index per file
- **Clone detection:** near-duplicate code blocks
- **Health scoring:** A–F letter grade with badge export
- **CODEOWNERS:** GitHub/GitLab ownership analytics, bus factor
- **Coverage gaps:** untested exported functions
- **LSP server:** publishes diagnostics over Language Server Protocol
- **CI templates:** emits workflow YAML for GitHub Actions / CircleCI / GitLab CI
- **Export formats:** JSON, SVG, GraphML, Cypher, HTML, Markdown, SARIF, CodeClimate

---

## 4. Second Brain — Document Knowledge Base

Second Brain indexes your project's documents into a searchable knowledge base with its own knowledge graph. During `monomind init`, the directory scanner detects document files and auto-ingests them — chunked, hashed for dedup, and stored for retrieval.

**Files:** `.monomind/knowledge/` (chunks.jsonl, doc-metadata.jsonl) + `.monomind/memory/memory.db`
**Global brain:** `~/.monomind/global-brain` persists knowledge across projects.

### Supported Document Formats (22 extensions)

| Category | Extensions | Extractor |
|---|---|---|
| Microsoft Word | `.docx` `.doc` | mammoth (DOCX), textutil (DOC — macOS) |
| Microsoft Excel | `.xlsx` `.xls` | SheetJS — all sheets extracted as tab-separated text |
| Microsoft PowerPoint | `.pptx` `.ppt` | ZIP+XML slide extraction (PPTX), textutil (PPT — macOS) |
| Google Docs / Sheets / Slides | `.docx` `.xlsx` `.pptx` | Google exports as Office formats — same extractors |
| OpenDocument | `.odt` `.ods` `.odp` | ZIP+XML / SheetJS (ODS) |
| PDF | `.pdf` | pdf-parse |
| Plain text | `.md` `.txt` `.rst` `.tex` `.csv` `.tsv` | Direct UTF-8 read |
| Rich Text | `.rtf` | Built-in RTF parser (no dependency) |
| eBook | `.epub` | ZIP+XHTML extraction |
| Apple Pages | `.pages` | textutil (macOS) |

### Second Brain KG vs Monograph

Monomind has **two knowledge graphs** that serve different purposes:

|  | Monograph (Code KG) | Second Brain KG (Document KG) |
|---|---|---|
| **What it indexes** | Source code — functions, classes, imports, dependencies | Documents — PDFs, Office files, Markdown, specs, policies |
| **Parser** | tree-sitter (static analysis, 14 language grammars) | Text extraction + chunking (format-specific parsers) |
| **Storage** | `.monomind/monograph.db` (nodes + edges) | `.monomind/knowledge/` + `.monomind/memory/memory.db` |
| **Query tools** | `monograph_query`, `monograph_suggest`, `monograph_impact` | `knowledge_search`, `memory_kg_search`, `monomind doc search` |
| **Entities** | Files, functions, classes, methods, variables | Concepts, decisions, people, rules, relationships |
| **Best for** | "What depends on X?", blast radius, dead code | "What was decided about auth?", compliance, design specs |

Use `memory_kg_ingest` to extract entities and relationships from documents into the Second Brain KG. Use `memory_kg_search` to query them. Monograph handles code; Second Brain KG handles everything else.

### Pipeline

1. **SCAN** — Directory scanner classifies files by extension (22 formats). If enough match, the "documents" capability activates.
2. **EXTRACT** — Format-specific text extraction: mammoth (DOCX), xlsx (spreadsheets), pdf-parse (PDF), ZIP+XML (PPTX/ODT/ODP/EPUB), built-in RTF parser, textutil (legacy DOC/PPT/Pages on macOS), or direct read (plain text/CSV).
3. **CHUNK** — Each document is chunked into 3200-char segments with 400-char overlap, respecting paragraph boundaries.
4. **INDEX** — SHA-256 content hashing for dedup. Chunks stored under `knowledge:<scope>` namespace. Metadata logged to `doc-metadata.jsonl`.
5. **QUERY** — Search via `knowledge_search` MCP tool or `monomind doc search` CLI.

### CLI

```bash
monomind doc ingest <path>    # Index documents from file or directory
monomind doc search -q "q"    # Search indexed documents
monomind doc list             # List indexed documents with chunk counts
monomind doc export           # Export as OKF bundle
```

### OKF — Open Knowledge Format

Portable interchange format for knowledge bases. Each document becomes a Markdown file with YAML frontmatter plus an `index.md` linking them all. Use it to move knowledge between projects or back up your Second Brain.

```bash
monomind doc export -o ./bundle -s shared    # Export
monomind doc ingest ./bundle -s shared       # Import
/mastermind:okf-export -o ./bundle           # Slash command
/mastermind:okf-import ./bundle              # Slash command
```

---

## 5. Cross-Session Persistence

Cross-session memory capture is handled by the mechanisms already described above — the pattern store / episodic recall in section 2, and the Memory Palace in section 1 — not by a separate `AutoMemoryBridge` class. That class has been removed from source entirely (no file, no export); the only remaining trace is two dead-stub log lines in `helpers-generator.ts` ("Auto memory import/sync skipped — AutoMemoryBridge removed"). Don't reference `AutoMemoryBridge` as a live component.

All memory persists across sessions in `.monomind/`:

```
.monomind/
├── palace/
│   ├── identity.md          ← L0: static project identity (edit manually)
│   ├── drawers.jsonl        ← L1-L3: scored verbatim chunks
│   ├── closets.jsonl        ← topic index
│   └── kg.json              ← temporal knowledge graph triples
├── data/
│   ├── auto-memory-store.json  ← intelligence patterns
│   ├── ranked-context.json     ← pre-computed context rankings
│   └── pending-insights.jsonl  ← unsaved edit events (cleared on consolidate)
├── episodic/
│   └── episodes.jsonl       ← episodic memories, keyword-matched at prompt time
├── knowledge/
│   ├── doc-metadata.jsonl   ← Second Brain: indexed document metadata
│   └── chunks.jsonl         ← Second Brain: document text chunks
├── memory/
│   └── memory.db            ← Second Brain: SQLite store (embeddings, KG entities)
└── monograph.db             ← code knowledge graph
```

---

## 6. Learning Pipeline

The lean build records trajectories and outcomes rather than training a neural model.
During `session-end` and `consolidate`:

- **Trajectory + outcome logging** — steps and trajectories are recorded (`intelligence.ts`); command and route outcomes are tracked (`command-outcomes.ts`, `route-outcomes.ts`)
- **Consolidation** — dedup, detect contradictions, prune old patterns from `patterns.json`

Consolidation runs via the `learning` and `patterns` background workers in `@monoes/hooks` (30-minute and 15-minute intervals) and at session end.

---

## 7. Troubleshooting

### `memory store` fails with `table memory_entries has no column named embedding`

This is an **environment issue, not a code bug** — and for current installs it is already fixed upstream.

**Root cause (historical):** the canonical backend (`@monoes/memory`'s `SQLiteBackend`) prefers `better-sqlite3` (native). `better-sqlite3` **v11**'s native binding had no prebuild for bleeding-edge Node majors (e.g. **Node 26**) and could not compile against their V8 API, so the backend fell back to **sql.js (WASM)** — where `store` fails against the canonical schema. (The CLI's legacy inline-embedding SQL is the *fallback-for-when-the-bridge-is-down* path; it is not the cause.)

**Fix (current):** upgrade `@monoes/memory` to **1.0.14+**, which makes `better-sqlite3` **v12** a mandatory dependency. v12 ships prebuilt bindings for Node 22, 24, and 26 on darwin/linux/win (x64 + arm64, glibc + musl), so the native backend loads on current Node with no toolchain:

```bash
npm install @monoes/memory@latest   # or update monomind, which depends on it
monomind memory store -k smoke -v "test"   # succeeds; SQLiteBackend active
```

If you are pinned to an old `@monoes/memory` (<1.0.14), the workaround is Node 22 (LTS) + `pnpm rebuild better-sqlite3`. Confirm the active backend with `monomind doctor` — it should report the native SQLite path, not sql.js.

### `Vector: No` on stored entries

Embeddings are generated by a local model (~90MB) that downloads once on first use. If it isn't downloaded, entries store fine and are **keyword-searchable**, but have no vector (`Vector: No`). Warm it up while online:

```bash
monomind doc search -q "warmup"   # one-time ~90MB download, cached locally forever
```
