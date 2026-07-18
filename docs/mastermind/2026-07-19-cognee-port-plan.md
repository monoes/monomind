# Cognee → Monomind: Memory Porting & Upgrade Plan

> **Date:** 2026-07-19 (rev 2, post-adversarial-review) · **Source analyzed:** `/Volumes/media/projects/monoes/others/cognee` (cognee 1.4.0, Apache-2.0)
> **Verdict:** Do NOT port cognee's code (Python, LiteLLM/instructor/LanceDB/Kuzu stack — wrong runtime, heavy deps, cloud-LLM-centric). **Port five of its concepts** into monomind's existing TS stack, where each lands on infrastructure we already have. Cognee's ideas fix exactly the holes our own audit found: write-only feedback, no conversation knowledge graph, cosmetic hierarchical/causal tools, delete-only consolidation, and namespace-only org memory.
> **Review status:** claims verified against both codebases by two adversarial passes (2026-07-19). All mechanism descriptions below survived verification; file citations and phase designs amended per findings (marked ▲).

---

## 1. What cognee actually is (findings)

**Pipeline:** `add` (ingest, content-hash `data_id`, importance_weight) → `cognify` (classify → chunk → LLM entity/edge extraction + summarize → upsert graph+vectors) → `memify` (second-order pipelines that enrich the *existing* graph: feedback weights, frequency weights, entity-description consolidation, session distillation) → `search` (17 retriever types, GRAPH_COMPLETION default).

**Key mechanisms worth stealing:**

| # | Mechanism | Where in cognee | Why it matters |
|---|---|---|---|
| 1 | **Closed feedback loop**: record the exact node/edge IDs used to answer; on 1–5 rating, EWMA-update `feedback_weight` (`w' = w + 0.1·(rating−w)`, clip [0,1]) on those elements; blend into ranking via one `feedback_influence` knob. ▲ Two safety details we must keep: feedback is blended **only for genuine cosine distances in [0,2]** — fallback/penalty scores stay untouched (`CogneeGraph._effective_distance`) — and every applied rating is **stamped idempotent** (`memify_metadata` applied-flags) so retries never double-apply the EWMA | `tasks/memify/apply_feedback_weights.py`, `graph_completion_retriever._extract_context_object_ids`, `CogneeGraph.py:481-503` | Memory that gets *better with use*. Small, self-contained, no LLM needed |
| 2 | **Deterministic entity identity**: `uuid5(NAMESPACE, "ClassName:normalized_name")` — same entity extracted from any chunk/session collapses to the same node. Idempotent merge, zero bookkeeping. ▲ Caveat: this only merges *identical surface forms*; cognee compensates with coreference prompt rules + feeding existing entity names/glossary into extraction + LLM description consolidation | `DataPoint.id_for`, `Entity.identity_fields` | The linchpin of incremental KG building; replaces fragile cosine dedup |
| 3 | **Conversation → knowledge graph**: LLM structured-output extraction (`KnowledgeGraph{nodes,edges}` schema, `generate_graph_prompt.txt`: basic types, coreference resolution, snake_case relations, one-sentence edge facts) + rule distillation. ▲ Rules are deduped **by prompt-injection of existing rules** (Rule has no identity_fields), and the strongest anti-noise device is the **two-stage session distillation**: a *curator* proposes lessons, a *writer* accepts/rejects against similar existing lessons + an entity glossary with explicit reject reasons (`already_known`, `not_durable`, `unsupported`) | `extract_graph_from_data.py`, `cognee-mcp/src/codingagents/coding_rule_associations.py`, `session_distillation_{writer,curator}_system.txt` | We have a code KG (monograph) but **no KG from agent conversations/org runs** — cognee's core value |
| 4 | **Hybrid retrieval**: vector-seed (multi-collection) → project k-hop graph neighborhood → score triplets by summing `(2−importance_weight)·distance` over node1+edge+node2, feedback-blended → top-k triplets rendered as context. Plus RRF fusion (`Σ 1/(rrf_k+rank+1)` × importance factor, **adaptive `rrf_k = max(30, min(60, 20+2·top_k))`**) and a cheap **regex query router** (weighted rules + 20-char negation window + confidence = winner ≥2× runner-up + misroute telemetry) | `brute_force_triplet_search.py`, `CogneeGraph.py:505-538`, `hybrid/ranking.py`, `api/v1/recall/query_router.py` | No PageRank needed; the formulas are ~50 lines |
| 5 | **Org memory as datasets + ACL**: Principal (User/Role/Tenant) + ACL (read/write/delete/share) per dataset; incremental skip via content-hash + per-pipeline status map; **provenance stamping on every write with per-run rollback ledger** | `modules/users/models/*`, `run_tasks_data_item.py`, `infrastructure/databases/provenance/` | Maps to per-agent vs shared org memory; rollback is the primary bad-ingest recovery tool |

**Also present, lower priority:** temporal event graphs (`temporal_cognify=True`, TEMPORAL retriever parses a time window from the query), LLM entity-description consolidation, auto-feedback without human ratings (▲ two real mechanisms: `feedback_detection.py` LLM-scores served context against the user's *next message*, and agent-trace summaries re-cognified as graph nodes — cognee does **not** rate memories from run success/failure), a 4-stage eval harness (HotpotQA/MuSiQue adapters, param sweeps).

**Notably absent in cognee:** time-based decay (no half-life anywhere — "forgetting" is explicit deletion), cross-encoder reranking, PageRank, bitemporal entity versioning.

## 2. Monomind today — the gaps cognee's concepts fill

From the parallel audit of our own stack (all claims re-verified ▲):

- **Two divergent engines**: bridge store A (`packages/@monomind/cli/src/memory/memory-bridge.ts`, backs all MCP `memory_*`/`knowledge_*`/org memory; engine = `@monoes/memory` SQLite backends) and initializer store B (`memory-schema.ts` + JS-HNSW, CLI `memory` cmd only). Store B's `decay_rate`/`importance_score`/`confidence` columns are dead — nothing reads them.
- **Hollow MCP tools** (verified at `memory-bridge.ts:733-1099`): `memory_causal-edge` (write-only JSON rows), `memory_hierarchical-*` (`tier_` namespace prefix only), `memory_feedback` (write-only; **no reader anywhere** — safe to repurpose; input schema is `{taskId, success, quality, agent}`, no entry IDs), `memory_consolidate` (delete-only GC; ▲ pre-existing bug: docs say `minAge` hours, code treats it as ms — fix in Phase 1), `memory_context-synthesize` (string concat). Tool descriptions advertise controllers (ReasoningBank, CausalMemoryGraph…) that don't exist.
- **No conversation/org KG**: monograph is code-only; org runs persist an opaque outcome text via ▲ `storeRunMemory` (`orgrt/daemon.ts:555-580`, called from `stopOrg`); `recallOrgMemory` (`daemon.ts:527-529`) renders text and **discards entry IDs**. ▲ `memory-palace.cjs` is *partially* live: `wakeUp()` injection runs on session-restore (`session-restore-handler.cjs:451`); only its bitemporal KG functions (`kgStore/kgQuery/kgTimeline`, JSON-file based) are unwired — borrow that design, don't delete the file wholesale.
- **Org memory** = a **separate DB** at `<orgRoot>/.monomind/org-memory` (store-A engine) with namespace `org:<name>`, top-5 semantic `org_recall`. No sharing model, no entity structure. ▲ Trap: `bridgeSearchEntries` hard-drops non-`knowledge:*` entries older than `staleDays` (default 7) — org memories currently vanish from recall after a week.
- **ID plumbing reality** ▲: `bridgeSearchEntries` returns entry `id`s; `searchKnowledge`'s `KnowledgeExcerpt` does **not** (drops `r.id` at `document-pipeline.ts:~455`); `org_recall` does **not**. Usage capture requires adding these.
- **Assets we build on** (don't reinvent): local HF embeddings (MiniLM 384-d), SQLite backends, ▲ the CLI-side single-hop PPR-style boost (`monograph-tools.ts:59-107` — hardwired to monograph's schema; needs a small generalization to reuse) + Leiden communities, Second Brain ingest/inject (warm control-server path `/api/knowledge/search` primary, `chunks.jsonl` fallback), org bus (`bus.jsonl` — the extraction source), `.monomind/automem-config.json` for knobs, ▲ LLM access for free via org runtime SDK sessions (subscription auth, no API keys — hooks have **no** LLM path; they can only instruct the live agent).

## 3. The plan

**Principles:** concept port, not code port. TypeScript, local-first (Second Brain constraint: zero decisions, fully local — LLM steps ride the org runtime's subscription-auth SDK sessions or the live agent; heuristic fallback otherwise). Reuse store A + monograph infra. Kill or honestly relabel hollow tools as replacements land. Each phase ships independently.
▲ **Placement rule (publish-lag):** the CLI consumes *published* `@monoes/memory` (`cli/package.json:108`, `^1.0.10`, not workspace:\*). So: **all new code lives in the CLI package** (`packages/@monomind/cli/src/memory/`), and Phase 1 stores weights in the existing `metadata` JSON column instead of new backend columns — zero `@monoes/memory` publish needed for Phases 1–4. (Backend columns via the `user_version` migration hook remain a later optimization; note `sqljs-backend.ts` has no migration mechanism at all.)

### Phase 1 — Close the feedback loop (highest leverage/effort ratio)

Port cognee mechanism #1 onto store A, CLI-side only.

1. **Weights in metadata** ▲: `feedback_weight` (default 0.5) and `frequency_weight` (default 0) live in each entry's `metadata` JSON; read/written by `memory-bridge.ts`. No backend change, both backends work, no publish.
2. **Usage capture**: `bridgeRecordUsage(ids)` increments `frequency_weight` + stamps access. Wire it into: `bridgeSearchEntries` consumers, ▲ `searchKnowledge` (add `id` to `KnowledgeExcerpt`), ▲ `recallOrgMemory` (log returned IDs into a per-run usage record on the daemon before rendering text — this record is what auto-rating consumes), and ▲ the control server's `/api/knowledge/search` (the warm path route-handler actually hits). Free signal: `bridgeStoreEntry`'s dedup gate (cosine ≥ 0.85 → `duplicate:true`) becomes a `frequency_weight` bump on the existing entry.
3. **Rating**: rewire `memory_feedback` (`mcp-tools/memory-tools.ts`): ▲ add `entryIds: string[]` to the input schema (caller carries IDs from search → feedback; add IDs to every search-shaped tool response). Normalize score → EWMA `w' = w + α·(s − w)`, α=0.1. ▲ **Idempotency ledger** (cognee's applied-flags): keyed by `(runId|taskId → applied)` so daemon retries/duplicate calls never double-apply. Org auto-rating: ▲ **positive-only on run success** (rating memories down on run failure mis-blames good memories — cognee never does failure-rating); a negative path only later, gated on an attribution judgment (the run's coordinator judging whether recalled context was used and helpful, cognee's `served_context_ratings` pattern).
4. **Ranking blend** ▲ (with cognee's guard): only when a genuine embedding similarity exists — `score' = (1−β)·cosine_sim + β·(0.7·feedback_weight + 0.3·norm(frequency_weight))`, `β = feedbackInfluence` (in `.monomind/automem-config.json`, default 0.2). **Keyword-fallback results are never blended** (no real similarity signal → rich-get-richer failure mode); at most a bounded tie-break bonus.
5. **Cleanup & fixes**: `bridgeConsolidate` becomes weight-aware (never GC high-feedback; GC low-weight+stale first) and ▲ must be extended across namespaces and dbPaths (today it hardcodes default dbPath + `namespace:'default'` — it can't even see org memory). ▲ Fix the `minAge` hours-vs-ms bug. ▲ Exempt `org:*` and rules namespaces from the 7-day `staleDays` cliff (or fold staleness into the blend as a soft penalty).

**Files:** `memory-bridge.ts`, `memory-tools.ts`, `knowledge/document-pipeline.ts`, `orgrt/daemon.ts`, `ui/server.mjs` (knowledge search endpoint). All CLI package. **Est ▲: 2–3 days.**

### Phase 2 — Conversation/org knowledge graph ("cognify for sessions")

Port mechanisms #2 + #3. The big one: a KG built from what agents *do and learn*, not just code.

1. **Storage** ▲: new module in the **CLI package** — `packages/@monomind/cli/src/memory/memory-kg.ts` (+ `kg-extract.ts`, `kg-search.ts`) — no publish blocker; CLI already ships sql.js and reaches better-sqlite3 via `@monoes/memory`'s optional dep, and already does direct `db.prepare` for monograph. DB: `.monomind/memory-graph.db`. Node: `{id, type: Entity|EntityType|Rule|Event|Session, name, description, node_set, feedback_weight, importance_weight, valid_from, valid_to, created_at, updated_at, version, origin_ref}`. Edge: `{src, dst, relation, description, weights…, origin_ref}`. Bitemporal columns adopted from memory-palace's *design* (▲ retire only its unwired `kg*` functions — `wakeUp()` is live in session-restore and must keep working). ▲ `node_set` column (cognee NodeSet) enables filtered retrieval (rules, trace-feedback).
2. **Deterministic IDs**: `idFor(type, name)` = uuid5 over `"${type}:${normalize(name)}"` (lowercase, spaces→`_`, strip apostrophes) — idempotent entity merge exactly as cognee.
3. **Extraction task** (LLM-optional):
   - *LLM path* ▲ (concrete, since hooks have no LLM access): (a) in-org — a memify step/role in the org runtime using the existing SDK-session plumbing (`orgrt/session.ts`, subscription auth, zero new keys); (b) interactive sessions — a new `memory_kg_ingest` MCP tool that a hook-emitted instruction asks the *live agent* to call. Prompt ports `generate_graph_prompt.txt`'s rules (basic node types, coreference to fullest name, snake_case relations, one-sentence edge facts, YYYY-MM-DD dates) with JSON-schema structured output. ▲ **Glossary injection** (anti-duplicate-entity): every extraction call receives a top-k list of existing KG entity names (embed-search the KG first) with cognee's writer-prompt rule "never paraphrase, shorten, or rename a glossary entity".
   - *Heuristic fallback*: memory-palace-style regex extractors (proper nouns, action verbs, headers) → `mentioned_in`/`relates_to` edges. ▲ Marked lower-trust: fallback-built subgraphs need an LLM merge pass before rules are distilled from them.
4. **Sources**: (a) org run `bus.jsonl` at run end — extend ▲ `storeRunMemory` (`daemon.ts:555`) to persist outcome text + extracted subgraph; (b) session summaries via `post-task`/`session-end` hook instructions → `memory_kg_ingest`; (c) Second Brain docs on ingest (optional flag).
5. **Rule distillation** ▲ (two-stage, cognee's curator/writer — not idFor-dedup, which can't collapse paraphrases): stage 1 *proposes* candidate rules ("when X, do Y") from the run/session; stage 2 *accepts/rejects* each against similar existing rules (embed-search) + the entity glossary, with explicit reject reasons (`already_known`, `not_durable`, `unsupported`). `idFor` remains only the byte-identical fast path. Accepted rules → `node_set='rules'`, edge `derived_from` → origin session/run. Surfaced via existing per-prompt injection (route-handler + control server) — rules are the highest-value injectable.
6. **Provenance & rollback** ▲ (promoted from risk footnote to deliverable): every node/edge write stamped with `origin_ref` (run id / session id / doc hash); `monomind org memory rollback <run>` deletes everything a run wrote. This is the primary bad-ingest recovery tool and must exist before the graph accumulates (~0.5 day; column already in schema).
7. **Retrieval**: `memory_kg_search`: embed query → seed nodes (MiniLM on name+description) → 1–2-hop neighborhood → triplet scoring: ▲ sum `(2−importance)·dist` over node-edge-node with the Phase 1 feedback blend (blend-before-scaling, documented divergence from cognee's after-scaling order) and the same real-distance-only guard. ▲ Optional rerank: generalize the CLI's single-hop boost from `monograph-tools.ts:59-107` (it's monograph-schema-hardwired today — small extraction job, not free).
8. **Honest tools**: `memory_causal-edge` → writes real KG edges (relation `causes`), traversable. `memory_hierarchical-*` → implement promotion (working→episodic→semantic on frequency_weight thresholds) or delete. Fix the fictional controller descriptions in `memory-tools.ts` either way.

**Files:** new `memory-kg.ts`/`kg-extract.ts`/`kg-search.ts` in `packages/@monomind/cli/src/memory/`; wiring in `memory-tools.ts`, `orgrt/daemon.ts`, `orgrt/session.ts`, `.claude/helpers/handlers/route-handler.cjs` **+ the `packages/@monomind/cli/.claude` mirror** (known trap). ▲ No npm publish required. **Est ▲: 6–10 days** (structured-output plumbing, prompt iteration, two-stage distillation, glossary, rollback).

### Phase 3 — Org memory scopes (cognee datasets, scaled down)

1. **Scopes**: memory entries + KG nodes get `scope: 'agent:<role>' | 'org:<name>' | 'global'`. `org_recall` searches `agent:<own-role>` + `org:<name>`; new `org_remember(scope=…)` lets an agent write private vs shared deliberately.
2. ▲ ~~Sharing/`memory_access` ACLs~~ **deferred (YAGNI)** — single-user tool; the scope column covers the known need. Revisit if inter-org sharing gets a concrete use case.
3. **Incremental skip** (cognee `pipeline_status`): content-hash `data_id` per extraction source (bus run ID, doc hash) + a `kg_pipeline_status` table so re-runs skip completed items. ▲ Any directory scanning here must filter AppleDouble `._*` sidecars (exFAT project volume — documented trap).
4. **Observability**: `monomind org memory stats|inspect` + a dashboard panel on the orgs UI (nodes/edges/rules learned per run). ▲ Plus a `doctor` check for `memory-graph.db` presence/staleness (fits the existing doctor pattern).

**Est ▲: 2 days** (sharing dropped).

### Phase 4 — Retrieval quality + honest consolidation

1. **Regex query router** (cognee `query_router.py`): weighted-regex classifier choosing chunks vs KG vs rules vs hybrid. ▲ Keep cognee's three debuggability details: 20-char negation window, confidence = winner ≥2× runner-up, misroute-override telemetry (~30 lines). ▲ Apply it in the **control server's `/api/knowledge/search`** (the primary warm path) as well as route-handler fallback and `knowledge_search`; copy the `recall(auto_route=True)` API shape.
2. **RRF hybrid**: fuse vector + BM25 + KG-triplet ranks via `Σ 1/(rrf_k+rank+1)` × `(0.75+0.5·importance)`, ▲ adaptive `rrf_k = max(30, min(60, 20+2·top_k))` per cognee.
3. **Real consolidation** (cognee `consolidate_entity_descriptions`): for entities with ≥N edges, LLM-merge neighborhood descriptions into one canonical description (bump `version`; via the same LLM paths as Phase 2.3); falls back to current GC when no LLM. Honors Phase 1 weights. Doubles as the ▲ duplicate-entity merge pass for heuristic-built subgraphs.
4. ▲ ~~`asOf` temporal query API + supersession semantics~~ **deferred (YAGNI)** — the `valid_from/valid_to` columns ship in Phase 2 (cheap substrate) but the query surface waits for a named consumer. Full cognee-style event extraction likewise deferred.

**Est: 2–3 days.**

### Phase 5 — Eval harness (keep tiny)

A single script (not cognee's framework): fixture set of (question, expected-memory-hit) pairs built from real org runs; measure hit-rate@k and rule-recall before/after each phase; assert no regression in `tests/memory/`. Sweep only two knobs: `feedbackInfluence`, hop depth. **Est: 1 day.**

## 4. Explicitly NOT porting

- cognee's runtime/deps (Python, LiteLLM, instructor, LanceDB — we removed LanceDB deliberately, Kuzu, fastapi-users, Alembic, DLT).
- 13 of 17 retriever types (we need ~4: chunks, KG-triplet, rules, hybrid); CoT/decomposition/context-extension retriever loops (Claude *is* the loop); NL→Cypher; agentic retriever.
- Ontology/rdflib/OWL grounding, Graphiti integration, distributed workers, per-dataset physical DB routing (scope column suffices), tenants/roles/ACL sharing (▲ moved to deferred), global context index (▲ verified duplicate of Second Brain injection + monograph communities), triplet embeddings, truth-subspace (experimental in cognee), full temporal event graph.

## 5. Sequencing & risk

- Order: **1 → 2 → 3 → 4 → 5** (each independently shippable; 2 is the only large one).
- Total ▲: **~13–19 dev-days** (was 10–15; Phase 2 was optimistic, Phase 3 shrank).
- Risks: (a) LLM extraction cost/latency → extract only at run-end/session-end, batch, heuristic fallback; (b) ▲ extraction quality drift → glossary injection + two-stage curator/writer + consolidation merge pass; (c) KG noise/bloat → provenance `origin_ref` + per-run rollback (Phase 2.6) + weight-aware GC; (d) ▲ feedback-loop pathologies → real-distance-only blend, positive-only auto-rating, idempotency ledger; (e) two-engine store A/B split remains — deliberately untouched; folding store B in is separate cleanup, not blocking; (f) ▲ npm publish risk eliminated by CLI-package placement (Phases 1–4 need no `@monoes/memory` release).
