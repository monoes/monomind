# Routing Subsystem

> **Version 2.9.0**  
> Task-to-agent routing in Monomind maps developer tasks and natural language prompts to optimal target agents. It combines a 4-tier cascade (deterministic regex pre-filtering, vector cosine similarity matching, neural ReasoningBank augmentation, and LLM fallback classification) with dynamic complexity scoring and an outcome-tracking ledger. There is no reinforcement learning anywhere in this subsystem — no Q-table, no epsilon exploration, no learned state-action values.
>
> **On "neural" below:** every "Neural"/"Tier 3" label on this page names an
> embedding-similarity lookup against a stored pattern set (`ReasoningBank`),
> not a trained or trainable model — same scope as `CLAUDE.md`'s Intelligence
> System section ("no neural training"). The name predates that clarification
> and is kept for backward compatibility with existing method/backend string
> values (`method: 'memory-lancedb'`, etc.) that callers may already match on.

---

## 1. Subsystem Architecture Overview

The routing engine operates across two primary layers:

1. **Primary Routing Package (`@monomind/routing`)**:
   - Location: [`packages/@monomind/routing/src/`](packages/@monomind/routing/src/)
   - Core components: `RouteLayer`, `KeywordPreFilter`, `LocalEncoder`, `HNSWEncoder`, `LLMFallbackRouter`, `CapabilityIndex`.
   - Responsibility: Vector encodings, utterance centroid calculation, regex pre-filtering, similarity scoring, and LLM fallback prompts.

2. **CLI & MCP Integration Layer (`@monomind/cli`)**:
   - Primary CLI command: [`packages/@monomind/cli/src/commands/route.ts`](packages/@monomind/cli/src/commands/route.ts)
   - MCP Tools & Hooks: [`packages/@monomind/cli/src/mcp-tools/hooks-routing.ts`](packages/@monomind/cli/src/mcp-tools/hooks-routing.ts) (`hooks_route`, `hooks_route_semantic`, `hooks_pre-task`, `hooks_post-task`)
   - Outcome Logger: [`packages/@monomind/cli/src/monovector/route-outcomes.js`](packages/@monomind/cli/src/monovector/route-outcomes.js)

```mermaid
flowchart TD
    A[Task Description / Prompt] --> T1{Tier 1: Keyword Pre-Filter}
    T1 -- Regex Match --> R1[Return Agent: method = 'keyword', confidence = 1.0]
    T1 -- No Match --> T2[Tier 2: Semantic Cosine Match]
    
    T2 --> VEC[Compute Task Vector via Encoder]
    VEC --> SIM[Cosine Similarity vs Centroids]
    SIM -- Score >= Threshold --> R2[Return Agent: method = 'semantic', confidence = norm(score)]
    
    SIM -- Score < Threshold --> T3{Tier 3: Neural Augmentation}
    T3 -- Vector / ReasoningBank Match --> R3[Return Blended Agent: confidence = 0.65*neural + 0.35*keyword]
    
    T3 -- Low Confidence --> T4{Tier 4: LLM Fallback Classifier}
    T4 -- Valid LLM Slug Match --> R4[Return Agent: method = 'llm_fallback', confidence = 0.85]
    T4 -- Throws / Invalid Slug --> R5[Return Nearest Centroid: method = 'semantic_degraded', confidence = raw_cosine]
```

---

## 2. The 4-Tier Routing Cascade

When a task description is processed, Monomind routes it through a multi-tier waterfall:

### Tier 1: Deterministic Keyword Pre-Filter
- **File**: [`packages/@monomind/routing/src/keyword-pre-filter.ts`](packages/@monomind/routing/src/keyword-pre-filter.ts#L18-L93)
- **Mechanism**: Fast first-match regex evaluation against `DEFAULT_KEYWORD_ROUTES` (30+ rules covering security, test files, DevOps/Docker/Kubernetes, Solidity, ZK proofs, MCP, React Native, Swift, Kotlin, embedded, Salesforce, game engines, SEO, supply chain, GraphQL, and Databases).
- **Custom Rules**: Allows prepending custom higher-priority rules via `KeywordRule` objects.
- **Outcome**: Returns `{ agentSlug, confidence: 1.0, method: 'keyword', routeName }` upon matching.

### Tier 2: Vector Cosine Similarity Matching
- **Files**: [`packages/@monomind/routing/src/route-layer.ts`](packages/@monomind/routing/src/route-layer.ts#L73-L106), [`packages/@monomind/routing/src/encoder.ts`](packages/@monomind/routing/src/encoder.ts), [`packages/@monomind/routing/src/cosine.ts`](packages/@monomind/routing/src/cosine.ts)
The routing subsystem includes Vitest test suites under [`packages/@monomind/routing/__tests__/`](packages/@monomind/routing/__tests__/):
- **Mechanism**:
  - **Centroids**: Routes define representative `utterances` (10–15 descriptions). `initialize()` averages these vectors into a route centroid via `computeCentroid()`. Host precomputed centroids can be injected to skip runtime calculation.
  - **Encoders**:
    - `LocalEncoder`: 256-dimensional deterministic pseudo-embeddings generated from MD5 unigram and bigram hashing with L2 normalization and a 2000-entry SHA-256 LRU cache.
    - `HNSWEncoder`: Wraps host-injected transformer pipeline embedder (e.g. HuggingFace feature-extraction pipeline); falls back to `LocalEncoder` when unavailable.
  - **Scoring**: Computes cosine similarity between task vector and centroids. If `score >= threshold` (default `0.5`), returns `method: 'semantic'` with normalized confidence `(score + 1) / 2`.

### Tier 3: Neural & SQLite-Backed Augmentation (`hooks_route`)
- **File**: [`packages/@monomind/cli/src/mcp-tools/hooks-routing.ts`](packages/@monomind/cli/src/mcp-tools/hooks-routing.ts#L293-L391)
- **Mechanism**: Evaluates task vectors against the memory-bridge vector store (`bridgeRouteTask`) — SQLite-backed since 2026-07 (LanceDB was fully removed, `memory-bridge.ts:5-7`), though its output still labels itself `lancedb` for backward compatibility (`backend: 'lancedb'`, `method: 'memory-lancedb'`, `hooks-routing.ts:303-322`). If similarity is below `0.5`, queries neural `ReasoningBank` patterns (`suggestAgentsFromIntelligence`), prepending learned neural agents and blending confidence ($0.65 \times \text{neural} + 0.35 \times \text{keyword}$).

### Tier 4: LLM Fallback Classifier
- **Files**: [`packages/@monomind/routing/src/llm-fallback.ts`](packages/@monomind/routing/src/llm-fallback.ts#L20-L88), [`packages/@monomind/routing/src/capability-index.ts`](packages/@monomind/routing/src/capability-index.ts)
- **Mechanism**: Triggered when similarity falls below threshold and `llmFallback` is configured. Builds a prompt containing:
  1. A compact capability index of active agents (`buildCapabilityIndex`, max 8000 chars).
  2. Top 3 semantic pre-candidates with similarity scores (`buildCandidateHints`).
  3. The task description.
- **Validation**: Sanitizes response against regex `/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/` and matches case-insensitively. Valid match returns `method: 'llm_fallback'` with `confidence: 0.85`.
- **Degraded Recovery**: If the LLM throws, returns an invalid slug, or names an unknown agent, the router returns `method: 'semantic_degraded'` with the raw nearest-centroid cosine score, preventing failed fallbacks from masquerading as successful LLM decisions.

---

## 3. Dynamic Complexity Scoring

Monomind assesses task complexity across CLI and MCP routing tools to estimate duration, effort, and resource allocation:

1. **Length & Keyword Heuristic**:
   - Evaluated in MCP hooks ([`hooks-routing.ts`](packages/@monomind/cli/src/mcp-tools/hooks-routing.ts#L395-L400)).
   - **`high`**: Description length $> 200$ characters OR contains `'complex'` / `'architecture'`. Duration: **2-4 hours**.
   - **`low`**: Description length $< 50$ characters OR contains `'simple'` / `'fix'`. Duration: **10-30 min**.
   - **`medium`**: Default / all other tasks. Duration: **30-60 min**.

2. **Coverage-Aware Effort & Impact**:
   - Evaluated in [`monomind route coverage`](packages/@monomind/cli/src/commands/route.ts#L596).
   - Computes gap scores (`targetCoverage - currentCoverage`), priority scores (1-10), and estimated implementation effort in hours based on un-covered AST line counts and test gaps.

---

## 4. Outcome Tracking & Route Statistics

The keyword router (`createKeywordRouter`, [`monovector/index.ts:92`](packages/@monomind/cli/src/monovector/index.ts#L92)) is a fixed keyword-substring matcher — it does not learn. What it does track is an append-only outcome ledger, read back to report routing quality over time:

- **Recording**: [`monomind route feedback`](packages/@monomind/cli/src/commands/route.ts#L349) writes a reward (`-1.0`–`1.0`) for a task/agent pair. Internally, `KeywordRouter.update()` ([`monovector/index.ts:127`](packages/@monomind/cli/src/monovector/index.ts#L127)) joins it to the latest unresolved route record (or creates a manual-feedback record) and appends it to `route-outcomes.jsonl` — no model weights are touched.
- **Statistics**: [`monomind route stats`](packages/@monomind/cli/src/commands/route.ts#L290) reports `KeywordRouterStats` ([`monovector/index.ts:66-72`](packages/@monomind/cli/src/monovector/index.ts#L66-L72)): `outcomeCount`, `accuracy`, `adherence` (fraction of joined routes where the agent actually used matched the recommendation), `trend` (recent-half accuracy minus prior-half accuracy), and a `byMode: { native, js }` split. Computed by `computeRoutingAccuracy()` / `computeAdherence()` in [`route-outcomes.ts:169,194`](packages/@monomind/cli/src/monovector/route-outcomes.ts#L169).
- **Management**: `route reset` clears `route-outcomes.jsonl`; `route export`/`import` move the same ledger to/from a JSON file (50MB cap, path-containment checked on both).

This is a measurement layer, not a control loop: nothing in this subsystem feeds outcomes back into future routing decisions.

---

## 5. Benchmark & Test Suite

The routing subsystem is validated by automated test suites in `packages/@monomind/routing/src/__tests__/`:

- `route-layer.test.ts`: Validates keyword short-circuiting, centroid initialization idempotency, fallback routes (`general-purpose`), runtime route addition (`addRoute`), global threshold overrides, LLM fallback execution, precomputed centroid performance, and debug output (`allScores`).
- `keyword-pre-filter.test.ts`: Verifies regex matches across all 30+ default rules and validates custom rule precedence.
- `llm-fallback.test.ts`: Tests LLM prompt construction, slug validation, case-insensitive matching, and degraded fallback recovery.
- `encoder.test.ts`: Tests 256-D vector output, L2 normalization, MD5/SHA-256 hash determinism, and LRU cache eviction.
- `cosine.test.ts`: Verifies cosine similarity calculations and centroid mean computations.
- `capability-index.test.ts`: Benchmarks capability index character truncation (8000 char cap) and candidate hint generation.
