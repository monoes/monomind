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
## 2. Pattern Store & Episodic Recall (the hot path)

**Files:** `.monomind/data/auto-memory-store.json`, `patterns.json`, `.monomind/episodic/episodes.jsonl`  
**Honest framing:** the memory that actually runs on every prompt is plain JSON with keyword matching. There is no vector database or HNSW index in the hot path.

### How It Works

- **Pattern store** — `intelligence.init()` loads patterns from `patterns.json` / `auto-memory-store.json` at session start and deduplicates them. Patterns are synthesized from command and route outcomes during consolidation.
- **Prompt-time recall** — on every `UserPromptSubmit`, the route hook scores stored entries against the prompt (Jaccard/keyword matching) and injects the top matches as an `[INTELLIGENCE]` context panel.
- **Episodic recall** — recent episodes from `.monomind/episodic/episodes.jsonl` are keyword-matched against the prompt (last ~200 episodes) and injected at prompt time, with per-conversation deduplication.
- **Consolidation** — at session end, `intelligence.consolidate()` dedupes, detects contradictions, and prunes old patterns.

### Vector Search Backend

**Path note:** the live bridge code — `memory-bridge.ts` and `hnsw-operations.ts` — lives in `packages/@monomind/cli/src/memory/`, inside the CLI package, **not** in `packages/@monomind/memory/` (`@monoes/memory`). `@monoes/memory` is a separate, lower-level backend library (SQLite/JSON pattern-store implementations) that the CLI's bridge dynamically imports at runtime; it isn't itself the dispatch path.

The default and only supported vector engine is **local SQLite with embedded vectors** (`better-sqlite3`, with a `sql.js` WASM fallback) plus local HF embeddings — model `Xenova/all-MiniLM-L6-v2`, 384 dimensions, runs fully locally with no API calls. This backs CLI `memory store`/`memory search`, the MCP memory tools, and the Second Brain — it is **not** the same path as the prompt-time recall described above, which stays plain JSON/keyword.

**LanceDB timeline:** LanceDB was the live engine until commit `b670e65c` (2026-07-18), which swapped the CLI bridge to local SQLite (released as v2.3.1). `@monoes/memory` (`packages/@monomind/memory/src/lancedb-backend.ts`) still ships a vestigial `LanceDBBackend` — never called by the live bridge path, peer deps (`@lancedb/lancedb`, `apache-arrow`, ~600MB) no longer installed. Don't rely on `LanceDBBackend` — it will not run out of the box.

A pure-TypeScript HNSW index (`hnsw-operations.ts`, in the CLI package alongside `memory-bridge.ts`) is **not dead code** — it's reachable via `monomind memory search --build-hnsw` — but it is **not on the default search path**; plain `memory search` uses the SQLite backend directly. Treat HNSW as "not automatic," not "unused."

### MCP Tools (use inside Claude Code sessions)

```
mcp__monomind__memory_store      — store a memory entry
mcp__monomind__memory_search     — keyword/BM25 search
mcp__monomind__memory_retrieve   — get by id or key
mcp__monomind__memory_delete     — delete entry
mcp__monomind__memory_list       — list with filters
```

### CLI Commands

```bash
monomind memory init             # initialize memory store
monomind memory store            # store entry (--key, --value, --namespace, --tags)
monomind memory search "query"   # search stored entries
monomind memory retrieve         # get entry by key (--key, --namespace)
monomind memory list             # list entries (--namespace, --limit)
monomind memory stats            # usage statistics
monomind memory delete           # delete an entry
monomind memory export           # export to JSON
monomind memory import           # import from JSON
```

---

## 3. Monograph (Code Knowledge Graph)

**Engine package:** `packages/@monomind/monograph/` (published as `@monoes/monograph`, v1.4.0) — the lower-level parse/storage/query engine: tree-sitter across 14 grammars (15 recognized languages — the TypeScript grammar also parses JavaScript), `better-sqlite3` storage, `graphology` for graph algorithms.  
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

## 4. Cross-Session Persistence

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
└── monograph.db             ← code knowledge graph
```

---

## 5. Learning Pipeline

The lean build records trajectories and outcomes rather than training a neural model.
During `session-end` and `consolidate`:

- **Trajectory + outcome logging** — steps and trajectories are recorded (`intelligence.ts`); command and route outcomes are tracked (`command-outcomes.ts`, `route-outcomes.ts`)
- **Consolidation** — dedup, detect contradictions, prune old patterns from `patterns.json`

Consolidation runs via the `learning` and `patterns` background workers in `@monoes/hooks` (30-minute and 15-minute intervals) and at session end.

> The neural judge/distill loop (LLM-as-judge, strategy distillation, EWC++ consolidation) lives on the `monoes-full-loop` branch.
