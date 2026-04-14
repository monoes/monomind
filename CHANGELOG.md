# Changelog

All notable changes to Monobrain are documented here.

---

## [1.4.0] — 2026-04-14

### Added

#### Memory Palace Integration
- **`memory-palace.cjs`** — new CJS helper implementing a MemPalace-inspired cross-session memory system with zero native dependencies
  - **Wing → Room → Hall** spatial namespace hierarchy
  - **Verbatim storage** — 800-char chunks with 100-char overlap; no summarization, no information loss
  - **Okapi BM25 retrieval** (k₁=1.5, b=0.75) across all stored drawers
  - **Closet-topic boost** — regex-extracted topic terms (headers, action phrases, proper nouns, quoted passages) boost BM25 scores by +0.5 per matching term during search
  - **Score-based L1 promotion** — each retrieval via `search()` or `recall()` increments a drawer's score; top-scored drawers surface at session start
  - **Temporal knowledge graph** — facts stored as `(subject, predicate, object, valid_from, valid_to)` triples in `kg.json`; supports point-in-time and timeline queries
  - **4-layer memory stack**: L0 identity, L1 essential story, L2 on-demand namespace recall, L3 deep BM25 search
- **`identity.md`** seed file at `.monobrain/palace/identity.md` — project context injected at every session start as L0 identity
- **`features/mempalace.md`** — full technical reference for the integrated memory palace feature

#### Hook Wiring
- **`session-restore` hook** now calls `palace.wakeUp(CWD)` — injects `[MEMORY_PALACE_L0]` identity and `[MEMORY_PALACE_L1]` essential story into every new session context
- **`post-task` hook** now calls `palace.storeVerbatim()` — files each task prompt as a verbatim drawer under `wing: tasks`, `room: <agentSlug>`
- **`session-end` hook** now calls `palace.storeVerbatim()` (archive marker) and `palace.kgAdd()` (temporal triple: `sessionId → ended_at → timestamp`)

#### Docs & References
- **README.md Acknowledgements** — added MemPalace reference with Wing/Room/Hall architecture, BM25 retrieval, score-based promotion, and temporal KG description

### Changed
- `hook-handler.cjs` — three new try/catch blocks wiring Memory Palace at session-restore, post-task, and session-end; all non-fatal (palace failure never blocks hooks)

### Technical Details

| Component | File | Size |
|-----------|------|------|
| Memory Palace core | `.claude/helpers/memory-palace.cjs` | 340 lines |
| Feature reference | `features/mempalace.md` | full technical doc |
| L0 identity seed | `.monobrain/palace/identity.md` | project context |
| Storage | `.monobrain/palace/{drawers,closets}.jsonl`, `kg.json` | append-only, gitignored |

Exports: `wakeUp`, `storeVerbatim`, `buildClosets`, `search`, `recall`, `bm25`, `kgAdd`, `kgQuery`, `kgTimeline`

---

## [1.3.1] — prior release

- Previous release. See git history for details.
