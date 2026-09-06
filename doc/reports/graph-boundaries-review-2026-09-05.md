# Monomind graph boundaries and terminology review

Reviewed 5 September 2026. Companion: [memory knowledge graph review](memory-knowledge-graph-review-2026-09-05.md). The [earlier report](knowledge-graph-review-2026-09-05.md) primarily reviewed Monograph; it is a historical snapshot, not a substitute for this review.

**Finding: the implementations are distinguishable, but the product language, ownership rules, and retrieval contracts are inconsistent.** The earlier review's scope mistake was mine; it does not by itself prove a design defect. This review independently found both existing documentation that distinguishes the graphs and concrete places where that distinction breaks down.

## The actual boundaries

| Name to use | What it represents | Implementation / storage | What it does not imply |
|---|---|---|---|
| **Monograph code graph** | Parsed code structure and dependencies, with optional documentation and other repository context | `@monoes/monograph`, `.monomind/monograph.db` | A general store of remembered facts or org ownership |
| **Memory knowledge graph** | Extracted entities, relationships, and durable rules from sessions, org runs, or caller-supplied material | `cli/src/memory/memory-kg.ts`, memory bridge namespaces `kg:nodes`, `kg:edges`, and `rules` | That every ingested document has been converted into graph facts |
| **Second Brain document index** | Document chunks, source metadata, embeddings/keyword retrieval | `document-pipeline.ts`, `knowledge:<scope>` entries plus a document metadata log | An entity-relation graph by itself |
| **Knowledge search** | A retrieval interface that can combine excerpts, memory KG triplets, rules, and patterns | `knowledge-tools.ts` and `query-router.ts` | A distinct graph or a query across every store and graph |
| **Org / agent topology** | Roles, reporting relationships, runtime policy, task execution, and coordination | Org definitions and runtime; e.g. role `reports_to` | A knowledge graph, a graph database, or the complete org runtime |
| **Memory Palace temporal triples** | A separate helper-level subject/predicate/object history | Checked-in `memory-palace.cjs` helper, `.monomind/palace/kg.json` | Automatic synchronization with `memory_kg_*` |

Sources: [memory graph](../../packages/@monomind/cli/src/memory/memory-kg.ts#L1), [document pipeline](../../packages/@monomind/cli/src/knowledge/document-pipeline.ts#L469), [knowledge search](../../packages/@monomind/cli/src/mcp-tools/knowledge-tools.ts#L89), [org definition](../../packages/@monomind/cli/src/orgrt/types.ts#L182), [Palace helper](../../.gemini/helpers/memory-palace.cjs#L347).

The Palace helper matters to the terminology audit: “exactly two graphs” is too broad a claim about the whole repository. Its implementation exists, but its deployment and usage across all platforms were not established here. The main operational distinction remains Monograph versus the memory KG; other representations must be named rather than silently equated with either.

## What is already clear

- The getting-started guide separates Monograph, Memory, Second Brain, and Org Runtime into four capabilities. [Guide](../getting-started.md#L7)
- The memory concept guide explicitly has a “Second Brain KG vs Monograph” comparison. It is not fair to claim no distinction exists. [Comparison](../concepts/memory.md#L266)
- Tool prefixes provide a useful starting boundary: `monograph_*` for repository analysis, `memory_kg_*` for learned entities/relations, `knowledge_*` for document ingestion and combined retrieval.
- The memory bridge separates project storage from the global brain, and global-only MCP knowledge search excludes project KG/rules/patterns. Preserve that explicit restriction. [Store resolution](../../packages/@monomind/cli/src/memory/memory-bridge.ts#L163), [global-only search](../../packages/@monomind/cli/src/mcp-tools/knowledge-tools.ts#L151)

## Observations and recommended changes

### B1 — The documentation conflates document indexing with graph extraction

The concept guide describes the second graph as a “Document KG” and lists text extraction plus chunking as its parser. It places `knowledge_search` and `memory_kg_search` together, and says Monograph handles code while Second Brain handles everything else.

The actual document ingestion function stores chunks and document metadata. It does not call `kgIngest`. The memory KG is populated through explicit entity/relation ingestion, session/task hooks, or org learning/fallback extraction. Conversely, Monograph can index documents, and memory KG entities may describe code elements. The boundary is therefore **how knowledge is obtained, validated, owned, and queried**, not simply “code files versus other files.”

**Recommendation:** document two explicit flows: document → searchable excerpts; extracted claims → memory KG. Show extraction between them as a separate operation, not an automatic consequence of ingestion. Name the latter “memory knowledge graph,” with documents as one possible source.

Evidence: [comparison](../concepts/memory.md#L266), [chunk storage](../../packages/@monomind/cli/src/knowledge/document-pipeline.ts#L554), [KG ingestion API](../../packages/@monomind/cli/src/mcp-tools/memory-tools.ts#L317), [org learning](../../packages/@monomind/cli/src/orgrt/org-memory.ts#L183), [heuristic CodeElement extraction](../../packages/@monomind/cli/src/memory/memory-kg.ts#L887).

### B2 — “For an org” does not match KG storage and query scoping

**High priority; source-confirmed.** All orgs under one root use `.monomind/org-memory`. Flat memories have org/role namespaces, but graph functions use the same fixed `kg:nodes`, `kg:edges`, and `rules` namespaces without an org argument. `learnOrgKnowledge` does not include the org name in node identity or graph scope.

`monomind org memory <name> stats/search/rules/rollback` passes that shared store to KG operations. JSON output labels the result with the requested org name even though KG reads and rollback are not filtered by it. The coordinator glossary also reads the shared graph. This permits cross-org merging and visibility; a rollback command's org name is not an ownership restriction. This is a same-root scope defect, not evidence of a cross-machine or remote access exploit.

**Recommendation:** make KG scope explicit and enforced for every read, write, glossary, and rollback. Default to org-owned knowledge; support deliberate project-shared promotion separately. Either isolate stores by org or add indexed scope to identity and queries. Include org identity in origin references. Test two orgs with the same entity name, different facts, and independent rollback.

Evidence: [org store and flat namespaces](../../packages/@monomind/cli/src/orgrt/org-memory.ts#L6), [learning](../../packages/@monomind/cli/src/orgrt/org-memory.ts#L186), [CLI operations](../../packages/@monomind/cli/src/commands/org.ts#L2134), [glossary injection](../../packages/@monomind/cli/src/orgrt/daemon.ts#L877), [documented contract](../commands/org.md#L235).

### B3 — Search names do not guarantee the same retrieval surfaces

The MCP `knowledge_search` fuses document excerpts, project memory KG triplets, rules, and patterns. Org agents receive a tool with the same name whose implementation searches only project/global documents. Org KG knowledge is instead appended by `org_recall`, but only after flat-memory retrieval succeeds: its early empty-result return bypasses KG search.

The general knowledge router classifies phrases such as “what calls/imports” as `kg`, which means memory KG—not Monograph. A question about code dependencies can therefore query remembered assertions rather than parsed code. If it returns some hits, fallback does not correct that selection.

**Recommendation:** define one retrieval request/response contract, with explicit supported surfaces and scope. Use “document search” where the operation is document-only. Route code dependency questions to Monograph or clearly say code analysis was not searched. Search org flat memory and org KG independently, then merge. Report requested, executed, failed, and unsupported surfaces in results.

Evidence: [MCP search](../../packages/@monomind/cli/src/mcp-tools/knowledge-tools.ts#L159), [org document-only implementation](../../packages/@monomind/cli/src/orgrt/org-memory.ts#L156), [org recall early return](../../packages/@monomind/cli/src/orgrt/org-memory.ts#L117), [router](../../packages/@monomind/cli/src/memory/query-router.ts#L40).

### B4 — Store and namespace names conceal real ownership

The concept guide says memory lives in project `.monomind/` and describes `.monomind/memory/memory.db` for Second Brain. The current bridge defaults to a project-hashed directory under `~/.monomind/projects/<slug>/lancedb`; despite that directory name, it uses SQLite. Org memory and global brain resolve elsewhere. The CLI flat org-memory search also hardcodes `org:<name>` rather than resolving the configured `memory_namespace` used by runtime writes.

**Recommendation:** expose a read-only storage manifest showing subsystem, owner, resolved path, namespace, backend, retrieval method, and migration status. Generate documentation examples from that resolver. Keep legacy directory names as compatibility details; avoid a filesystem rename without migration. Have org CLI and runtime call the same namespace resolver.

Evidence: [documented layout](../concepts/memory.md#L315), [actual path resolution](../../packages/@monomind/cli/src/memory/memory-bridge.ts#L140), [namespace resolver](../../packages/@monomind/cli/src/orgrt/org-memory.ts#L6), [CLI hardcoded namespace](../../packages/@monomind/cli/src/commands/org.ts#L2193).

### B5 — Generic labels and outdated model descriptions encourage wrong assumptions

Initialization calls Monograph setup `initKnowledgeGraph` and reports a “knowledge graph build.” The memory graph calls its search vector-seeded even when the bridge falls back to keyword search. README describes MiniLM for Second Brain and a different embedding model for persistent memory, while document ingestion uses the same memory bridge whose configured model constant is `Alibaba-NLP/gte-modernbert-base`.

**Recommendation:** qualify status messages as “Monograph code graph,” “memory knowledge graph,” or “document index.” Report the model/method actually used. Replace stale architecture/model prose with shared capability metadata. These wording changes should accompany contract fixes, not substitute for them.

Evidence: [initialization label](../../packages/@monomind/cli/src/init/executor.ts#L305), [KG tool description](../../packages/@monomind/cli/src/mcp-tools/memory-tools.ts#L386), [README model split](../../README.md#L268), [bridge model](../../packages/@monomind/cli/src/memory/memory-bridge.ts#L63), [document write path](../../packages/@monomind/cli/src/knowledge/document-pipeline.ts#L565).

## Proposed product contract

> Monomind combines a code graph for repository analysis, a memory knowledge graph for remembered claims, a document index for source excerpts, and an org runtime for agent coordination. Retrieval can combine these sources while preserving their scope and provenance.

Use **agent topology** for configured agent relationships, **org runtime** for the system that executes/governs them, and **agent graph** only as an explanatory visualization label. Both code and memory graphs can contribute to RAG; generation happens in the consuming agent. Do not use “RAG,” “knowledge graph,” and “org” interchangeably.

Suggested result metadata, as a proposed contract rather than an existing API:

```json
{
  "surface": "memory_graph",
  "scope": { "projectId": "…", "orgId": "…" },
  "method": "keyword",
  "status": "complete",
  "entityId": "…",
  "claimId": "…",
  "sourceRefs": ["…"],
  "truncated": false
}
```

Keep the stores modular. Add explicit links between a remembered claim and its document/code evidence; do not flatten code dependencies, remembered claims, and agent permissions into a single undifferentiated graph.

## Delivery and validation

1. **Fix ownership first:** org KG scope and rollback isolation; shared namespace resolution.
2. **Unify retrieval contracts:** expose surfaces/methods; correct routing and org KG-only recall.
3. **Publish one authoritative subsystem map:** update help, doctor, tool descriptions, diagrams, and model/storage examples.
4. **Audit legacy graph representations:** inventory real Palace consumers before deprecating or migrating them. A migration must preserve timestamps and source support, not just text.

Acceptance tests should demonstrate org A cannot read/merge/rollback org B's private claims; document ingestion does not falsely report entity extraction; code questions select code analysis; and the same named tool has a documented, testable surface contract across runtimes.

This was a source and contract review with targeted runtime evidence supplied by the companion report. No org data or permissions were modified. The review began at `dd93c6558` and was reconciled through cutoff `e4d225b9b`. Concurrent commit `020aaba38` improved memory write results and basic provenance rollback; the companion report marks those fixes explicitly. It did not add org scoping or resolve the naming/routing boundaries above. Concurrent Monograph fixes are outside this report.
