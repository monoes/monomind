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

**Schema Architecture**: Embedded SQLite database operating in **WAL mode** (`PRAGMA journal_mode = WAL`); the database file itself is created `chmod 0600` (owner read/write only). Supports standalone `@monoes/memory` core schema (schema version **3** — `SCHEMA_VERSION` constant, [`sql-schema.ts:L28`](packages/@monomind/memory/src/sql-schema.ts#L28), applied via `PRAGMA user_version`; previously documented here as "v2", now stale) — **5 tables**: `memory_entries`, `memory_embeddings`, `memory_entry_tags`, `agent_reads`, plus the FTS5 full-text virtual table `memory_entries_fts` ([`sql-schema.ts:L187-218`](packages/@monomind/memory/src/sql-schema.ts#L187-L218), added for issue #66) — and CLI project memory schema (v3.0.0, 9 tables at [`memory-schema.ts:15`](packages/@monomind/cli/src/memory/memory-schema.ts#L15): `memory_entries`, `patterns`, `pattern_history`, `trajectories`, `trajectory_steps`, `migration_state`, `sessions`, `vector_indexes`, `metadata`).

### Key Memory Stores

| Store Type | Namespace / Location | Implementation File | Feature Highlights |
|---|---|---|---|
| **Episodic & Semantic** | Namespace `default` (or custom) in `memory_entries` | [`memory-crud.ts:28-115`](packages/@monomind/cli/src/memory/memory-crud.ts#L28-L115), [`memory-bridge.ts:167-270`](packages/@monomind/cli/src/memory/memory-bridge.ts#L167-L270) | Temporal decay (`decay_rate = 0.01`), access frequency tracking, confidence score, importance weighting (`0.5` default). |
| **Pattern Store** | `patterns` table & `.swarm/sona-patterns.json` | [`sona-optimizer.ts:43-58`](packages/@monomind/cli/src/memory/sona-optimizer.ts#L43-L58), [`memory-schema.ts:61-76`](packages/@monomind/cli/src/memory/memory-schema.ts#L61-L76) | Learned task routing patterns based on keyword extraction, success/failure counts, and EWC-inspired importance weighting (squared-embedding proxy — not Fisher information) (`.swarm/ewc-fisher.json`). |
| **Second Brain document index** | `memory_entries` (`doc:<hash>:<chunk>`) in namespace `knowledge:<scope>` | [`document-pipeline.ts:120-180`](packages/@monomind/cli/src/knowledge/document-pipeline.ts#L120-L180), [`bm25-index.ts:71-75`](packages/@monomind/cli/src/memory/bm25-index.ts#L71-L75) | Multi-format document ingestion, content-hash chunking, Okapi BM25 lexical indexing. Stores chunks and metadata only — no entity extraction. |
| **Memory knowledge graph** | `kg:nodes`, `kg:edges`, `rules` in `memory_entries` | [`memory-kg.ts:34-36`](packages/@monomind/cli/src/memory/memory-kg.ts#L34-L36), [`memory-kg.ts:70-84`](packages/@monomind/cli/src/memory/memory-kg.ts#L70-L84) | Cognee-style concept triplets. Nodes: `n:<normalized-name>`, Edges: `e:<src>\|<rel>\|<dst>`. Deterministic entity keys and rule deduplication threshold (`0.78`). Populated only by explicit ingestion — see [The two graphs](#the-two-graphs). |

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
│     ONNX + HNSW-first search                  Exact Tokenizer Parity        │
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
- **Model:** `Alibaba-NLP/gte-modernbert-base` (768 dimensions) ([`memory-bridge.ts:39-40`](packages/@monomind/cli/src/memory/memory-bridge.ts#L39-L40)).
- **Engine:** `@xenova/transformers` ONNX feature extraction (`embedding-operations.ts:84-100`).
- **HNSW-First:** When the optional `@monoes/memory` package is installed, `memory-read.ts` tries the pure-JS `HNSWIndex` *first* on every semantic search — it is not merely a fallback for when the native SQLite binding fails to load ([`memory-read.ts:107-118`](packages/@monomind/cli/src/memory/memory-read.ts#L107-L118)). Only when HNSW returns no results (e.g. the package isn't installed, so [`getHNSWIndex()`](packages/@monomind/cli/src/memory/hnsw-operations.ts#L142-L198) returns `null`) does the search fall through to brute-force SQLite.

### 2. Lexical Okapi BM25
- **Parameters:** `BM25_K1 = 1.2`, `BM25_B = 0.75` ([`bm25-index.ts:68-69`](packages/@monomind/cli/src/memory/bm25-index.ts#L68-L69)).
- **Tokenizer:** Shared `contentTokens` ([`text-tokens.ts:55-100`](packages/@monomind/cli/src/memory/text-tokens.ts#L55-L100)) ensuring exact evaluation harness parity.
- **Scaling Thresholds:** Live chunk warning at 50,000 chunks; index review threshold at 1,000,000 chunks ([`bm25-index.ts:58-65`](packages/@monomind/cli/src/memory/bm25-index.ts#L58-L65)).

### 3. Query Router & Surface Fusion
- **Surface Routing:** Evaluates rules across `chunks` (prior=0.5), `kg` (wt=2), `rules` (wt=2), `memory` (wt=2) ([`query-router.ts:71-92`](packages/@monomind/cli/src/memory/query-router.ts#L71-L92)).
- **Gates:** 20-character negation pre-match window skips negated query terms ([`query-router.ts:43`](packages/@monomind/cli/src/memory/query-router.ts#L43)). Top routing surface must score ≥ 2× runner-up or query broadcasts to all surfaces.
- **Telemetry:** Override telemetry is logged to `.monomind/metrics/route-overrides.json`.

---

## 4. Open Knowledge Format (OKF) & 20 MCP Tools

### OKF Transfer Engine
MonoMind supports export/import of memory entries and knowledge documents using the Open Knowledge Format (OKF):
- **Document OKF:** [`document-pipeline.ts:852-940`](packages/@monomind/cli/src/knowledge/document-pipeline.ts#L852-L940) exports/imports documents with standard YAML frontmatter headers and `index.md` manifest logs.
- **Memory OKF:** [`memory-transfer.ts:10-207`](packages/@monomind/cli/src/commands/memory-transfer.ts#L10-L207) transfers memory key-values across filesystem boundaries (`monomind memory export --format okf`).

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

**Engine package:** `packages/@monomind/monograph/` (published as `@monoes/monograph`, v1.5.6) — the lower-level parse/storage/query engine: tree-sitter grammars plus a regex fallback tier (see `packages/@monomind/monograph/README.md#supported-languages--parsers` for the authoritative language/grammar count), `better-sqlite3` storage, `graphology` for graph algorithms.  
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

## 4. Second Brain — Document Index

The Second Brain **document index** turns your project's documents into searchable excerpts. During `monomind init`, the directory scanner detects document files and auto-ingests them — extracted, chunked, hashed for dedup, and stored for retrieval.

Ingestion produces **chunks and document metadata only**. It does not extract entities or relationships, and it does not write to the memory knowledge graph: `document-pipeline.ts` never calls `kgIngest`. Getting a document's claims into the graph is a separate, explicit step — see [The two graphs](#the-two-graphs) below.

**Chunks:** `memory_entries` rows keyed `doc:<content-hash>:<chunk-index>` in namespace `knowledge:<scope>` (default scope `shared`), inside the project memory store ([`document-pipeline.ts:569-580`](packages/@monomind/cli/src/knowledge/document-pipeline.ts#L569-L580)). The store's on-disk location is **not** `.monomind/memory/` — see [Storage layout](#5-cross-session-persistence).
**Document metadata:** `<project>/.monomind/knowledge/doc-metadata.jsonl` ([`document-pipeline.ts:377-380`](packages/@monomind/cli/src/knowledge/document-pipeline.ts#L377-L380)).
**Global brain:** scope `global` routes to `~/.monomind/global-brain`, persisting documents across projects.

### The two graphs

The two graphs that matter operationally are the **Monograph code graph** and the **memory knowledge graph**. The Second Brain document index is not a third one — it holds chunks, not entities and edges. (A third, smaller graph-shaped store does exist: the Memory Palace's temporal triples in `.monomind/palace/kg.json`, described in [§1](#1-memory-palace). It is a separate helper-level store and is **not** synchronized with the memory knowledge graph — `memory_kg_*` never reads or writes it.)

|  | Monograph code graph | Memory knowledge graph |
|---|---|---|
| **What it holds** | Parsed repository structure — files, functions, classes, and their import/call/dependency edges. Monograph can also index repository documentation. | Entities, relations, and distilled rules that something asserted. Entries may well describe code elements — `heuristicExtract` types a node `CodeElement` when its name looks like code ([`memory-kg.ts:994`](packages/@monomind/cli/src/memory/memory-kg.ts#L994)). |
| **How it gets there** | `monomind monograph build` parses the repository | Explicit ingestion only: `memory_kg_ingest`, the post-task hook's causal edges ([`hooks-routing.ts:925`](packages/@monomind/cli/src/mcp-tools/hooks-routing.ts#L925)), and org runs via `org_learn` or its run-summary heuristic fallback ([`org-memory.ts:198`](packages/@monomind/cli/src/orgrt/org-memory.ts#L198), [`:266`](packages/@monomind/cli/src/orgrt/org-memory.ts#L266)) |
| **Producer** | tree-sitter grammars plus a regex fallback tier (see the monograph README for the grammar count) | Whatever the caller supplies: LLM-extracted triples, or `rawText` run through the built-in regex `heuristicExtract` |
| **Storage** | `.monomind/monograph.db` (SQLite, nodes + edges) | `kg:nodes`, `kg:edges`, `rules` namespaces in a memory store — the project store by default, the org store for org runs |
| **Query tools** | `monograph_query`, `monograph_suggest`, `monograph_impact` | `memory_kg_search`, `memory_kg_stats`; also fused into `knowledge_search` when the router selects the `kg` surface |
| **Rebuild / undo** | Rebuild from source at any time — the repository is the truth | No rebuild: claims accumulate. `memory_kg_rollback` withdraws one `originRef` from every element's origin list and deletes an element only once no origin remains ([`memory-kg.ts:744`](packages/@monomind/cli/src/memory/memory-kg.ts#L744)) — which is why every ingest requires an `originRef` |
| **Best for** | "What depends on X?", blast radius, dead code | "What did we conclude about auth?", durable rules and decisions carried across sessions and runs |

The boundary is **how knowledge is obtained, validated, owned, and queried** — not "code files versus other files". Monograph derives facts from source it can re-parse; the memory knowledge graph accumulates remembered claims whose only guarantee is their provenance ref. Treat graph triplets as *asserted*, not verified.

### Two flows: indexing and extraction

Documents can feed either surface, but they are separate operations and only the first one happens automatically:

```
                    ┌─ ingest (automatic) ─▶ chunks + doc-metadata ─▶ knowledge search
                    │                        namespace knowledge:<scope>   (excerpt surface)
   Document ────────┤
                    │
                    └─ extraction (separate, explicit step)
                             you or an agent supply nodes/edges/rules
                             (or rawText for regex extraction)
                                      │
                                      ▼
                             memory_kg_ingest ──▶ memory knowledge graph
                                                  kg:nodes / kg:edges / rules
```

Consequences worth knowing:

- **Ingesting a document adds nothing to the graph.** `monomind doc ingest` and the init auto-ingest write chunks; entity counts stay at zero.
- **The graph fills up in projects with no documents at all.** Post-task hooks and org runs write to it regardless of whether Second Brain is active.
- **`memory_kg_ingest` has no document reader.** To move a document's claims into the graph, read or search the document first and pass `nodes`/`edges`/`rules`, or pass the text as `rawText` — which falls back to regex `heuristicExtract`, noticeably lower quality than LLM extraction.
- **`knowledge_search` is a retrieval interface, not a store.** Its rule-based router picks among the `chunks`, `kg`, `rules`, and `memory` surfaces and fuses them by reciprocal rank ([`knowledge-tools.ts:152-168`](packages/@monomind/cli/src/mcp-tools/knowledge-tools.ts#L152-L168)). Passing `store: 'global'` searches the personal cross-project brain's documents only — the KG, rules, and pattern surfaces are project-scoped and are deliberately excluded. Ask for `surfaces` explicitly when you need a specific one.
- **The router can send code questions to the wrong graph.** Phrases like "what calls X" or "what imports X" classify as the `kg` surface — the *memory* graph, not Monograph ([`query-router.ts:37-43`](packages/@monomind/cli/src/memory/query-router.ts#L37-L43)). For real code dependencies call `monograph_query` / `monograph_impact` directly.

### Supported Document Formats (22 extensions)

| Category | Extensions | Extractor |
|---|---|---|
| Microsoft Word | `.docx` `.doc` | mammoth (DOCX, cross-platform), textutil (`.doc` — **macOS only**; returns empty text on Linux/Windows) |
| Microsoft Excel | `.xlsx` `.xls` | SheetJS/`xlsx` (cross-platform) — all sheets extracted as tab-separated text |
| Microsoft PowerPoint | `.pptx` `.ppt` | ZIP+XML slide extraction via `fflate` (PPTX, cross-platform), textutil (`.ppt` — **macOS only**; returns empty text on Linux/Windows) |
| Google Docs / Sheets / Slides | `.docx` `.xlsx` `.pptx` | Google exports as Office formats — same extractors |
| OpenDocument | `.odt` `.ods` `.odp` | ZIP+XML via `fflate` / SheetJS (ODS) — cross-platform |
| PDF | `.pdf` | @firecrawl/pdf-inspector (Rust, markdown + tables) |
| Plain text | `.md` `.txt` `.rst` `.tex` `.csv` `.tsv` | Direct UTF-8 read |
| Rich Text | `.rtf` | Built-in RTF parser (no dependency) |
| eBook | `.epub` | ZIP+XHTML extraction via `fflate` (cross-platform) |
| Apple Pages | `.pages` | textutil — **macOS only**; returns empty text on Linux/Windows |

Legacy binary `.doc`/`.ppt` and `.pages` shell out to macOS's `textutil`, which has no cross-platform equivalent — on Linux/Windows those three extensions index with empty content rather than failing. `monomind doctor -c documents` reports this per-extractor, including whether `textutil` is actually available on the current machine.

### Pipeline

1. **SCAN** — Directory scanner classifies files by extension (22 formats). If enough match, the "documents" capability activates.
2. **EXTRACT** — Format-specific text extraction: mammoth (DOCX), xlsx (spreadsheets), @firecrawl/pdf-inspector (PDF — native Rust, markdown with tables), ZIP+XML via `fflate` (PPTX/ODT/ODP/EPUB — pure JS, no system dependency), built-in RTF parser, textutil (legacy DOC/PPT/Pages — **macOS only**), or direct read (plain text/CSV).
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

Memory does **not** all live in the project's `.monomind/`, despite what earlier revisions of this page said. Flat files, the Monograph code graph, and the org runtime's own store live in the project; the SQLite store that backs the *project's* document index, memory knowledge graph, rules, and patterns lives under your home directory, keyed by a hash of the project path. Which store a given operation touches depends on the `dbPath` it was handed.

### In the project

```
<project>/.monomind/
├── palace/
│   ├── identity.md          ← L0: static project identity (edit manually)
│   ├── drawers.jsonl        ← L1-L3: scored verbatim chunks
│   ├── closets.jsonl        ← topic index
│   └── kg.json              ← Memory Palace temporal triples (its own store —
│                              not synchronized with the memory knowledge graph)
├── data/
│   ├── auto-memory-store.json  ← intelligence patterns
│   ├── ranked-context.json     ← pre-computed context rankings
│   └── pending-insights.jsonl  ← unsaved edit events (cleared on consolidate)
├── episodic/
│   └── episodes.jsonl       ← episodic memories, keyword-matched at prompt time
├── knowledge/
│   ├── doc-metadata.jsonl   ← Second Brain: indexed-document metadata log
│   └── chunks.jsonl         ← NOT the document store: a single monograph
│                              god-node summary chunk written per working
│                              directory by the session-restore hook
├── org-memory/
│   └── memory.db            ← org runtime memory store, shared by every org
│                              rooted here (`orgMemoryDbPath`)
└── monograph.db             ← Monograph code graph
```

### In your home directory

```
~/.monomind/
├── projects/<dir-name>-<sha256-prefix>/
│   ├── lancedb/
│   │   └── memory.db        ← the project memory store: document chunks
│   │                          (knowledge:<scope>), kg:nodes, kg:edges,
│   │                          rules, patterns, embeddings
│   └── origin.json          ← which project path this directory belongs to
└── global-brain/
    └── memory.db            ← personal cross-project brain (scope `global`)
```

**Why `lancedb`?** LanceDB was replaced by SQLite in July 2026. The directory keeps its old name purely for back-compat path resolution — it holds a `better-sqlite3` database (or a `sql.js` WASM one if the native binding will not load), never LanceDB data. Renaming it would strand existing installs, so the name stays and this note explains it ([`memory-bridge.ts:4-7`](packages/@monomind/cli/src/memory/memory-bridge.ts#L4-L7), [`:178`](packages/@monomind/cli/src/memory/memory-bridge.ts#L178)).

**Why a home directory at all?** The store is namespaced by a hash of the resolved project root ([`memory-bridge.ts:142-152`](packages/@monomind/cli/src/memory/memory-bridge.ts#L142-L152)) so it always lands on the home volume — exFAT/SMB project volumes broke the original engine's atomic renames. Run `monomind memory stats` if you need the resolved path for the current project rather than deriving it by hand — it reports the real on-disk location ([`memory-admin.ts:229-243`](packages/@monomind/cli/src/commands/memory-admin.ts#L229-L243)). There is no single command that maps every subsystem to its store yet.

**Path overrides.** A caller may pass a custom store path, but a traversal guard accepts it only if it resolves inside the project root, that project's home data directory, or the global brain — anything else silently falls back to the project default ([`memory-bridge.ts:177-193`](packages/@monomind/cli/src/memory/memory-bridge.ts#L177-L193)). This is why org memory lives at `<project>/.monomind/org-memory` rather than somewhere outside the tree.

**Scoping caveat.** The memory knowledge graph's `kg:nodes`, `kg:edges`, and `rules` namespaces are fixed strings within whichever store is addressed. Org identity is *not* part of node identity or namespace, so every org rooted at the same project shares one graph in `org-memory`. Do not rely on an org name passed to a KG command as an ownership boundary.

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
