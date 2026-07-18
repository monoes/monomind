# Changelog

All notable changes to Monomind (`monomind` umbrella + `@monoes/monomindcli`).

## [2.5.0] — 2026-07-18

### Orgs can read your Second Brain
- Org agents get a `knowledge_search` tool: merged semantic search over the project's documents **and** your personal global brain, with the same project-first ranking as every other surface. Role briefings instruct agents to ground work in your actual documents; every lookup is a bus event visible in `org logs` / `org report`.

### Live document ingestion
- The dashboard server (long-lived, warm embedding model) watches the project and ingests changed `md/txt/pdf/docx` in-process within ~5 seconds of a save — no session restart needed. Platforms without recursive watch fall back silently to the session-start reindex.

### Global-brain polish
- Dashboard Second Brain search: project/global/all scope selector, `global` badges, real source-file labels.
- README + the generated per-project CLAUDE.md now teach the cross-project brain (auto-routing, `--store`, `--global`, OKF portability).

## [2.4.0] — 2026-07-18

### Global Second Brain (cross-project)
- One personal knowledge store at `~/.monomind/global-brain` (relocatable via `MONOMIND_GLOBAL_BRAIN_DIR`), structurally exempt from `cleanup --data`.
- **Zero-decision routing:** `doc ingest` on a path outside the current project auto-routes to the global brain (announced, overridable); `--global` forces it; `doc list/export --global`.
- **Merged retrieval everywhere:** `doc search`, the warm `/api/knowledge/search` endpoint, and per-prompt `[SECOND_BRAIN]` injection query project + global; project results win ties, global hits are labeled.
- Memory bridge refactored from a first-caller-wins singleton to a per-store instance cache (also fixes a latent store-misroute); excerpt provenance rides the `src:` ingest tag end-to-end.

## [2.3.x] — 2026-07-18

### 2.3.4 — Swarm-review hardening (round 2)
- Chunker: code-fence awareness (`#` lines in ``` blocks are never headings), CRLF normalization, backward-scan loop guards. (`@monoes/memory@1.0.8`)
- Memory engine: `UNIQUE(namespace,key)` enforced in better-sqlite3 (existing DBs deduped newest-wins), TTL-expired entries excluded from search, streaming row iteration.
- Org runtime: unified boss-selection for `org_complete` gating; `org answer` merges by question id instead of clobbering; `org logs` skips corrupt interior lines; `--run` flag validated; doc-metadata removal via append-only tombstones with compaction.
- Every failed CLI command now prints its failure reason (dispatcher-level fix).

Also in the 2.3.4 cycle: a 49-agent adversarial review of the week's modules confirmed 33 findings — **all 33 fixed**, including a critical `cleanup --data` rule that would have deleted live memory stores, and a silent org message-loss window during session restarts. Ledger: `docs/mastermind/plans/2026-07-18-swarm-review-findings.md`.

### 2.3.3 — Semantic per-prompt knowledge injection
- The dashboard server holds the local embedding model warm and serves `/api/knowledge/search` in ~60ms; every substantive Claude Code prompt gets its top knowledge excerpts injected automatically (`[SECOND_BRAIN]`), with tokenized keyword fallback and visible `(semantic)`/`(keyword)` provenance. Injection telemetry (never prompt text) in `.monomind/metrics/second-brain.jsonl`.

### 2.3.2 — Second Brain foundations
- Heading-aware chunking with `§ section` context prefixes; session-start reindex of changed documents; retrieval golden-set eval grown to 18 cases (80% paraphrase recall bar).
- Org cross-run memory: run outcomes stored per `memory_namespace`, `org_recall` tool for agents.
- `cleanup --data`: provable pruning of orphaned per-project stores via origin markers.
- Doctor: Second Brain model check.

### 2.3.1 — Memory engine replaced (LanceDB removed)
- The memory/Second Brain engine is now local SQLite (better-sqlite3, sql.js WASM fallback) storing text + embedding vectors, with local MiniLM embeddings — **~600MB of native dependencies removed** (`@lancedb/lancedb`, `apache-arrow`, onnx runtime stays for embeddings). (`@monoes/memory@1.0.6`)
- Fixed: semantic search over the native backend returned nothing (empty stub); keyword search required whole-phrase matches; namespace filters leaked across namespaces.
- Retrieval quality became a tested invariant: paraphrase golden-set eval in CI.

### 2.3.0 — Org Runtime v2 capability wave
- **Observability:** `org logs --follow` (live event tail), `org report` (outcome, per-role tokens vs budget, assets, crashes; `--all` for run history).
- **Outcomes + memory:** coordinator records run outcomes via `org_complete`; next run is briefed on the last; history in `<org>/history.jsonl`.
- **Headless HIL:** `org questions` / `org answer` — answer `ask_human` from the terminal, live or queued.
- **Resilience:** crashed agent sessions restart with backoff; crash detection in `org status`.
- **DX:** `org run --dry-run` (role-briefing preview), `org create --template content-team|dev-team|research-pod`, `org validate` (schema + structural invariants), informative `org list`, running-org guards on `stop`/`delete`.

## [2.2.0] — 2026-07-17 and earlier

- Org Runtime v2 (SDK daemon) baseline: per-role live agent sessions, `org_send` message bus, policy-gated tools, dashboard event forwarding, cross-process org discovery.
