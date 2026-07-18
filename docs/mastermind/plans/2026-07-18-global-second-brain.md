# Global Second Brain — Design

**Status:** design approved for next implementation session (not yet built)
**Context:** per-project Second Brain shipped in v2.3.1–2.3.3 (local SQLite + local embeddings, auto-activation, semantic per-prompt injection via warm dashboard endpoint). This plan extends it to a personal, cross-project knowledge scope.

## Goal

One personal brain at `~/.monomind/global-brain/` that any project can read, while project knowledge stays project-scoped. Same product constraints as the per-project brain: zero decisions, fully local, no prompts, auto-everything.

## What exists to build on

- `memory-bridge` (CLI): store/search with local embeddings; **singleton-per-process, bound to the first dbPath** — the single biggest refactor this plan requires.
- Warm endpoint `POST /api/knowledge/search` on the dashboard server (holds the model hot, ~60ms).
- Per-prompt injection in `route-handler.cjs` (semantic-first, keyword fallback, telemetry, relevance floor 0.35).
- OKF export/import (`doc export` / okf-import skill) — the natural transport for moving a brain between machines.

## Design decisions

1. **Store layout:** `~/.monomind/global-brain/memory.db` — same engine, same schema, namespace `knowledge:global`. NOT a magic entry in `~/.monomind/projects/` (those are per-project caches subject to `cleanup --data`; the global brain must never be pruned by origin heuristics).

2. **Bridge refactor (prerequisite):** replace the module-level backend singleton with a small per-dbPath instance cache (`Map<resolvedPath, backendPromise>`). The embedder stays a process-wide singleton (the expensive part). This also fixes the latent first-caller-wins misroute noted in the org-memory work. All existing call sites keep their signatures.

3. **Ingest semantics:** `monomind doc ingest <path> --global` writes to the global store. Auto-routing: paths outside any project root (e.g. `~/notes`) default to global; paths inside a project default to project scope. Zero-decision default, explicit flag to override.

4. **Search semantics:** project first, global second. `knowledge_search`, `doc search`, and the warm endpoint gain `scope: project | global | all` (default `all`). Results merge by score with a small project-scope boost (+0.05) — local context should win ties.

5. **Injection:** the warm endpoint searches `all` by default, so per-prompt injection gets global knowledge with no hook changes. Provenance shows `[global]` vs project source so the user can see where an excerpt came from.

6. **Dashboard:** the Chunks tab's semantic search (shipped 2026-07-18) gains a project/global/all scope toggle; global doc count in the stats bar.

7. **Sync/portability:** no cloud sync — by design. `doc export --global` produces an OKF bundle; import on another machine. (A user who wants sync can put the bundle in their own Dropbox/git; we never transmit.)

8. **Doctor:** `checkSecondBrainModel` extends to report global-brain presence/size; `cleanup --data` explicitly skips `~/.monomind/global-brain`.

## Non-goals

- Cross-machine sync service (violates local-only).
- Per-source ACLs or multi-user sharing (single-person brain).
- Replacing monograph for code — global brain is prose-only, same as project brains.

## Implementation order (one session)

1. Bridge instance-cache refactor + tests (existing memory suites must stay green).
2. Global store paths + `--global` flag + auto-routing in `doc ingest`.
3. `scope` param through `bridgeSearchEntries` → `knowledge_search` MCP tool → warm endpoint → `doc search`.
4. Injection provenance + dashboard scope toggle.
5. Doctor/cleanup guards + eval cases (global-vs-project ranking, tie-boost).
