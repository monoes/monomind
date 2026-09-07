# Memory knowledge graph: next steps and agent handoff

Date: 7 September 2026.

This is an implementation handoff plan, not a record of completed implementation. It is based on the review reports and a supplied status update identifying three remaining investments: indexed adjacency/origin lookup, ranking-usefulness evaluation, and broader correctness/evaluation suites. **Reconcile this plan against current source before editing.** The implementation was not re-reviewed when this document was written.

Related reports:

- [Memory knowledge graph review](memory-knowledge-graph-review-2026-09-05.md)
- [Graph boundaries and terminology](graph-boundaries-review-2026-09-05.md)
- [Earlier Monograph review](knowledge-graph-review-2026-09-05.md), a separate subsystem and historical snapshot

## Objective and order

Make the memory KG's retrieval complete, migration-safe, measurable, and useful without losing existing knowledge or weakening ownership boundaries.

Recommended order:

1. Establish current contracts and correctness fixtures.
2. Create a retrieval evaluation baseline.
3. Implement indexed lookup with compatible backfill and recovery.
4. Evaluate ranking changes against the baseline.
5. Roll out lookup and ranking separately, with evidence for each.

These are separate projects with shared acceptance criteria. This plan is not permission to redesign the entire knowledge system. Completing one stage does not imply that later stages are implemented or validated. If assigned only one stage, return a concrete handoff for the next stage.

## 1. Scope and implementation rules

The primary target is the **memory knowledge graph**: entities, relationships, rules, provenance, and retrieval through the memory bridge.

| System | Treatment in this work |
|---|---|
| Memory KG | Primary implementation and evaluation target |
| Monograph code graph | Separate correctness project; do not change its parser or indexing pipeline here |
| Second Brain document index | Test interactions through combined retrieval; avoid unrelated ingestion changes |
| Org runtime | Test ownership and retrieval boundaries; do not redesign agent coordination |
| Legacy graph representations | Inventory relevant consumers; no automatic merging or deletion |

Before editing, classify relevant findings as **fixed, partially fixed, open, or intentionally deferred**, citing current source and tests. The September 5 reports already distinguish some concurrent fixes from baseline defects; preserve that distinction.

Do not treat an old report as proof that a bug remains. A passing library test also does not prove that every public adapter uses the fixed behavior.

Inventory the public readers and writers, including MCP, CLI, org learning/recall, hooks, and any direct bridge callers. Trace their actual store and scope resolution. Do not assume similarly named tools query identical data.

**Deliverable:** a short scope/design document containing the reviewed revision, canonical storage contracts, affected entry points, existing fixes, explicit exclusions, and unresolved design decisions.

## 2. Establish the memory-KG correctness baseline

Start with a focused suite covering the contracts the migration will depend on. Use real persistence in isolated fixtures, with controlled failure injection where necessary. Never seed, migrate, or roll back a user's live knowledge store for a test.

| Area | Required invariant |
|---|---|
| Existing data | Entries created before the new index remain discoverable |
| Entity identity | Same display name in different scopes does not accidentally merge |
| Re-ingestion | Repeated ingestion preserves stable references and does not duplicate support |
| Provenance | Withdrawing A preserves B's support; withdrawing both removes unsupported claims |
| Corrections | Replacement or supersession follows the documented policy |
| Integrity | Edges have valid endpoints or explicitly supported placeholder semantics |
| Pagination | Eligible results beyond the first page remain reachable |
| Failure handling | Failed operations never appear as complete successful operations |
| Retrieval | Isolated entities remain available through interfaces that promise entity retrieval |
| Scope | Reads, writes, counts, migration, and rollback respect project/org boundaries |
| Lifecycle | Restarting or reopening storage preserves the same logical graph |

Create a reusable reference lookup and equivalence assertion:

> For a given scoped canonical dataset, indexed lookup and complete reference lookup return the same eligible relationships and origins.

The reference lookup must read canonical records completely; it must not depend on the new index or inherit an old first-page cap. Compare stable identities and relevant fields, not incidental row order. Test ordering/ranking separately.

Include fixtures for empty stores, legacy stores without index metadata, partial migration, records exceeding one page, and records written during migration. Make malformed records and unsupported legacy ownership visible rather than silently dropping them.

**Keep Monograph's correctness suite separate.** Clean-build/cached-build/incremental-build equivalence, failed-build retry, and parser identity fixtures need their own scope and completion criteria. A memory-KG suite does not satisfy that separate investment.

**Deliverable:** deterministic fixtures, a complete reference lookup, and a passing baseline before an index becomes authoritative. If an invariant currently fails, record the failure and address prerequisites explicitly; do not weaken the assertion merely to make the suite pass.

## 3. K7: indexed lookup and migration design

### 3.1 Inspect storage before choosing an index design

Document:

- Which records are canonical.
- How endpoints, origins, validity, and ownership scope are represented.
- Every supported creation, update, deletion, rollback, and import path.
- Supported backend transaction and indexing capabilities.
- Whether logical IDs survive updates.
- Whether independent processes can write concurrently.

Determine whether ordinary database indexes over existing data are sufficient, or whether a derived relationship lookup table is necessary. Do not add a second representation by default.

If a derived lookup is needed, use this contract:

> The lookup is rebuildable from canonical records. It is not an independent source of truth.

Support scoped lookup by source endpoint, target endpoint, and origin reference. Preserve all supported origins; do not reduce multiple origins to one field. Schema/version metadata must distinguish incompatible index representations.

### 3.2 Specify migration state and read behavior

```text
absent → building → validating → ready
                 ↘ failed / retryable
```

| State | Required read behavior |
|---|---|
| Absent/building | Complete canonical lookup, or an explicitly incomplete response |
| Validating | Continue compatibility reads; optionally compare indexed results |
| Ready | Indexed lookup |
| Failed/incompatible | Safe fallback with visible status; no false empty success |

**An index-only lookup must never be enabled merely because the index table exists.** Readiness requires verified completeness for the relevant store/scope and schema generation.

Fallback must not mean the previous capped 10,000-entry scan. It must paginate completely within the requested scope, or explicitly state that completeness cannot be established. Bounded latency is useful, but it cannot justify silently treating partial data as a complete answer.

### 3.3 Backfill requirements

- Process supported pre-existing records, not only records created after deployment.
- Make batches resumable and idempotent.
- Use stable pagination or a consistent snapshot. Avoid offset iteration over a mutating dataset.
- Preserve canonical data throughout migration.
- Persist enough checkpoint/version information to recover after interruption.
- Report malformed records and unresolved ownership explicitly.
- Never invent missing org ownership or silently assign ambiguous records to a convenient scope.
- Support restart and retry without duplicate lookup entries.

Distinguish a technical index migration from a semantic data repair. If legacy data lacks enough information to determine ownership, completeness cannot be manufactured by guessing. Return that as an explicit migration decision with affected-record counts and safe options.

### 3.4 Choose the concurrent-write strategy before coding

Choose an approach justified by actual backend capabilities:

1. A bounded write pause while backfill and validation complete.
2. A consistent snapshot plus replay of intervening mutations.
3. Transactionally maintained lookup data, with backfill semantics that cannot overwrite newer updates or resurrect deletions.

Specify crash/failure behavior and how readers observe the transition. Do not introduce informal dual writes without defined ordering, detection, and recovery when one write succeeds and the other fails.

If the bridge cannot update canonical records and lookup data atomically, explain how incomplete synchronization is detected and repaired before indexed reads are trusted. Do not claim atomicity that the backend does not provide.

### 3.5 Validate readiness

Row counts alone are insufficient: equal counts can hide missing and duplicated relationships.

Verify:

- Endpoint and origin mappings match canonical data.
- Scope filters hold throughout backfill and after cutover.
- Updates and deletions during migration are reflected.
- Indexed/reference lookup equivalence holds on legacy and newly written data.
- Restart, retry, and failure paths produce recoverable state.
- Every supported backend either implements the contract or explicitly uses the compatible fallback.

Prefer full consistency checks for manageable datasets. Any sampling strategy for larger stores must document what it does and does not establish.

**Deliverables:** migration design, implementation, automated compatibility/recovery tests, observable status, and recovery instructions. Include evidence that old and new knowledge remain discoverable.

## 4. K9: create the retrieval evaluation set before changing ranking

The initial goal is to measure current behavior, not to justify a more complicated ranker.

### 4.1 Use two complementary datasets

- **Synthetic graphs:** small, deterministic fixtures with exact expected entities, claims, and scope behavior.
- **Representative task questions:** realistic queries with reviewed relevance labels and supporting evidence.

A practical first version could contain approximately 60–100 questions. This is a starting scope, not a substitute for adequate category coverage.

Cover:

- Exact entity lookup and aliases.
- Relationships where the predicate matters.
- Questions requiring a particular fact or source.
- Isolated entities.
- Same-name entities in different scopes.
- Updated, contradicted, and withdrawn claims.
- Rules with conditions and exceptions.
- Missing-answer questions.
- Combined document/KG retrieval.
- Paraphrases with little lexical overlap.

Include hard negatives: entities that match the topic but whose relationship does not answer the question. Include relevant facts below the normal first-page/candidate cutoff.

### 4.2 Define ground truth independently of current retrieval

Each fixture should record:

```text
Query
Requested scope and retrieval surface
Relevant entity/claim IDs
Required source support
Known irrelevant or forbidden results
Whether an answer exists
Relevance grade and rationale
Dataset version
```

Do not label current top results as relevant merely because the system returned them. An LLM may propose questions and labels, but ambiguous labels require review before becoming acceptance criteria. Use synthetic or approved material; do not copy private production knowledge into a committed benchmark.

Separate development queries from held-out evaluation queries before tuning. Keep a record of label changes and their reasons.

### 4.3 Measure separate properties

| Property | Suggested measure |
|---|---|
| Candidate coverage | Entity and relevant-claim recall@k |
| Ordering | MRR or nDCG@k |
| Relationship usefulness | Relevant-triplet precision@k |
| Evidence quality | Fraction of results with valid source support |
| Retraction correctness | Withdrawn/superseded results returned |
| Scope correctness | Out-of-scope results returned |
| Empty-answer behavior | Unsupported answers versus correct abstention |
| Efficiency | Latency, records scanned, and returned context size |

Scope leakage, lost eligible records, and unsupported reappearance after rollback are correctness failures. They must not be averaged away by better relevance scores on other questions.

Evaluate keyword-only and embedding-enabled modes separately. Record model/version, configuration, dataset version, and actual fallback behavior. A skipped semantic test is not a semantic-quality pass. If the evaluation stops at retrieval, report retrieval/empty-result behavior; do not claim generated-answer accuracy without evaluating a consuming generator.

**Deliverable:** a versioned dataset, reproducible runner, and baseline report for the existing system, including per-category failures and limitations.

## 5. Evaluate ranking changes only after establishing the baseline

Compare a few bounded alternatives:

1. Existing entity-seeded ranking.
2. The same retrieval with relation/fact relevance added.
3. Evidence or validity-aware filtering.
4. A combination, if individual changes demonstrate value.

Keep candidate generation, eligibility filters, ranking, and formatting distinguishable. A ranking experiment must not hide a candidate-generation or scope regression.

Do not initially add multi-hop traversal, a new embedding model, a model-based judge on every query, or a new graph database. Those require separate evidence that simpler approaches cannot solve measured problems.

Choose acceptance thresholds before tuning. Report held-out aggregate results, per-category regressions, latency, and context cost. Avoid tuning on the held-out questions and then describing them as independent validation.

**Deliverable:** an evaluation report recommending either a demonstrated ranking improvement or retaining the current ranker. “No ranking change justified” is a valid outcome.

## 6. Roll out lookup separately from ranking

Indexed lookup should initially preserve retrieval semantics. Changing lookup and ranking together makes missing-data regressions difficult to diagnose.

Progression:

1. Backfill with compatibility reads.
2. Run indexed lookup alongside the reference path on bounded fixtures or sampled requests where appropriate.
3. Compare eligible relationships and origins.
4. Enable indexed reads only for validated stores/scopes.
5. Retain a documented recovery route.

Do not automatically execute a large blocking migration inside an ordinary search request. If lazy initialization is necessary, schedule bounded work and expose readiness accurately.

Distinguish rollback of the optimization from rollback of user knowledge. Disabling or rebuilding lookup data must not delete canonical facts. Do not remove the compatibility path until the migration/version policy proves it is no longer needed for supported stores.

## 7. Agent assignments and dependencies

Parallel work can independently cover:

- Storage/write-contract inventory and migration design.
- Correctness fixtures and the complete reference lookup.
- Evaluation dataset design and label review.

Use separate ownership of files and fixtures to avoid conflicting edits. Do not ask multiple agents to independently redesign or mutate the same schema.

Migration implementation depends on the storage contract, concurrency decision, and relevant correctness fixtures. Ranking implementation depends on the evaluation baseline. Integration review should verify public adapters, not only internal helpers.

Each handoff must state:

- Reviewed revision and affected files.
- Decisions made, their rationale, and unresolved assumptions.
- Tests run and skipped, with backend/model modes identified.
- Migration compatibility and recovery behavior.
- Known limitations.
- Evidence satisfying the assigned acceptance criteria.

Routine reversible implementation choices can be resolved from source and existing authorization. Decisions that change ownership semantics, discard legacy knowledge, or require destructive live migration must be made explicit rather than silently inferred. Prepare a concrete design and impact assessment before seeking any required approval.

## Final acceptance checklist

- [ ] Current fixes were reconciled; obsolete findings were not reimplemented blindly.
- [ ] Pre-existing knowledge remains discoverable.
- [ ] Ownership boundaries hold during and after migration.
- [ ] Backfill survives interruption and the selected concurrent-write scenarios.
- [ ] Indexed and complete reference lookup agree on eligible data.
- [ ] Counts, partial states, failures, and retrieval methods are honest.
- [ ] Stable references and provenance survive supported updates and rollback.
- [ ] Evaluation labels are independent of current retrieval output.
- [ ] Ranking changes, if any, improve held-out results without breaking correctness.
- [ ] Lookup and ranking changes have separate validation evidence.
- [ ] Documentation identifies the graph, store, owner, and retrieval surface for each operation.
- [ ] Recovery does not delete canonical knowledge.
- [ ] Remaining work and validation limits are recorded accurately.

**Operating rule: prove preservation and correctness first; measure usefulness second; optimize only within those established contracts.**
