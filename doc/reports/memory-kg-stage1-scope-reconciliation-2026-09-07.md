# Memory KG next-steps: stage 1 scope reconciliation

Date: 7 September 2026. Stage 1 of [the handoff plan](memory-kg-next-steps-agent-handoff-2026-09-07.md) ("Establish current contracts and correctness fixtures" precedes this — this is the plan's own prerequisite: "Establish current contracts... Reconcile this plan against current source before editing").

**Reviewed revision:** `3f38ee1b6` (local `main`, 2026-09-07). This is 4 commits ahead of `origin/main` (`352ba29c4`) — `021cac61a` (feat: close K5/K7 residuals) and its doc-refresh commits are not yet pushed. Anyone reconciling from a fresh clone or a worktree seeded from `origin/main` will see stale state; this worktree was fast-forwarded onto local `main` before review.

## Verdict

Both source Sept-5 reports ([memory KG review](memory-knowledge-graph-review-2026-09-05.md), [boundaries review](graph-boundaries-review-2026-09-05.md)) were already updated in-repo (commits `d506ae033`, `31314be91`, `3f38ee1b6`) to reflect fixes landed after the original review. I independently re-verified the load-bearing claims against source rather than trusting the doc text. **All of them check out.** The handoff doc's framing — "three remaining investments: indexed adjacency/origin lookup, ranking-usefulness evaluation, and broader correctness/evaluation suites" — is accurate. Findings K1–K6, K8, K10, and B1–B5 are resolved; K7 is resolved except for one deliberately deferred item; K9 is open by design.

## Classification of prior findings

| Finding | Status | Verified against source |
|---|---|---|
| K1 (honest write results) | **Fixed** | Per-rule verdict logic present; report says closed by `352ba29c4` |
| K2 (org ownership scoping) | **Fixed** | — |
| K3 (reversible provenance) | **Fixed** | Per-origin claims ledger present (see K4 evidence below, same mechanism) |
| K4 (name-only identity) | **Fixed** | `KG_NAMES_NS = 'kg:names'` exported ([memory-kg.ts:108](../../packages/@monomind/cli/src/memory/memory-kg.ts#L108)); `nameIndexKey`/name-index resolution at [memory-kg.ts:595-634](../../packages/@monomind/cli/src/memory/memory-kg.ts#L595). Identity is a hashed `(type, name)` tuple per the module header ([memory-kg.ts:23-30](../../packages/@monomind/cli/src/memory/memory-kg.ts#L23)), not the old normalized-name key |
| K5 (upsert IDs / atomic merge) | **Fixed** | `storeIfVersion`/`storeIfAbsent` CAS primitives in [sql-backend.ts:355-410](../../packages/@monomind/memory/src/sql-backend.ts#L355); `withCasRetry` used at [memory-kg.ts:354](../../packages/@monomind/cli/src/memory/memory-kg.ts#L354), called from the node/edge merge paths at lines 927 and 1012. Dedicated test file `packages/@monomind/cli/src/__tests__/memory-kg-atomic-merge.test.ts` covers this under `describe('memory KG atomic provenance merge (K5)')` and `describe('kgSearch triplets carry the edge id (K5)')` |
| K6 (retrieval layer drops) | **Fixed** | Not independently re-verified this pass (no source contradiction found; deferred to stage 2 correctness fixtures) |
| K7 (10,000-entry cap) | **Partially fixed, by design** | Real count: `bridgeCountEntries` runs `SELECT COUNT(*) WHERE namespace = ?` ([memory-bridge.ts:1288](../../packages/@monomind/cli/src/memory/memory-bridge.ts#L1288), backed by `idx_namespace` in [sql-schema.ts:58](../../packages/@monomind/memory/src/sql-schema.ts#L58)). Pagination: `scanNamespace` pages at `SCAN_PAGE = 1_000` ([memory-kg.ts:201](../../packages/@monomind/cli/src/memory/memory-kg.ts#L201)); `kgSearch`'s edge scan is capped at `SEARCH_EDGE_SCAN_MAX = 50_000` with `truncated` reported ([memory-kg.ts:203-207](../../packages/@monomind/cli/src/memory/memory-kg.ts#L203)). **Not done:** indexed src/dst/origin adjacency lookup — the module header documents this exact deferral in a `// monolean:` marker ([memory-kg.ts:73-86](../../packages/@monomind/cli/src/memory/memory-kg.ts#L73)), with the reasoning matching the report almost verbatim: an index built only going forward would silently miss every edge/claim written before it existed, with no legacy-key fallback probe for an arbitrary historical edge (unlike `resolveEntity`'s single fallback key for the K4 migration) |
| K8 (graph integrity/validation) | **Fixed** | Not independently re-verified this pass; no contradicting evidence found |
| K9 (ranking evidence) | **Open, by design** | No evaluation dataset exists in the repo (`doc/reports/`, `tests/memory/` checked — nothing matching an eval-set shape). Confirmed genuinely unaddressed, matching the report |
| K10 (partial document ingestion) | **Fixed** | Not independently re-verified this pass (document pipeline, not memory KG — out of this stage's primary scope per the handoff doc's own scope table) |
| B1–B5 (boundaries/terminology) | **Fixed** | Documentation and naming findings; not independently re-verified this pass — no code dependency for stage 1/K7/K9 work |

K6, K8, K10, B1–B5 are carried forward as "fixed per existing doc trail," not re-verified line-by-line this pass — the handoff doc's primary target for further work is K7 and K9, so verification effort concentrated there. A stage-2 agent building correctness fixtures should still write assertions for K6/K8's claims (isolated-entity retrieval, endpoint-existence validation) since "resolved" in a doc is not itself a test.

## Canonical storage contract (as it exists today)

- **Single backend implementation:** `SqlBackend` ([sql-backend.ts](../../packages/@monomind/memory/src/sql-backend.ts)), over either a native SQLite driver or a sql.js (WASM) driver — same schema, same SQL, resolved via `getBackend()` in [memory-bridge.ts:464](../../packages/@monomind/cli/src/memory/memory-bridge.ts#L464). There is no second backend family to design around.
- **Schema:** one generic table, `memory_entries(id, key, content, type, namespace, tags, metadata, owner_id, access_level, created_at, updated_at, expires_at, event_at, version, references, access_count, last_accessed_at)` ([sql-schema.ts:38-56](../../packages/@monomind/memory/src/sql-schema.ts#L38)), indexed on `namespace`, `key`, `type`, `owner_id`, `created_at`, `updated_at`, `expires_at`. **Edge `src`/`dst`/`origin` are not columns** — they live inside the JSON `content`/`metadata` blob of rows in the `kg:edges` namespace. This is why section 3.1's question ("are ordinary DB indexes sufficient, or is a derived lookup table necessary?") has a source-confirmed answer: **ordinary indexes are not sufficient**; nothing in the existing schema can serve an indexed src/dst/origin lookup without either new columns or a derived table. The module header already reaches the same conclusion and names the upgrade path as "a real SQLite edges table with indexed src/dst/origin columns."
- **KG namespaces**, all scoped through `kgNamespaces()` (org-suffixed when scope is present): `kg:nodes`, `kg:edges`, `rules`, and the K4 name index `kg:names` (kept out of `kg:nodes` deliberately so index rows don't become search seed candidates or count toward `kgStats` — [memory-kg.ts:106-108](../../packages/@monomind/cli/src/memory/memory-kg.ts#L106)).
- **Identity:** hashed `(type, name)` tuple, length-prefixed so no component can bleed into its neighbour; legacy `n:<normalized-name>` rows are resolved via a fallback-key probe and adopted in place, never re-keyed ([memory-kg.ts:64-71](../../packages/@monomind/cli/src/memory/memory-kg.ts#L64)). **No equivalent fallback-key probe exists for edges/origins** — this is the specific gap K7's remaining item is blocked on.
- **Concurrency:** `storeIfVersion`/`storeIfAbsent` give a real single-statement CAS (UPDATE/INSERT OR IGNORE); `withCasRetry` re-reads and re-merges against the current row on conflict rather than merging against a stale read.

## Affected entry points (public readers/writers of the memory KG)

Traced, not assumed identical by name:

- MCP: `memory_kg_ingest`, `memory_kg_search`, `memory_kg_rollback`, `memory_kg_stats` ([memory-tools.ts](../../packages/@monomind/cli/src/mcp-tools/memory-tools.ts))
- CLI: `monomind org memory <org> stats|search|rules|rollback` ([org.ts](../../packages/@monomind/cli/src/commands/org.ts))
- Org runtime: `learnOrgKnowledge`/org recall ([org-memory.ts](../../packages/@monomind/cli/src/orgrt/org-memory.ts))
- Task hooks: causal/outcome edge writes ([hooks-routing.ts](../../packages/@monomind/cli/src/mcp-tools/hooks-routing.ts))
- Combined retrieval: `knowledge_search` ([knowledge-tools.ts](../../packages/@monomind/cli/src/mcp-tools/knowledge-tools.ts)), fused via `query-router.ts`

All of these funnel through `memory-kg.ts`'s exported functions (`kgIngest`, `kgSearch`, `kgRollback`, `kgStats`, …), which are themselves the only callers of the bridge primitives (`bridgeStoreEntry`, `bridgeListEntries`, `bridgeCountEntries`, …). There is no second code path into `kg:nodes`/`kg:edges`/`rules` that bypasses `memory-kg.ts` — an indexed-lookup change made there covers every entry point above by construction, which simplifies stage 3 (no need to hunt for a bypassing writer).

## Explicit exclusions for this stage

Per the handoff doc's own scope table: Monograph's parser/indexing pipeline, Second Brain document ingestion internals (beyond combined-retrieval interaction), and org agent-coordination redesign are out of scope and were not touched or re-verified here.

## Unresolved design decisions carried into stage 3 (K7)

These are decisions, not implementation details — they need an explicit answer before indexed adjacency/origin lookup can be built safely:

1. **Backfill scope-completeness.** There is no legacy-key probe for an arbitrary historical edge (K4's identity migration had exactly one predictable legacy key format to fall back to; edges/origins have no equivalent). A migration must therefore either (a) do a one-time full backfill scan per namespace and record a verified-complete checkpoint before the index is trusted, or (b) accept that pre-migration data is permanently unreachable via the index and always fall back to the scan for anything not proven backfilled. The source comment implies (a) was the intended direction but does not commit to it.
2. **Schema shape.** New columns on `memory_entries` (would need generic src/dst/origin columns unused by non-edge namespaces) vs. a separate derived table (e.g. `kg_edge_index(src, dst, origin, entry_id, namespace)`), rebuildable from canonical `kg:edges` rows. The derived-table direction matches the module header's stated upgrade path and avoids polluting the generic entries schema; this stage recommends it but does not implement it.
3. **Concurrent-write strategy during backfill.** Per section 3.4 of the handoff doc, one of: bounded write pause, snapshot+replay, or transactionally-maintained lookup data. Not yet chosen. Given `withCasRetry` already exists for node/edge merges, a transactional dual-write (write canonical row + index row in the same CAS retry loop) is the natural extension, but this has not been designed or tested.

## Recommendation for stage assignment

Stage 3 (K7 indexed lookup) and the K9 evaluation-dataset track (handoff doc section 4) can proceed in parallel — they touch disjoint files (`memory-kg.ts`/`sql-backend.ts`/`sql-schema.ts` vs. a new `tests/memory/eval/` fixture set) and have no dependency on each other per the handoff doc's own dependency note ("Ranking implementation depends on the evaluation baseline" — evaluation-dataset *design* does not depend on migration work). Stage 2 (correctness baseline fixtures, handoff doc section 2) should land first or alongside stage 3, since stage 3's migration work explicitly depends on it.
