# Universal Second Brain — Design Spec

**Date:** 2026-07-03
**Status:** Approved
**Author:** morteza + claude

## Problem

Monomind assumes every target directory is a code project — git repo, package.json, TypeScript. This blocks installation in document folders, photo libraries, media archives, and mixed-content directories. Users want monomind as a second brain for *all* their files.

## Decision

**Approach B: Capability Detection.** Instead of rigid profiles, monomind detects what's in a directory and activates independent capability modules. A documents folder gets document search. A code project gets the full dev toolchain. A mixed folder gets both. Capabilities activate and deactivate as directory contents evolve — no re-init needed.

## Design

### 1. Directory Intelligence — Auto-Detection Engine

`monomind init` runs a **directory scanner** (breadth-first, depth-limited to 3 levels) and produces a **directory fingerprint** saved to `.monomind/fingerprint.json`:

```json
{
  "totalFiles": 12847,
  "git": false,
  "scannedAt": "2026-07-03T10:00:00Z",
  "capabilities": {
    "code":      { "confidence": 0.12, "files": 34,   "signals": ["some .js files"] },
    "documents": { "confidence": 0.73, "files": 4200, "signals": [".pdf", ".docx", ".md"] },
    "media":     { "confidence": 0.61, "files": 8100, "signals": [".jpg", ".png", "EXIF detected"] },
    "data":      { "confidence": 0.05, "files": 13,   "signals": [".csv"] }
  }
}
```

**Detection rules** (heuristics, no ML):

| Capability | Signals |
|---|---|
| code | `package.json`, `Cargo.toml`, `go.mod`, `.git`, `*.py`, `*.ts`, `*.rs`, `*.java` |
| documents | `.pdf`, `.docx`, `.md`, `.txt`, `.rtf`, `.pages`, `.odt` |
| media | `.jpg`, `.png`, `.mp4`, `.mov`, `.heic`, `.raw`, `.mp3`, `.wav` |
| data | `.csv`, `.json`, `.sqlite`, `.parquet`, `.xlsx` |

Every capability with confidence > 0.1 activates. Fingerprint is re-scanned on demand via `monomind scan`.

**No git required.** If git exists, monomind uses it for change detection. If not, it uses `fs.watch` (chokidar) for file-change events.

### 2. Capability Modules

Each capability implements the same interface:

```typescript
interface CapabilityModule {
  name: string;
  detect(scan: DirectoryScan): number;        // confidence 0-1
  activate(config: MonomindConfig): void;
  index(files: FileEntry[]): IndexResult;     // T0+T1 indexing
  enrich?(files: FileEntry[]): EnrichResult;  // T2 AI enrichment (optional)
  search?(query: string): SearchResult[];     // type-specific ranking
  healthChecks?(): HealthCheck[];             // doctor checks
}
```

#### Core (always active)

| Module | Purpose | Status |
|---|---|---|
| `core/memory` | Vector store (SQLite + HNSW) | Exists, no changes |
| `core/search` | Hybrid BM25 + vector search | Exists in monograph |
| `core/watcher` | File change detection — git when available, fs.watch fallback | **New** |

#### Content Capabilities (activated by detection)

| Module | Activates when | What it does |
|---|---|---|
| `cap/code` | git, package.json, source files | Full current monomind: monograph, TypeScript, git hooks, agents. Today's behavior, unchanged. |
| `cap/documents` | PDFs, docx, markdown above threshold | Text extraction, semantic search, entity/topic extraction. |
| `cap/media` | Images, video, audio above threshold | EXIF/metadata extraction (T0), CLIP descriptions + Whisper transcription (T2 background). |
| `cap/data` | CSVs, JSON, spreadsheets | Schema detection, column summaries, row counts. Searchable by column names and content. |

#### Cross-cutting (activated when 2+ content capabilities active)

| Module | What it does |
|---|---|
| `cap/graph` | Knowledge graph across all content types. Documents referencing same entities, photos from same date as a document, code that processes a data file. Uses monograph engine with broader node types. |
| `cap/timeline` | Extracts dates from all content (file dates, EXIF, document mentions, git commits) and builds a temporal index. |

### 3. Progressive Enrichment Pipeline

Content goes from files to searchable knowledge in three tiers without blocking the user:

| Tier | When | What | Speed |
|---|---|---|---|
| **T0: Metadata** | During init | File names, paths, sizes, dates, EXIF, folder structure, basic classification | ~10K files/sec |
| **T1: Content extraction** | Background, immediately after init | Full-text from PDFs/docx, image dimensions, audio duration, BM25 index | ~500 files/sec |
| **T2: AI enrichment** | Background, ongoing | Vector embeddings, CLIP descriptions, Whisper transcription, entity extraction, topic clustering, graph inference | ~10-50 files/sec |

**Key contract:** Search works after T0. Results improve as T1 and T2 complete.

```
monomind init
  ├─ scan → fingerprint.json (instant)
  ├─ activate capabilities (instant)
  ├─ T0 metadata pass (seconds)
  ├─ "Ready. Search works now." ← user gets control back
  └─ daemon starts T1, then T2
```

**State tracking** in `.monomind/enrichment.json`:

```json
{
  "files/report-q4.pdf": { "t0": "done", "t1": "done", "t2": "pending" },
  "photos/trip/IMG_4021.heic": { "t0": "done", "t1": "skipped", "t2": "queued" }
}
```

**Resource governance:**
- One worker thread by default, configurable
- CPU/memory limits to avoid competing with user work
- `monomind enrich --pause` / `--resume`
- Pauses on battery power by default (macOS/Linux)
- T2 is optional — if no local models available, stays at T1

### 4. Adapted CLI UX

#### `monomind init` — adapts messaging to detected content

In a code project (identical to today):
```
$ cd ~/my-app && monomind init
# ... existing behavior unchanged ...
```

In a documents folder:
```
$ cd ~/Documents && monomind init

Scanning directory... 4,200 documents, 312 images, 0 code files detected.

Activating capabilities:
  ✓ core/memory     — vector search
  ✓ core/search     — hybrid BM25 + semantic
  ✓ core/watcher    — file change detection
  ✓ cap/documents   — PDF, docx, markdown extraction
  ✓ cap/media       — EXIF metadata, image cataloging
  ✓ cap/graph       — cross-content knowledge graph
  ✓ cap/timeline    — temporal index

Indexing metadata... 4,512 files indexed in 0.8s
Background enrichment started.

Ready. Try: monomind search "quarterly report"
```

No swarms, agents, hooks, TypeScript, or git mentioned unless relevant.

#### `doctor` — capability-scoped checks

| Check | Runs when |
|---|---|
| Node.js, npm, disk space | Always |
| Git, TypeScript, build tools | `cap/code` active |
| Memory DB, search index | Always (core) |
| Enrichment progress | Any content capability active |
| Local models (CLIP, Whisper) | `cap/media` active + T2 |
| MCP, daemon, API keys | `cap/code` active or user explicitly enabled |

#### `monomind search` — unified across types

```
$ monomind search "contract renewal March"

Documents:
  📄 legal/vendor-contract-2025.pdf (p.12) — "renewal clause..."
  📄 notes/meeting-march-7.md — "discussed contract renewal..."

Photos:
  📷 scans/signed-contract-p1.jpg — scanned document, 2025-03-15

Timeline:
  📅 2025-03-07: meeting-march-7.md created
  📅 2025-03-15: vendor-contract-2025.pdf modified
```

### 5. Architecture

```
CLI Layer (commands adapt per fingerprint)
         │
         ▼
Capability Manager
  loads fingerprint → activates modules
  registry: Map<string, CapabilityModule>
         │
    ┌────┴────┬────────┬────────┬────────┬────────┐
    ▼         ▼        ▼        ▼        ▼        ▼
  core/     core/    core/    cap/     cap/     cap/
  memory    search   watcher  code     docs     media ...
    │         │        │        │        │        │
    └─────────┴────────┴────────┴────────┴────────┘
         │
         ▼
Shared Storage (.monomind/)
  ├── fingerprint.json
  ├── capabilities.json
  ├── enrichment.json
  ├── memory.db
  ├── search.idx
  └── graph.db
```

### 6. What Changes vs. What Stays

| Component | Change |
|---|---|
| `@monomind/memory` | None. Already content-agnostic. |
| `@monomind/monograph` | Minor. Unknowns → UNKNOWN not CODE. Add document/media node types. |
| `@monomind/hooks` | Moderate. Extract git dependency into core/watcher. Hooks fire on file-change events regardless of source. |
| `@monomind/cli` init | Moderate. Add scanner, fingerprint, capability manager, adapt messaging. |
| `@monomind/cli` doctor | Moderate. Scope checks to active capabilities. |
| New: `cap/documents` | New module. PDF/docx text extraction, entity extraction. |
| New: `cap/media` | New module. EXIF, CLIP/Whisper integration. |
| New: `cap/data` | New module. Schema detection for structured files. |
| New: `cap/timeline` | New module. Date extraction, temporal index. |
| New: `core/watcher` | New module. fs.watch abstraction with git fast path. |

### 7. Implementation Phases

Each phase ships a usable increment independently.

| Phase | What ships | Effort |
|---|---|---|
| **P0: Foundation** | Scanner, fingerprint, capability manager, `core/watcher`, adapted init/doctor messaging. Zero breakage for code-project users. | 3-5 days |
| **P1: Documents** | `cap/documents`. PDF/docx/markdown text extraction (T0+T1). Semantic search. Makes init useful in ~/Documents. | 3-4 days |
| **P2: Media** | `cap/media`. EXIF extraction (T0). Optional CLIP descriptions (T2). Photo search. | 3-4 days |
| **P3: Cross-content** | `cap/graph` + `cap/timeline`. Cross-type relationships, temporal index. The "second brain" experience. | 4-5 days |
| **P4: Data + polish** | `cap/data`. `monomind enrich` CLI. Pause/resume, battery awareness, progress. | 2-3 days |
| **P5: Remote** | `monomind init ssh://...`. Remote scanning, local indexing. Scoped separately. | Future |

### 8. Testing Strategy

| Layer | Approach |
|---|---|
| Scanner/fingerprint | Unit tests with fixture directories (code-only, docs-only, photos-only, mixed). Assert correct detection and confidence. |
| Capability modules | Integration tests per module: real files in, verify index and search output. ~20 fixture files each. |
| Core/watcher | Both git and fs.watch paths. Verify change events trigger re-indexing. |
| Init flow | E2E: run init in temp dir with known contents, assert fingerprint + capabilities.json + messaging. |
| Doctor | Assert only capability-relevant checks run. Documents-only install: 0 warnings about git/TypeScript. |
| Enrichment | Tier progression: T0 sync, T1 background, T2 optional. Verify enrichment.json state. |
| Regression | `monomind init` in this repo produces identical behavior to today (minus richer output text). |

### 9. Out of Scope

- Cloud storage sync conflict handling (v2)
- Plugin system / third-party capabilities (only if demand)
- Mobile/tablet access
- Remote SSH directories (P5, scoped separately)

### 10. Risk Mitigation

**Primary risk:** Breaking existing code-project users.
**Mitigation:** `cap/code` IS today's monomind. When scanner detects a code project, it activates `cap/code` which enables every existing feature unchanged. The capability manager wraps what exists — additive, not replacement.
