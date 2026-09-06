# Monomind memory knowledge graph review

Reviewed 5 September 2026. Scope: **the memory knowledge graph**, its memory bridge, public retrieval/ingestion adapters, org integration, and relevant document-index boundaries. Companion: [graph boundaries and terminology](graph-boundaries-review-2026-09-05.md). Monograph's parser and code graph are outside this review.

**Assessment: a useful lightweight graph over persistent memory, but not yet a dependable source of correctable, scoped, evidence-backed knowledge.** The highest-value work is explicit ownership, honest persistence results, reliable provenance/rollback, stable identity, and complete retrieval. More embeddings or graph algorithms will not repair those fundamentals.

## Current status at review close

Concurrent commit `020aaba38` fixed the core unchecked-write counters and the two basic multi-origin rollback cases described below. Its new three-test provenance suite passed, and the updated source failure probe now verifies `success:false` with zero accepted writes. These improvements were made outside this report task; **K1 and K3 retain historical evidence but are marked partially resolved**, with remaining adapter, atomicity, and richer provenance work separated below. Other findings remained applicable at the checked cutoff `e4d225b9b`.

## Mechanism reviewed

1. A caller supplies entities, relations, and/or rules through `memory_kg_ingest` or `org_learn`. `rawText` can use local regex/co-occurrence extraction. Task hooks also write causal/outcome relationships.
2. Entity keys are `n:<normalized-name>`; edge keys combine endpoint keys and a normalized relation. Entries are stored through the memory bridge in `kg:nodes`, `kg:edges`, and `rules`. Entity/rule content can be embedded; edges explicitly disable embedding generation.
3. Re-ingestion merges by name, retains the longer entity description and an existing non-generic type, accumulates up to 100 origins, and upserts the memory entry.
4. Rules are deduplicated using semantic score provenance when available, otherwise normalized exact text. Accepted rules are written both as plain rules and as KG entities.
5. `kgSearch` retrieves up to 15 entity seeds, scans at most 10,000 edge entries, and ranks edges incident to those seeds. It is one-hop entity-seeded triplet retrieval, with a useful standalone-entity fallback; it is not arbitrary multi-hop graph reasoning.
6. `knowledge_search` can fuse triplets with documents, rules, and patterns using reciprocal rank fusion. Org memory uses a separate store and separate adapters.
7. Rollback scans nodes, edges, and rules by origin. Consolidation returns candidates for the live agent to rewrite; the graph module does not independently run a fact-checking model.

Sources: [memory-kg.ts](../../packages/@monomind/cli/src/memory/memory-kg.ts), [bridge](../../packages/@monomind/cli/src/memory/memory-bridge.ts), [MCP](../../packages/@monomind/cli/src/mcp-tools/memory-tools.ts#L317), [org learning](../../packages/@monomind/cli/src/orgrt/org-memory.ts#L186).

## What is good

- **Reusing local memory infrastructure is economical.** Persistence, embeddings, keyword fallback, and metadata do not require another service. Keep this unless measured scale requires a specialized store.
- **Entity-seeded relationship retrieval adds context beyond isolated text hits.** The simple one-hop strategy is understandable and can be tested against a small benchmark.
- **Explicit ingestion separates extraction from storage.** Caller-provided structured claims can be validated before becoming durable knowledge; the current boundary needs stronger validation, but its location is useful.
- **Origins, validity fields, and node sets are present.** These show the right intent for recovery, grouping, and change tracking, even though the current lifecycle is incomplete.
- **Rule deduplication checks score provenance.** It correctly avoids treating a normalized keyword score as semantic equivalence. [Dedup guard](../../packages/@monomind/cli/src/memory/memory-kg.ts#L368)
- **The bridge reports actual retrieval method and fallback reasons.** Its handling of semantic versus keyword search has focused tests. The KG layer should preserve that information. [Bridge search result](../../packages/@monomind/cli/src/memory/memory-bridge.ts#L746)
- **Rank fusion avoids comparing unlike raw scores.** Combining ranked document/rule/memory lists is a sensible baseline. [RRF](../../packages/@monomind/cli/src/memory/query-router.ts#L170)
- **Scoped stores and feedback machinery already exist.** Correcting the KG's use of them is more valuable than replacing the backend wholesale.

## Findings and recommendations

P1 means incorrect persistence, ownership, or knowledge lifecycle; P2 means retrieval quality, completeness, or maintainability. Evidence labels distinguish actual-backend reproduction, source probes with a mocked bridge boundary, and static source findings.

### K1 — P1, partially resolved: Persistence results must remain honest through adapters

**Baseline defect, reproduced with a mocked bridge boundary; core counters fixed in `020aaba38`.** Returning `{success:false, error:…}` from every storage call still produced graph `success:true`, `nodesAdded:1`, and an accepted rule, while zero entries were persisted.

`kgIngest` and `kgIngestRules` previously ignored returned store status. They now check refused/null writes, return failure details, and count confirmed persistence. The bridge legitimately returns `null` or `success:false`. **Remaining:** search/list failures can still become successful empty results or zero counts. Per-rule verdict entries still say `accepted` even when the aggregate accepted count is zero after a rejected write. `learnOrgKnowledge` also formats “Recorded” and marks the run learned without checking graph/rule success, which can suppress fallback extraction.

**Change:** use a typed success/failure result end to end. Count confirmed writes, preserve error causes, and distinguish empty from unavailable. Validate the whole payload before writing; use an atomic batch or explicit recoverable ingest state for multi-entry operations. A rule and its KG projection should not diverge silently.

Evidence: [unchecked graph writes](../../packages/@monomind/cli/src/memory/memory-kg.ts#L194), [rule write](../../packages/@monomind/cli/src/memory/memory-kg.ts#L400), [bridge failure contract](../../packages/@monomind/cli/src/memory/memory-bridge.ts#L603), [org success formatting](../../packages/@monomind/cli/src/orgrt/org-memory.ts#L212).

### K2 — P1: Org ownership is not enforced for graph facts

**Source-confirmed.** Same-root orgs share a store and fixed KG namespaces. Graph identity, search, glossary, rules, and rollback do not include org identity, despite org-specific command names and responses. Flat org memories use a different, genuinely namespaced scheme.

**Change:** enforce project/org scope in storage identity and every query. Make shared knowledge an explicit promotion policy. Include scope in provenance and feedback identifiers. See [B2 in the boundaries report](graph-boundaries-review-2026-09-05.md#b2--for-an-org-does-not-match-kg-storage-and-query-scoping) for the full call chain and acceptance tests.

Evidence: [org store](../../packages/@monomind/cli/src/orgrt/org-memory.ts#L15), [learning call](../../packages/@monomind/cli/src/orgrt/org-memory.ts#L199), [CLI operations](../../packages/@monomind/cli/src/commands/org.ts#L2153).

### K3 — P1, partially resolved: Provenance needs reversible source contributions

**Baseline defects reproduced against the actual backend in an isolated store. Both basic cases are addressed by `020aaba38`: dedup adds origin support and rollback rewrites remaining origins. The new source regression suite passed. The table records the earlier behavior, not the current expected result.**

| Sequence | Observed result | Required behavior |
|---|---|---|
| Rule learned from A, identical rule learned from B, rollback A | B was `already_known` without adding provenance; rollback deleted the rule and KG node | Retain knowledge supported by B |
| Entity learned from A and B, rollback A, rollback B | Both calls retained the entity; origins remained `[A,B]` | Remove each withdrawn support and delete unsupported claims |

**Remaining:** origins are still capped with `slice(-100)`, losing older provenance. Generic refs such as `hooks-post-task` and `causal-edge-tool` group unrelated operations, limiting rollback precision. A merged entity retains only one selected description, so origins alone cannot reconstruct the prior correct description after withdrawing a bad update.

**Change:** model source support explicitly, with stable source/revision IDs and per-claim contributions. Preserve the newly fixed support addition/removal behavior. Extend rollback to reconstruct surviving descriptions/claims from source contributions, rather than only editing an origin list. Replace generic origin strings with unique task/session/run refs. Do not silently truncate provenance.

Evidence: [origin merge](../../packages/@monomind/cli/src/memory/memory-kg.ts#L183), [dedup skip](../../packages/@monomind/cli/src/memory/memory-kg.ts#L387), [rollback](../../packages/@monomind/cli/src/memory/memory-kg.ts#L654), [task origin](../../packages/@monomind/cli/src/mcp-tools/hooks-routing.ts#L920), [causal tool origin](../../packages/@monomind/cli/src/mcp-tools/memory-tools.ts#L305).

### K4 — P1: Name-only identity and “longer wins” cannot reliably represent corrections

**Reproduced in source probes.** `Person:Alex` and `Service:Alex` have the same key. Names differing after 200 normalized characters also collide. Re-ingesting “Now PostgreSQL” after a longer MySQL description leaves the old MySQL description in place. Rules additionally truncate their key to 120 characters.

Name-only merging prevents duplicate entities caused by inconsistent type labels, but it also merges distinct things that happen to share a name. Description length measures verbosity, not truth. `valid_from`/`valid_to` fields do not constitute a version history: ordinary updates overwrite entries and keep `valid_to:null`. Contradictions have no explicit representation.

**Change:** introduce stable scoped entity IDs with aliases, and treat same-name matches as candidates. Preserve the full identity tuple or hash it without truncating away distinctions. Store claims separately from entity summaries. Support explicit correction/supersession, conflict status, and source revisions. Consolidation should accept a shorter, better-supported summary.

Evidence: [normalization/key](../../packages/@monomind/cli/src/memory/memory-kg.ts#L128), [merge policy](../../packages/@monomind/cli/src/memory/memory-kg.ts#L187), [rule key](../../packages/@monomind/cli/src/memory/memory-kg.ts#L399), [consolidation](../../packages/@monomind/cli/src/memory/memory-kg.ts#L742).

### K5 — P1/P2: Upserts invalidate feedback IDs and concurrent merges are not atomic

**Feedback failure reproduced against the actual backend.** Retrieve an entity, ingest it again, then rate the previously returned ID: the ID changed and feedback returned `success:true, applied:0`.

The bridge generates a new entry ID on each upsert, stores the new entry, then deletes the previous entry. KG read/merge/write is also a sequence of awaited operations with no compare-and-swap or transaction around provenance accumulation. Concurrent lost updates are a source-level risk, not reproduced here.

**Change:** update existing identities in place or use stable logical IDs resolved to current versions by the feedback API. Make provenance/metadata merge atomic. Explain skipped feedback IDs and preserve learned weights/history across revisions. Return graph claim/edge IDs so an incorrect relationship can be rated directly, rather than only its seed entity.

Evidence: [new ID and upsert](../../packages/@monomind/cli/src/memory/memory-bridge.ts#L636), [store/delete sequence](../../packages/@monomind/cli/src/memory/memory-bridge.ts#L701), [KG merge](../../packages/@monomind/cli/src/memory/memory-kg.ts#L180), [search result IDs](../../packages/@monomind/cli/src/memory/memory-kg.ts#L584).

### K6 — P2: Valid knowledge disappears between retrieval layers

**Reproduced in source probes and actual-backend search.**

- An isolated entity returns useful `kgSearch.context` and a seed, but MCP `knowledge_search` with `surfaces:['kg']` returns zero results because it fuses only triplets.
- `nodeSet` filtering occurs after the top-15 seed cutoff. A matching node outside those 15 candidates is missed rather than retrieved within its set.
- Search returns type `shared_service` for a node whose stored type is `Service`, because it parses the name-only key as though it included type.

**Source-confirmed:** org recall skips KG entirely if no flat memories match. Consolidated graph results discard source origins, stable edge IDs, bridge retrieval method, and fallback diagnostics. A keyword fallback can still be presented by the KG API as vector-seeded search.

**Change:** retain standalone entities as a result kind; apply scope/set filters before ranking; return typed metadata instead of parsing display strings; search independent surfaces independently. Expose retrieval mode, support refs, claim IDs, partial failures, and truncation in one shared result contract.

Evidence: [seed cutoff/filter](../../packages/@monomind/cli/src/memory/memory-kg.ts#L532), [type parsing](../../packages/@monomind/cli/src/memory/memory-kg.ts#L584), [triplet-only fusion](../../packages/@monomind/cli/src/mcp-tools/knowledge-tools.ts#L197), [org early return](../../packages/@monomind/cli/src/orgrt/org-memory.ts#L117).

### K7 — P2: The 10,000-entry limit is a silent completeness boundary

**Source-confirmed, plus a mocked-list probe.** Search, stats, rollback, glossary, and consolidation read a capped page. `bridgeListEntries.total` is the returned page length, not a database count. A 10,001-node fixture therefore reported 10,000. Edges or origins outside the scanned page are invisible to relevant operations.

**Change:** add indexed adjacency and origin lookup, and real count queries. Until then, paginate using the bridge's existing offset support and explicitly return `truncated`/`partial`. Rollback must cover all matching entries or report an incomplete operation. Use a cursor or stable ordering when deleting while paginating to avoid skipped rows.

Evidence: [MAX_LIST](../../packages/@monomind/cli/src/memory/memory-kg.ts#L38), [edge scan](../../packages/@monomind/cli/src/memory/memory-kg.ts#L549), [stats](../../packages/@monomind/cli/src/memory/memory-kg.ts#L798), [page-length total](../../packages/@monomind/cli/src/memory/memory-bridge.ts#L1192).

### K8 — P1/P2: Graph integrity and input validation are incomplete

**Reproduced in a source probe.** Edge-only ingestion with nonexistent endpoint names succeeds with zero nodes and one edge. Because retrieval is seeded from nodes, that fact is not ordinarily discoverable through its absent endpoints.

The public arrays declare only generic objects, then cast to `any[]`. Invalid later items can fail after earlier writes. Nodes/edges/rules over per-call caps are silently sliced. No graph-specific foreign-key contract validates endpoint existence, and rollback can leave edges with removed endpoints when their origins differ.

**Change:** validate complete nested payloads before mutation; require existing endpoints or create explicit placeholder entities atomically; report accepted/rejected/truncated counts. Validate relations, origin scope, and finite numeric options. Add integrity checks for dangling endpoints and mismatched rule projections. This is a correctness finding; no exploit or security breach was demonstrated.

Evidence: [generic MCP schema](../../packages/@monomind/cli/src/mcp-tools/memory-tools.ts#L324), [capped nodes and edges](../../packages/@monomind/cli/src/memory/memory-kg.ts#L173), [endpoint key fallback](../../packages/@monomind/cli/src/memory/memory-kg.ts#L241).

### K9 — P2: Ranking and “learning” need evidence of usefulness, not just more graph content

**Source-confirmed.** Triplet ranking averages seed scores with a `0.35` floor and a bonus when both endpoints are seeded. It does not evaluate the relation/fact against the query, source credibility, contradictory support, or claim freshness. The KG response drops whether seed scores were semantic or keyword. Heuristic co-occurrence is described as lower-trust, but KG input/storage does not preserve an explicit extraction-method/confidence field for consumers to distinguish it.

The glossary favors version count, frequency, and feedback; repeated ingestion can raise prominence without adding better evidence. Consolidation measures description length against edge count. Neither is a truth measure. Org recall records flat-memory IDs for usage/feedback but does not add graph seed IDs when appending KG context.

**Change:** record extraction method and support evidence, distinguish `mentioned_with` from an asserted factual relation, and preserve explicit uncertainty. Evaluate entity recall, relevant-triplet precision, contradiction handling, isolated entities, and abstention. Make reinforcement depend on the specific claims used and verified. Keep one-hop traversal until a multi-hop benchmark demonstrates value.

Evidence: [triplet score](../../packages/@monomind/cli/src/memory/memory-kg.ts#L568), [glossary rank](../../packages/@monomind/cli/src/memory/memory-kg.ts#L632), [consolidation criterion](../../packages/@monomind/cli/src/memory/memory-kg.ts#L783), [heuristic extraction](../../packages/@monomind/cli/src/memory/memory-kg.ts#L806), [org feedback tracking](../../packages/@monomind/cli/src/orgrt/org-memory.ts#L122).

### K10 — P1 adjacent finding: Partial document ingestion can permanently skip missing chunks

**Reproduced with the real document pipeline and mocked storage failure.** A multi-chunk document whose first chunk stores and remaining chunks fail returns one indexed chunk without an error. A healthy retry sees the saved content hash and skips ingestion, leaving missing chunks unrepaired.

This is in the document index, not the entity graph, but it affects combined knowledge retrieval and reinforces why the two must be diagnosed separately. The pipeline only treats total storage failure as an error; any nonzero success records the document hash.

**Change:** commit document version metadata only after all chunks succeed, or persist a partial status with retryable missing chunk IDs. Preserve the previous usable version until replacement is complete. Test total failure, partial failure, retry, and document revision/removal.

Evidence: [hash skip](../../packages/@monomind/cli/src/knowledge/document-pipeline.ts#L549), [chunk writes and metadata](../../packages/@monomind/cli/src/knowledge/document-pipeline.ts#L565), [total-failure-only error](../../packages/@monomind/cli/src/knowledge/document-pipeline.ts#L608).

## What to add, simplify, or remove

| Keep | Add or improve | Remove or replace |
|---|---|---|
| Local SQLite-backed memory bridge | Stable scoped entity/claim/source IDs; atomic writes and merges | Name-only identity as the sole identity rule |
| Lightweight one-hop retrieval | Standalone-entity results, filtered retrieval, indexed adjacency/origin queries | Silent list caps and misleading complete/success responses |
| Explicit caller-supplied extraction | Validated claim schema, evidence refs, extraction method, correction/supersession | “Longer description wins” as a correctness rule |
| Corrected origin reinforcement and withdrawal | Per-claim support ledger and complete rollback | Truncated support history and generic rollback origins |
| Rank fusion and keyword fallback | Shared result contract and quality fixtures for actual consumers | Parsing metadata from rendered text and synthetic non-rateable graph IDs |
| Separate code and memory stores | Explicit evidence links between code/docs and remembered claims | Product wording that treats all “knowledge” as one graph |

Do not add a standalone graph database, automatic multi-hop reasoning, or another embedding model merely to make the system look more graph-oriented. First measure workload and retrieval failures after correcting the lifecycle. If adjacency scans become material, indexed SQLite tables for entities, claims, and support are a straightforward candidate. Migration should preserve source history and stable references.

## Suggested implementation order and acceptance criteria

1. **Ownership and honest writes:** scope all org KG operations; check nested results; validate batches. Rejected persistence must never report accepted knowledge, and two orgs must remain independent.
2. **Identity and reversible knowledge:** stable IDs, atomic merges, source support, correction/supersession, reliable rollback. Re-ingestion must preserve feedback references; rollback A then B must behave correctly in both orders.
3. **Retrieval completeness:** isolated entities, node-set filtering, metadata/types, real counts, pagination/indexed adjacency, method/error propagation. Every test fixture should be reachable through the public surface that claims to search it.
4. **Evaluation and simplification:** benchmark semantic and keyword modes separately; assess relationship precision, supported answers, stale/contradictory facts, and token/latency cost. Unify adapters and document the verified behavior.

## Validation, reproducibility, and limits

| Check | Outcome |
|---|---|
| Existing `tests/memory/cognee-port-eval.test.mjs`, built CLI, embeddings disabled | 7 tests: **5 passed, 2 skipped**; no semantic-quality claim |
| Existing source suites: `knowledge-mcp-parity`, `memory-retrieval-quality`, `memory-search-method-honesty` | Across appropriate configurations: **19 passed, 2 skipped** |
| Temporary source-level probes with mocked memory bridge | Baseline: **8 defects reproduced**. After `020aaba38`: **8 checks passed**, comprising one honest-write fix verification and seven remaining defect reproductions |
| Temporary actual-backend probe, baseline built CLI | Reproduced both historical multi-origin rollback defects, wrong returned entity type, changing upsert IDs, and feedback applying to zero entries after upsert |
| New source `memory-kg-provenance.test.ts` from concurrent fix | **3 passed**: rejected-write status, rule surviving one origin withdrawal, deletion after both withdrawals |

Commands for reproducing the existing checks:

```bash
MONOMIND_NO_LOCAL_EMBEDDINGS=1 node --test tests/memory/cognee-port-eval.test.mjs
# From packages/@monomind/cli; keyword fixtures:
MONOMIND_NO_LOCAL_EMBEDDINGS=1 MONOMIND_RERANKER=0 ../../../node_modules/.bin/vitest run src/__tests__/knowledge-mcp-parity.test.ts src/__tests__/memory-retrieval-quality.test.ts
# Mocked-embedding contract test needs its embedder enabled:
env -u MONOMIND_NO_LOCAL_EMBEDDINGS MONOMIND_RERANKER=0 ../../../node_modules/.bin/vitest run src/__tests__/memory-search-method-honesty.test.ts
```

The first combined source-suite run incorrectly disabled embeddings for the test that supplies a mock embedder, producing three failures. Rerunning that suite with the override removed passed all five tests; those harness-induced failures are not reported as product defects. The initial eight custom probes asserted observed problematic behavior; their passing count was evidence of reproduction, not correctness. After the concurrent fix, the write-failure probe was changed to assert the corrected behavior; the other seven still reproduced their findings.

Actual-backend probes used a temporary global-brain directory and `dbPath:'@global'`, then shut down the bridge and deleted the fixture. Mocked probes used `/tmp/monomind-kg-review/`; no live KG ingestion or rollback was performed. Existing tests use their own isolated stores. This report task applied no implementation fixes or production data migrations; the concurrent implementation commits are identified separately.

The review began at baseline `dd93c6558`. At close, memory changes in `020aaba38` were inspected and their targeted tests run; cutoff `e4d225b9b` also included concurrent Monograph fixes, outside this review. Findings K1 and K3 explicitly distinguish the baseline reproductions from the new fixes. Source probes exercised TypeScript directly; existing Node eval and the backend probe exercised built CLI modules. Real-model semantic retrieval, concurrent-writer races, production-scale load, every platform's helper deployment, and security exploitation were not tested. Recommendations concerning those areas are explicitly source/design findings, not demonstrated runtime failures.
