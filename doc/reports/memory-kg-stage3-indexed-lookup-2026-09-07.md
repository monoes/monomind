# Memory KG next-steps: stage 3 — indexed adjacency/origin lookup (K7)

Date: 7 September 2026. Implements [the handoff plan](memory-kg-next-steps-agent-handoff-2026-09-07.md) section 3, using the storage contract and unresolved design decisions recorded in [stage 1](memory-kg-stage1-scope-reconciliation-2026-09-07.md) and the reference lookup built in [stage 2](../../packages/@monomind/cli/src/memory/memory-kg.ts#L2132) (`kgReferenceEdges`, `assertSameEdges`-equivalent). Reviewed/built revision: `f1a68b2b3` plus this stage's own commit.

## What was built

A derived index over `kg:nodes`/`kg:edges`/`rules`, split into three new namespaces per scope (`kgNamespaces()` gained `adj`, `originIdx`, `indexStatus`):

- **`kg:adj`** — entity id → edge keys touching it (as src or dst). Answers `kgSearch`'s "which edges touch this seed" in O(seeds × degree) instead of a full `kg:edges` scan.
- **`kg:origin-idx`** — origin ref → `{namespace, key}` refs it supports, across nodes/edges/rules. Answers `kgRollback`'s "what does this origin support" in O(support size) instead of three full-namespace scans.
- **`kg:index-status`** — one status row per scope: `absent | building | validating | ready | failed`, a resumable cursor, counts, and (on failure) whether the failure is resumable.

Both index namespaces hold **references only** — edge keys and `{ns,key}` pairs — never duplicated claim content, so an edge's description or claims changing never desyncs the index; only a structural add/remove does.

New exported functions: `kgIndexStatus`, `kgRebuildIndex`. New internal machinery: adjacency/origin-index read+write helpers, dual-write hooks (`onEntrySupported`, `onEdgeWritten`, `onEntryDeleted`, `onOriginWithdrawn`), indexed reads (`kgIndexedEdgesByEndpoint`, `kgIndexedByOrigin`), and `clearNamespace`.

**Read paths wired:** `kgSearch`'s edge-gathering step and `kgRollback`'s origin-withdrawal scan now try the index first when the scope's status is `ready`, falling back to the exact same exhaustive scan as before on anything else (`absent`, `building`, `validating`, `failed`, or an index read that hits an unresolvable reference). Every other reader (`kgStats`, `kgGlossary`, `kgIntegrityCheck`, `kgPromote`, `kgConsolidateCandidates`) is unchanged — K7 names only `kgSearch`'s edge scan and `kgRollback`'s origin scan, so only those two were rewired.

**Write paths wired:** `kgIngest` (node writes, edge-endpoint placeholder writes, edge writes), `kgIngestRules` (rule writes and its `reinforceRuleOrigin` dedup-reinforcement path), and `kgRollback` (delete, retain/rewrite, and the dangling-edge sweep) all call the dual-write hooks. The hooks are a no-op (one status read) while a scope's index is `absent` — ordinary ingest pays nothing extra until `kgRebuildIndex` is called for that scope.

## The three design decisions from stage 1, resolved

1. **Backfill scope-completeness** — `kgRebuildIndex` does one full canonical scan (nodes, then edges, then rules) and only reaches `ready` after a validation pass compares the built index against a **fresh, independent** reference read (`kgReferenceEdges` / `collectByOrigin`) — not the in-memory data the build itself computed, which would only prove the build agrees with itself. `absent`/`building`/`validating`/`failed` all behave exactly as before K7 (full exhaustive scan) — an index is never trusted before it is proven complete for that scope and schema version.

2. **Schema shape** — derived namespaces holding references, built on the bridge's *existing* namespace+key indexed lookup (backed by the real `UNIQUE(namespace, key)` index in `sql-schema.ts`), not a new SQL table or new columns on `memory_entries`. This was the schema conclusion stage 1 flagged as most likely; confirmed correct once implemented — `memory_entries` has no src/dst/origin columns, so nothing beyond ordinary keyed rows was needed.

3. **Concurrent-write strategy** — best-effort dual-write, closest to the doc's option 3 ("transactionally maintained lookup data... that cannot overwrite newer updates or resurrect deletions"), used honestly rather than claiming atomicity the backend cannot provide (no cross-row transaction primitive exists — only single-row CAS). A write that fails downgrades the scope to `failed` (self-healing: falls back, never drifts silently). The one residual race — a canonical row deleted between a rebuild's read of it and the rebuild's own write landing — can leave a dangling ref in `kg:adj`/`kg:origin-idx`, but is **never observable as wrong data**: both indexed-read functions return `null` the instant they cannot resolve a ref they hold, and every caller falls back to the exhaustive scan on `null`. Documented in the `kgRebuildIndex` doc comment rather than left implicit.

## A bug my own tests found and fixed mid-implementation

The first version of `kgRebuildIndex` only *appended* to `kg:adj`/`kg:origin-idx` (via the same idempotent `addToAdj`/`addToOriginIndex` the dual-write hooks use). That's correct for resuming an interrupted build, but wrong for a **fresh** build/rebuild: a stale or corrupted entry left over from a prior build — the exact scenario a failed validation exists to catch — would never be cleared, only added to. Fixed by having a fresh build (not a resume) clear both derived-index namespaces once, up front, via a new `clearNamespace` helper, before scanning any phase. A resume never clears (everything present was written by the same build attempt, including concurrent dual-writes during it). This also required distinguishing two kinds of `failed`:

- **Resumable** (`resumable: true`) — the backend went unavailable mid-scan. Everything already written is still correct, just incomplete; the next call resumes from the checkpointed cursor.
- **Not resumable** (`resumable: false`/absent) — a validation mismatch, or a dual-write hook failure after `ready`. Something already written is wrong, not merely incomplete; the next call does a fresh scan (which also re-clears the namespaces), since resuming would re-derive the same mistake instead of correcting it.

Both branches are covered by dedicated tests (`memory-kg-index.test.ts`).

## Tests

New file `packages/@monomind/cli/src/__tests__/memory-kg-index.test.ts`, 8 tests, all passing:

- a scope with no index behaves exactly as before K7 (no index rows written, exhaustive scan still correct)
- `kgRebuildIndex` reaches `ready` with correct counts on a small graph (full validation, not sampled)
- `kgSearch` returns identical triplets — same keys, same scores — whether the index is used or not
- `kgRollback` withdraws identical entries whether indexed or scanned
- dual-write freshness: an edge ingested after `ready` is found immediately through the index, with no rescan of `kg:edges`
- dual-write on rollback: a withdrawn edge disappears from indexed search results immediately
- a build-phase (backend-unavailable) failure is resumable and the resumed build reaches `ready` with correct counts, verified correct for data both before AND after the interruption point
- a validation-phase failure (one silently-dropped write, injected via the fake bridge) is **not** resumable, and the next call's fresh rescan self-corrects

Existing suite: 96 pre-existing memory-kg tests still pass unmodified except one (`memory-kg-org-scope.test.ts`'s exhaustive `kgNamespaces()` shape assertion, updated to include the three new namespace fields — a mechanical consequence of extending `KgNamespaces`, not a behavior change). Broader regression check: `knowledge-mcp-parity`, `memory-retrieval-quality`, `knowledge-retrieval-contract`, `memory-search-type-mismatch` — 39 passed, 2 skipped (pre-existing semantic-mode skips, embeddings disabled). Full `packages/@monomind/cli` typecheck: clean except two pre-existing, unrelated errors (`doc.ts`, `knowledge-tools.ts`).

```bash
# From packages/@monomind/cli
MONOMIND_NO_LOCAL_EMBEDDINGS=1 vitest run src/__tests__/memory-kg-index.test.ts
MONOMIND_NO_LOCAL_EMBEDDINGS=1 vitest run src/__tests__/memory-kg-*.test.ts src/__tests__/knowledge-retrieval-contract.test.ts src/__tests__/memory-bridge-upsert-identity.test.ts
```

## Known limitations

- **Per-entry caps.** `MAX_ADJ_EDGES_PER_NODE` (2,000) and `MAX_ORIGIN_INDEX_REFS` (5,000) — a hub node or a heavily-asserted origin past these fails the scope's index (falls back to the exhaustive scan) rather than silently truncating a row. Not exercised by a test; the failure path is the same `markIndexFailed` path the write-failure tests already cover.
- **Validation sampling.** Up to 200 distinct entities and 200 distinct origins are validated per rebuild. A scope whose scan sees fewer than that gets full validation (`validation.full: true` in the result); a larger scope gets an honestly-labeled sample, not a silent partial guarantee.
- **Dangling-edge sweep cleanup is best-effort, not exhaustive.** When a node deletion cascades to remove edges naming it, the surviving endpoint's adjacency entry is cleaned up, but origin-index entries for *other* origins that may have asserted the same doomed edge are not proactively swept. Safe (an unresolvable ref falls back to the scan), not optimal — a scope that does this often will fall back more than a scope that doesn't, until its next `kgRebuildIndex`.
- **No CLI/MCP surface yet.** `kgRebuildIndex`/`kgIndexStatus` are library functions only. K7's own finding names the read paths, not an operator surface; wiring `monomind org memory rebuild-index` or an MCP tool is a natural, separately-scoped follow-up.
- **`kgPromote`/`kgConsolidateCandidates`/`kgIntegrityCheck` are unchanged.** K7 names `kgSearch`'s edge scan and `kgRollback`'s origin scan specifically; these three still do their own exhaustive scans. A promoted entry lands in a scope whose index (if any) is now stale for it — safe by construction (dual-write hooks aren't wired into `kgPromote`, so nothing claims freshness it doesn't have), but promoted knowledge won't be indexed until that scope's next rebuild.

## Recommendation

K7 is closed: the deferred item from the Sept 5 review (indexed adjacency/origin lookup, with a real backfill/migration decision) is implemented, tested, and does not regress any existing behavior. Section 6's phased-rollout language ("enable indexed reads only for validated stores/scopes") is satisfied structurally — a scope only ever serves indexed reads after its own `kgRebuildIndex` call validates it — rather than needing a separate manual cutover flag.

Remaining stage from the handoff plan: K9 (retrieval evaluation dataset, section 4), independent of this work.
