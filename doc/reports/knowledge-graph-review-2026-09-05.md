# Monomind knowledge graph review

Reviewed 5 September 2026 at commit `dd93c65586c504c4374ace22d3a50f7e7d3ab777`. Scope: Monograph extraction, persistence, updates, search, graph analysis, CLI/MCP adapters, and the boundary with the separate memory knowledge graph. This is a review report; no implementation fixes were applied.

**Assessment: keep the architecture, but prioritize correctness and consistent tool behavior before adding more graph features.** Local SQLite storage, deterministic parsing, source locations, and dependency traversal are useful foundations. The main weakness is that successful builds and plausible tool responses do not reliably mean the graph is complete or correctly interpreted. Reproduced failures affect symbol identity, incremental dependencies, recovery after failed builds, document retention, and ranking.

## How the mechanism works

There are two distinct graph mechanisms:

| Mechanism | Data and persistence | Retrieval and purpose |
|---|---|---|
| **Monograph** | Repository files become symbols, files, documents, routes, tools, and process nodes in `.monomind/monograph.db`; edges represent containment, calls, imports, references, and other relationships. A separate disk extraction cache accelerates parsing. | FTS5 trigram/BM25 identifier and path search, optional graph expansion, context/impact traversal, communities, reports, and editor/agent tools. |
| **Memory knowledge graph** | Entities, relationships, and rules are stored through the memory bridge in dedicated namespaces, with origin metadata. | Memory search seeds graph expansion into relationship triplets. Rule deduplication and per-origin rollback serve persistent agent knowledge. |

Monograph's full pipeline scans files, loads Tree-sitter parsers, extracts symbols, resolves relationships, derives communities/processes, and commits SQLite changes. The incremental implementation reparses changed code files through a shorter path. A watcher schedules updates and an eventual full rebuild. MCP query/suggest tools can also launch a background rebuild based on Git commit distance.

Sources: [pipeline](../../packages/@monomind/monograph/src/pipeline/orchestrator.ts#L190), [schema](../../packages/@monomind/monograph/src/storage/schema.ts#L1), [memory graph](../../packages/@monomind/cli/src/memory/memory-kg.ts), [MCP refresh](../../packages/@monomind/cli/src/mcp-tools/monograph/shared.ts#L282).

## What is good and should stay

- **Embedded storage fits the job.** SQLite supports indexed relationships and FTS without a separate graph service. WAL, foreign keys, a busy timeout, and recursive FTS triggers address real operational problems. Keep this foundation. [Database setup](../../packages/@monomind/monograph/src/storage/db.ts#L42)
- **Deterministic parsing and navigable results are valuable.** Tree-sitter extraction, language-specific handling, and file/line references give agents evidence they can verify directly. Keep parsing as the basis for code facts. [Extractor](../../packages/@monomind/monograph/src/parsers/extractor.ts#L7)
- **The full build has meaningful recovery safeguards.** A cross-process build lock and one SQL transaction prevent many concurrent-write and partial-build failures. These are good investments, although the separate cache currently escapes the transaction. [Lock](../../packages/@monomind/monograph/src/pipeline/orchestrator.ts#L55), [transaction](../../packages/@monomind/monograph/src/pipeline/orchestrator.ts#L169)
- **The model supports more than text search.** Calls, imports, inheritance, re-exports, routes, tools, and process membership can answer useful questions about dependencies and execution structure. Preserve these relationships and make their completeness measurable. [Impact traversal](../../packages/@monomind/monograph/src/mcp-tools/impact.ts#L55), [context](../../packages/@monomind/monograph/src/mcp-tools/context.ts#L78)
- **Confidence and evidence already have a place in the schema.** This creates a foundation for distinguishing extracted facts from inferred relationships. More consumers should use and expose these fields. [Edge schema](../../packages/@monomind/monograph/src/storage/schema.ts#L19)
- **There is substantial regression coverage.** The package suite passed **180 files / 1,208 tests** during this review. The issue is missing lifecycle and adapter invariants, rather than an absence of tests.
- **Advanced MCP capabilities are gated.** The registry separates 19 default tools from 27 advanced tools, limiting default exposure. Retain that separation while reviewing which defaults agents actually use. [Registry](../../packages/@monomind/cli/src/mcp-tools/monograph/index.ts#L78)
- **Memory deduplication distinguishes semantic scores from keyword scores.** It avoids treating a normalized keyword result as proof of semantic equivalence. That distinction should be preserved across other retrieval paths. [Rule deduplication](../../packages/@monomind/cli/src/memory/memory-kg.ts#L281)

## What should be improved

Priority meanings: **P1** = fix first because stored facts or returned answers can be wrong; **P2** = reliability, transparency, or quality improvement after the core failures. “Reproduced” means an isolated runtime probe demonstrated the behavior. “Source-confirmed” means the relevant implementation was traced, without a complete runtime reproduction.

### 1. P1 — Make symbol identity collision-resistant

**Reproduced.** Parsing `a-b.ts` and `a_b.ts` can emit identical IDs. Within one file, `First.run` and `Second.run` both produce the same method ID, such as `a_b_ts_run_method`.

`makeId` replaces punctuation and lowercases every component; the extractor uses file/name/kind without the enclosing lexical scope. SQLite upserts then cannot represent both symbols independently. Calls and containment can attach to the wrong surviving symbol.

**Change:** encode the exact repository-relative path, qualified lexical scope, symbol kind, and an overload discriminator where needed. Hash a canonical structured tuple if compact IDs are necessary. Version this identity scheme and invalidate/rebuild dependent caches and edges when it changes.

Evidence: [ID normalization](../../packages/@monomind/monograph/src/types.ts#L236), [extractor identity](../../packages/@monomind/monograph/src/parsers/extractor.ts#L19), [method ID construction](../../packages/@monomind/monograph/src/parsers/extractor.ts#L81).

### 2. P1 — Make cache recovery consistent with database recovery

**Reproduced.** Injecting a failure after parsing rolls back SQL, but a normal retry can succeed with **zero nodes**. Deleting only the database while retaining the parse cache similarly causes a subsequent build to omit code symbols.

The parser flushes its disk cache before the SQL transaction commits. A later cache hit assumes those nodes already exist in SQLite and inserts only freshly parsed ranges. That assumption is false after rollback or database replacement.

**Change:** treat cached extraction as reusable input that can repopulate storage. Alternatively, bind cache reuse to a committed database generation and invalidate it on rollback or replacement. Add failed-build → retry and database-recreation tests; checking rollback alone misses this failure.

Evidence: [cache flush and insertion shortcut](../../packages/@monomind/monograph/src/pipeline/phases/parse.ts#L146), [SQL commit/rollback](../../packages/@monomind/monograph/src/pipeline/orchestrator.ts#L311).

### 3. P1 — Preserve dependency correctness during incremental updates

**Reproduced.** A fixture with `foo`, an importing/calling `bar`, and a README reference initially had one `CALLS`, one `IMPORTS`, and one `REFERENCES` edge. Changing only `foo`'s body and running incremental build removed all three. Process-step edges also changed from two to one.

Incremental processing deletes edges incident to the changed file and reparses that file, but does not rerun the full relationship-resolution and derived-analysis pipeline. The watcher's deferred full rebuild can repair the graph later; direct incremental callers can retain the incomplete graph.

**Change:** until parity is established, use the full pipeline with extraction-cache reuse. A future incremental implementation should track affected dependents and recompute their relationships, plus invalidate affected derived analyses. Require clean-build and incremental-build equivalence on canonicalized nodes and edges.

Evidence: [incremental deletion](../../packages/@monomind/monograph/src/pipeline/orchestrator.ts#L389), [limited reinsertion and commit](../../packages/@monomind/monograph/src/pipeline/orchestrator.ts#L449).

### 4. P1 — Preserve index scope during automatic refresh

**Reproduced in a fixture and observed live.** The initial MCP query returned Document nodes and reported an index 22 commits behind HEAD. Its background refresh later produced a current-HEAD graph with **30,224 nodes, 52,291 edges, and no Document nodes**.

The automatic refresh uses `{ codeOnly: true }`. The full-build orphan sweep considers files missing from that restricted scan obsolete, so it deletes previously indexed documents even though the files remain on disk.

**Change:** persist the index's source-selection configuration and reuse it during refresh. If partial builds are supported, delete obsolete rows only within the selected source domain. Refresh must not silently narrow graph coverage. Expose the active scope in stats and refresh results.

Evidence: [automatic code-only build](../../packages/@monomind/cli/src/mcp-tools/monograph/shared.ts#L282), [orphan sweep](../../packages/@monomind/monograph/src/pipeline/orchestrator.ts#L232).

### 5. P1 — Consolidate ranking and fix the legacy environment branch

**Reproduced.** With the seed transformation used by `MONOGRAPH_EMBEDDINGS=true`, an unrelated neighboring document ranked above an exact symbol match: the neighbor scored `0`, while the match scored approximately `-0.656`.

`bm25Query` returns SQLite's negative ranks. This branch forwards them into a reranker expecting higher positive scores; the default branch uses `Math.abs`. Both branches are lexical: vector retrieval was removed. Meanwhile the package-level query tool uses a different BM25/LIKE/fuzzy combination from the CLI-hosted MCP tool.

**Change:** define one score convention and one query service, with explicit retrieval modes used by every adapter. Remove the obsolete environment-dependent branch and correct its tool description. Add adapter-parity tests, including short identifiers, phrases, diacritics, no hits, and environment settings.

Evidence: [negative score return](../../packages/@monomind/monograph/src/search/hybrid-query.ts#L59), [divergent environment branch](../../packages/@monomind/cli/src/mcp-tools/monograph/query-tools.ts#L136), [package query implementation](../../packages/@monomind/monograph/src/mcp-tools/query.ts#L68).

### 6. P2 — Make graph expansion bounded, filter-preserving, and accurately named

**Reproduced:** a query seeded with `label: Function` returned a `Document` after reranking. **Source-confirmed:** `applyPprRerank` performs one outgoing hop and takes the maximum propagated score; it does not perform iterative personalized PageRank. It ignores edge confidence, relation type, and degree normalization.

**Change:** call the current operation “neighbor expansion,” reapply result filters, validate damping, and cap expanded nodes/edges. Separate direct matches from supporting context. Evaluate relation/confidence weighting against a retrieval benchmark before introducing a more complex algorithm. Do not label a direct seed as solely a BM25 match if its displayed score was raised through neighbors.

Evidence: [reranking implementation](../../packages/@monomind/cli/src/mcp-tools/monograph/shared.ts#L73), [result annotations](../../packages/@monomind/cli/src/mcp-tools/monograph/query-tools.ts#L84).

### 7. P1 — Scope PageRank caches to connection lifetime and graph generation

**Reproduced.** Calling `pageRank`, closing the database, and opening another database with the same name caused `TypeError: The database connection is not open`. Requests with damping `0` followed by `0.85` also returned the same cached result object.

Prepared statements are cached by database name rather than connection. Result keys use name and node/edge counts, omitting algorithm options and topology revisions. A graph can change without its counts changing.

**Change:** use a connection-keyed `WeakMap` for statements and include graph generation plus algorithm options in result keys. Invalidate on writes/close as appropriate. Avoid exposing mutable shared cache results.

Evidence: [statement cache](../../packages/@monomind/monograph/src/graph/pagerank.ts#L22), [result key](../../packages/@monomind/monograph/src/graph/pagerank.ts#L55), [cache lookup](../../packages/@monomind/monograph/src/graph/pagerank.ts#L100).

### 8. P1/P2 — Enforce typed contracts between the graph library and MCP output

**Source-confirmed.** Several adapters misinterpret valid library results:

| Tool | Mismatch | Consequence |
|---|---|---|
| Rename, advanced | Library returns `changes`; adapter reads `occurrences` or `references`. | It reports zero occurrences even when changes exist. |
| Context | `community` is an object; adapter interpolates it as text and omits `inProcesses`. | Community renders as `[object Object]`; advertised process context disappears. |
| Impact | Counts `affectedFiles` as “symbols” and recomputes risk labels with different thresholds. | Counts and severity disagree with the library. |

**Change:** remove `any` casts at these boundaries, render the actual result types, and return structured data alongside readable text. Test the registered MCP handlers, not just underlying functions. Preserve source locations, confidence, truncation, and error state.

Evidence: [rename result](../../packages/@monomind/monograph/src/mcp-tools/rename.ts#L9), [rename adapter](../../packages/@monomind/cli/src/mcp-tools/monograph/impact-tools.ts#L592), [context adapter](../../packages/@monomind/cli/src/mcp-tools/monograph/query-tools.ts#L392), [impact adapter](../../packages/@monomind/cli/src/mcp-tools/monograph/impact-tools.ts#L64), [library risk levels](../../packages/@monomind/monograph/src/mcp-tools/impact.ts#L10).

### 9. P2 — Make freshness, ambiguity, and completeness explicit

**Source-confirmed.** Commit-based freshness misses uncommitted edits, and Git-unavailable paths can report `isStale: false`. The optional skip-when-fresh build guard relies on this result. Several symbol tools select the first matching name; neighbors has no file-path disambiguation. Neighbor/context queries also cap results without reporting the underlying total.

**Change:** distinguish `fresh`, `stale`, `building`, `partial`, and `unknown`; include indexed revision, source scope, dirty-worktree status, parser warnings, and last refresh error. Prefer node IDs; return candidates for ambiguous names. Report limits and truncation explicitly. Make graph-first guidance permit ordinary code search when coverage or freshness is inadequate.

Evidence: [staleness](../../packages/@monomind/monograph/src/staleness/git-staleness.ts#L13), [build skip guard](../../packages/@monomind/monograph/src/pipeline/orchestrator.ts#L129), [neighbor selection and cap](../../packages/@monomind/monograph/src/mcp-tools/neighbors.ts#L29).

### 10. P2 — Analyze the graph that was actually built

**Source-confirmed.** Community analysis builds its graph from raw parse edges and cross-file output. Waiting for later resolution phases does not mean it consumes their edges. Important resolved calls/imports and other relationship families can therefore be absent from the clustering input.

**Change:** derive community input from the committed canonical graph or a clearly specified shared graph snapshot. Explicitly select relation families and weights. Measure whether clusters reflect package/runtime boundaries before presenting them as architecture. Distinguish structural connectivity scores from software-quality judgments.

Evidence: [community inputs](../../packages/@monomind/monograph/src/pipeline/phases/communities.ts#L106).

### 11. P1 — Make memory-graph write results and provenance trustworthy

**Source-confirmed; not runtime-reproduced in this review.** Ingest paths ignore unsuccessful/null `bridgeStoreEntry` results. Deduplicating a rule skips adding the new origin. Rolling back the first origin can then delete independently reinforced knowledge. Conversely, shared-origin rollback retains the removed origin, so sequential rollbacks can retain knowledge whose sources were all withdrawn.

**Change:** check every bridge result, return partial/failure state accurately, and make ingest atomic where supported. Record all supporting origins, remove withdrawn support, and delete claims when no active origin remains. Add storage-failure, duplicate-from-two-origins, and sequential-rollback tests.

Evidence: [unchecked writes](../../packages/@monomind/cli/src/memory/memory-kg.ts#L130), [deduplication and rule write](../../packages/@monomind/cli/src/memory/memory-kg.ts#L300), [rollback](../../packages/@monomind/cli/src/memory/memory-kg.ts#L491).

## What should be added

These additions address the observed gaps rather than expanding the tool catalog:

1. **A graph correctness suite:** clean/cached/incremental equivalence; failed-build retry; database recreation with a retained cache; rename/delete/add sequences; path/scope collisions; and mixed code/document refresh. Run the same fixtures through public adapters.
2. **A small retrieval evaluation set:** exact names, ambiguous names, natural-language tasks, document questions, and dependency questions. Track recall at k, rank of the first useful result, false dependency rate, latency, and output tokens. Compare BM25 alone with expansion and fuzzy reranking.
3. **An index manifest:** graph generation, parser and identity versions, scan/config fingerprint, source hashes, skipped/failed files, refresh status, and timings. This should drive cache validity and user-visible completeness.
4. **Evidence-aware graph responses:** canonical node IDs, edge relation/confidence, source locations, direct-match versus contextual-neighbor provenance, and truncation. Preserve uncertainty through impact and architecture summaries.
5. **Targeted memory edge/origin lookup:** replace capped namespace scans with indexed or paginated adjacency/origin queries; expose truncation during transition. The memory graph currently caps list operations at 10,000 entries, affecting search and rollback coverage. [Memory graph](../../packages/@monomind/cli/src/memory/memory-kg.ts#L386)

## What should be removed or simplified

- **Remove the obsolete `MONOGRAPH_EMBEDDINGS` query branch and vector-search claims.** Keep compatibility aliases only for an explicit deprecation period. Do not automatically restore embeddings; first demonstrate a retrieval gap that justifies them.
- **Replace the separate incremental algorithm with shared pipeline logic** until dependency parity is proven. Cache reuse can still avoid unnecessary parsing.
- **Consolidate duplicated query/ranking and result-formatting implementations.** The observed adapter drift is a direct maintenance cost.
- **Remove “PPR” terminology from the one-hop heuristic**, or implement and evaluate the promised algorithm.
- **Remove unconditional name-only selection for ambiguous symbols.** A request for clarification between candidates is more useful than a confident answer about the wrong node.
- **Audit unused embedding storage and ancillary graph responsibilities before deleting them.** Schema fields/tables remain after vector search removal, but compatibility and external consumers were not exhaustively checked here. Similarly, agent history, skill generation, and visualization should remain modular; this review does not establish that they should be deleted.
- **Correct documentation overclaims.** The concept guide claims freshness guarantees and uses `.monomind/monograph/graph.db`, while the reviewed implementation uses `.monomind/monograph.db`. Describe actual behavior and limitations. [Concept guide](../concepts/monograph.md)

## Recommended delivery order

| Stage | Work | Completion evidence |
|---|---|---|
| 1 — Trust stored facts | Identity, cache/transaction recovery, incremental parity, scope-preserving refresh | All lifecycle fixtures yield equivalent canonical graphs; retries recover without manual cache deletion. |
| 2 — Trust returned answers | Score normalization, query consolidation, PageRank cache lifetime, typed adapters, memory write/provenance fixes | Public-handler tests preserve library data and errors; ranking/filter probes pass; rollback honors active support. |
| 3 — Measure and simplify | Manifest, ambiguity/completeness metadata, retrieval benchmark, community input, redundant paths | Explicit freshness/coverage; benchmarked ranking choices; one shared implementation per behavior. |
| 4 — Expand selectively | Better semantic retrieval or richer analyses only where evaluation shows missing value | Measured improvement against the simpler baseline, with an acceptable latency and maintenance cost. |

## Validation and limits

- Review work was split across extraction/storage reliability, retrieval/MCP behavior, and the memory-graph boundary, then consolidated against source references.
- `../../../node_modules/.bin/vitest run` in `packages/@monomind/monograph` passed: **180 test files, 1,208 tests**. This is package-level validation, not a full-repository build/lint/test certification.
- Temporary isolated probes reproduced ID collisions, dependency loss on incremental update, cache poisoning after rollback/database recreation, code-only document deletion, ranking sign inversion, label leakage, PageRank connection reuse failure, and option-insensitive caching. They did not alter implementation files.
- The initial live MCP query automatically triggered the product's background rebuild. The later 30,224-node / 52,291-edge snapshot is consequently a post-refresh observation, not a baseline preserved from before review.
- Memory-graph findings and adapter shape mismatches were inspected in source. This review did not run a full memory backend failure-injection suite, every supported parser, large-repository benchmarks, or an end-to-end quality evaluation of all advanced tools.
- Passing tests support existing covered behavior; they do not negate the separately reproduced lifecycle failures.
