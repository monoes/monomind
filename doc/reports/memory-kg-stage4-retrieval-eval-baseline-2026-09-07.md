# Memory KG next-steps: K9 — retrieval evaluation baseline

Date: 7 September 2026. Implements [the handoff plan](memory-kg-next-steps-agent-handoff-2026-09-07.md) section 4: "create the retrieval evaluation set before changing ranking." Reviewed/built revision: `d4f7f676c` (post-K7) plus this stage's own commit. Independent of, and does not depend on, [stage 3 (K7)](memory-kg-stage3-indexed-lookup-2026-09-07.md).

**This is a baseline measurement, not a ranking change.** No ranking code was modified. Per the doc's own framing, the goal here is to measure current behavior so a future ranking change (if any) has something real to compare against — "No ranking change justified" is an explicit valid outcome of this track, not a failure of it.

## Scope: synthetic graphs only, by design

Section 4.1 describes two complementary dataset halves:

1. **Synthetic graphs** — small, deterministic fixtures with exact expected entities/claims/scope behavior. **This deliverable.**
2. **Representative task questions** — realistic queries with reviewed human relevance labels.

Only the first half is built here. The doc is explicit that the second half requires human review before its labels become acceptance criteria ("an LLM may propose questions and labels, but ambiguous labels require review before becoming acceptance criteria") — that review isn't available in an autonomous session, and inventing "realistic" labeled queries without it would be exactly the overclaim the doc warns against. **The representative-question half is deferred, not built, and not simulated.**

## Dataset and runner

Two new files, both under `packages/@monomind/cli/src/__tests__/`, run with `vitest run` (the "reproducible runner"):

- **`kg-eval-retrieval.test.ts`** — 16 fixtures across 11 of the 12 categories in section 4.1, run against a **real backend** (`SqlBackend`, keyword mode, isolated temp store under `process.cwd()` — same traversal-guard-compliant pattern as `memory-retrieval-quality.test.ts`). Every call passes an explicit `dbPath`, so this suite never touches the real project's own memory store. Real `kgIngest`/`kgSearch`/`kgRollback`/`kgIngestRules` calls, not simulated.
- **`kg-eval-combined.test.ts`** — 2 fixtures for the 12th category (combined document/KG retrieval), against a mocked bridge (same pattern as `knowledge-retrieval-contract.test.ts`), because `knowledge_search`'s MCP handler resolves its store internally and doesn't accept a `dbPath` override — a real isolated backend isn't reachable through that entry point the way `kgSearch`/`kgIngest` allow. `document-pipeline.js`'s `searchKnowledge` is also mocked, returning controlled excerpts, so a document-side result can exist without real file ingestion.

Both embed the ground-truth shape from section 4.2 (query, scope, expected entities/claims, whether an answer exists, rationale) as the fixture's own assertions rather than a separate schema file — each fixture *is* its ground truth, checked directly against what the real functions return. Run:

```bash
# From packages/@monomind/cli
MONOMIND_NO_LOCAL_EMBEDDINGS=1 vitest run src/__tests__/kg-eval-retrieval.test.ts src/__tests__/kg-eval-combined.test.ts --reporter=verbose
```

**Embeddings mode was not evaluated.** `MONOMIND_NO_LOCAL_EMBEDDINGS=1` throughout — this measures keyword-mode retrieval only. A skipped semantic test is not a semantic-quality pass; that is a separate, future measurement this deliverable does not make.

## Baseline results (keyword mode, real run — all 18 fixtures)

| Category | Fixture | Metric | Value | Note |
|---|---|---|---|---|
| exact entity lookup + aliases | e1-exact-name | MRR | 1.000 | exact name query |
| exact entity lookup + aliases | e2-partial-name | recall@5 | 1.000 | rank=0 |
| **relationships (predicate matters)** | r1-two-relation-pair | precision@1 | **0.000** | both edges score identically — no relation-aware ranking |
| relationships (predicate matters) | r2-single-relation | precision@1 | 1.000 | single relation, unambiguous |
| fact/source-specific | f1-asserted-method | evidence-quality-fraction | 1.000 | method=asserted present |
| isolated entities | i1-zero-edges | recall@k | 1.000 | zero-edge entity still a seed |
| same-name, different scopes | s1-two-orgs | scope-correctness | 1.000 | no cross-scope leak |
| updated/contradicted/withdrawn | u1-update-wins | correctness | 1.000 | current fact discoverable |
| **updated/contradicted/withdrawn** | u1b-duplicate-seed-hit | anomaly-rate | **1.000** | see "Discovered anomaly" below |
| updated/contradicted/withdrawn | u2-conflict-flag | correctness | 1.000 | conflict=true on genuine disagreement |
| updated/contradicted/withdrawn | u3-withdrawal | retraction-correctness | 1.000 | withdrawn fact gone after rollback |
| rules with conditions | ru1-conditional-rule | correctness | 1.000 | accepted + listed |
| missing-answer questions | m1-never-ingested | abstention-correctness | 1.000 | zero false-positive triplets |
| paraphrases (keyword mode) | p1-paraphrase | recall@k | 1.000 | see note below — not a semantic claim |
| hard negatives | h1-two-relations | precision (no mislabeling) | 1.000 | both relations distinguishable |
| **below top-15 cutoff** | c1-rank-20-of-20 | recall@k | **0.000** | seed past `SEARCH_SEED_LIMIT` is missed |
| combined document/KG | cd1-both-surfaces | fusion-completeness | 1.000 | excerpt + entity both present |
| combined document/KG | cd2-kg-not-suppressed | correctness | 1.000 | empty doc surface doesn't hide KG hit |

**13 of 15 real-backend fixtures and both combined fixtures behave as expected.** Two measured properties came back at 0, both informative, not bugs in the harness:

### Finding 1 — no relation-aware ranking (r1, expected)

Confirms K9's own "still open" finding verbatim: *"ranking deliberately does not evaluate the relation/fact against the query."* Two edges between the same pair of entities, differing only by relation, score identically under `kgSearch` — score is purely a function of seed (endpoint) relevance, so re-asserting one relation more than the other does not change its rank. `top=reads_from` happened to win the array-order tiebreak in this run, not because it was more relevant. This is exactly the gap K9's section 5 (ranking evaluation) exists to eventually address, and this baseline is now measured evidence for it rather than an assertion in a review doc.

### Finding 2 — the SEARCH_SEED_LIMIT=15 cutoff has real recall cost (c1, expected, now quantified)

A fact attached to the 20th (least-relevant-scoring) of 20 broadly-matching entities was not retrieved — `kgSearch`'s seed cutoff genuinely drops candidates past its limit, and the loss is now a concrete, reproducible fixture rather than only a comment (`SEARCH_SEED_LIMIT`) in the source. Confirms the "facts below the normal cutoff" category from section 4.1 is not a hypothetical concern.

### Discovered anomaly — duplicate stale/current seed hits after an update (u1b, not expected)

Not something this baseline set out to test — found while measuring the "updated claims" category. After updating an entity's description (`kgIngest` twice, two different origins), `kgSearch`'s seed results contained **two entries with the same entity id and the same score, one with the stale description and one with the current one**:

```
DIAG u1 seeds: [
  { "name": "Meridian", "description": "legacy: routes to MySQL", "id": "entry_...5bba0efd88f9d630" },
  { "name": "Meridian", "description": "current: routes to PostgreSQL", "id": "entry_...5bba0efd88f9d630" }
]
```

The canonical row itself is correct (one id, one row, `bridgeGetEntry`-reachable) — this was specifically `bridgeSearchEntries`' keyword-index result set carrying two hits for one row after an upsert. **Fixed** as its own small, scoped change, separate from ranking work, in [memory-kg-followup-fixes-2026-09-07.md](memory-kg-followup-fixes-2026-09-07.md): root cause was `SqlBackend.store()`'s `INSERT OR REPLACE` upsert not reliably firing the FTS5 `AFTER DELETE` sync trigger for its conflict-resolution delete, confirmed by direct inspection of the raw `memory_entries_fts` table. This re-run of the K9 baseline (below) now shows `anomaly-rate=0.000`.

### Paraphrase note (p1)

`recall@k=1.000` is *not* a semantic-quality claim — the fixture's query happened to share enough incidental tokens with the stored content for keyword matching to succeed by coincidence in this run. A genuine zero-lexical-overlap paraphrase benchmark needs the embedding model loaded (`MONOMIND_NO_LOCAL_EMBEDDINGS` unset), which this pass deliberately does not do. Recorded as a category baseline, not asserted must-pass, exactly like c1.

## Known limitations

- **18 fixtures, not 60–100.** That count in section 4.1 was specified for the representative-question half, which is deferred here (see Scope above) — the synthetic half is deliberately "small, deterministic fixtures," and 1–3 per category is consistent with that framing, not a shortfall against it.
- **Embeddings mode unevaluated.** Every fixture ran keyword-only. A second pass with the local model loaded is a distinct, separate measurement.
- **Metrics are per-fixture booleans/counts, not aggregated ranking statistics over a large query set.** MRR/recall@k/precision@k are computed correctly per the standard definitions, but each category has only 1–3 data points — enough to establish presence/absence of a behavior (as intended here), not enough to be a statistically stable ranking benchmark. Section 5's eventual ranking-comparison work should size its own held-out set independently.
- ~~**The u1b anomaly is unconfirmed root cause.**~~ Fixed and confirmed — see [memory-kg-followup-fixes-2026-09-07.md](memory-kg-followup-fixes-2026-09-07.md). The root cause (the FTS5 sync trigger, not `PRAGMA recursive_triggers`) was found by direct inspection of the raw SQLite tables, not left as a guess.

## Recommendation

K9's stage-4 deliverable (dataset + runner + baseline report) is complete for the synthetic-graph half. Section 5 (evaluate ranking changes) can now proceed with this baseline as its comparison point — its own text already frames "no ranking change justified" as a valid outcome, and finding 1 above (no relation-aware ranking) is the concrete candidate such an evaluation would need to weigh against implementation cost. Two follow-ups fall outside this deliverable's scope and are recorded here for separate pickup:

1. Investigate and fix the u1b duplicate-seed-hit anomaly (search-index correctness, not ranking).
2. Build the representative-question half of the dataset once human-reviewed relevance labels are available.
