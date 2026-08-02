# Routing Subsystem

> **Version 2.8.3**  
> Task-to-agent routing in Monomind maps developer tasks and natural language prompts to optimal target agents. It combines a 4-tier cascade (deterministic regex pre-filtering, vector cosine similarity matching, neural ReasoningBank augmentation, and LLM fallback classification) with dynamic complexity scoring and Q-learning trajectory updates.

---

## 1. Subsystem Architecture Overview

The routing engine operates across two primary layers:

1. **Primary Routing Package (`@monomind/routing`)**:
   - Location: [`packages/@monomind/routing/src/`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/routing/src/)
   - Core components: `RouteLayer`, `KeywordPreFilter`, `LocalEncoder`, `HNSWEncoder`, `LLMFallbackRouter`, `CapabilityIndex`.
   - Responsibility: Vector encodings, utterance centroid calculation, regex pre-filtering, similarity scoring, and LLM fallback prompts.

2. **CLI & MCP Integration Layer (`@monomind/cli`)**:
   - Primary CLI command: [`packages/@monomind/cli/src/commands/route.ts`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/commands/route.ts)
   - MCP Tools & Hooks: [`packages/@monomind/cli/src/mcp-tools/hooks-routing.ts`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/mcp-tools/hooks-routing.ts) (`hooks_route`, `hooks_route_semantic`, `hooks_pre-task`, `hooks_post-task`)
   - Outcome Logger: [`packages/@monomind/cli/src/monovector/route-outcomes.js`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/monovector/route-outcomes.js)

```mermaid
flowchart TD
    A[Task Description / Prompt] --> T1{Tier 1: Keyword Pre-Filter}
    T1 -- Regex Match --> R1[Return Agent: method = 'keyword', confidence = 1.0]
    T1 -- No Match --> T2[Tier 2: Semantic Cosine Match]
    
    T2 --> VEC[Compute Task Vector via Encoder]
    VEC --> SIM[Cosine Similarity vs Centroids]
    SIM -- Score >= Threshold --> R2[Return Agent: method = 'semantic', confidence = norm(score)]
    
    SIM -- Score < Threshold --> T3{Tier 3: Neural Augmentation / LanceDB}
    T3 -- LanceDB / ReasoningBank Match --> R3[Return Blended Agent: confidence = 0.65*neural + 0.35*keyword]
    
    T3 -- Low Confidence --> T4{Tier 4: LLM Fallback Classifier}
    T4 -- Valid LLM Slug Match --> R4[Return Agent: method = 'llm_fallback', confidence = 0.85]
    T4 -- Throws / Invalid Slug --> R5[Return Nearest Centroid: method = 'semantic_degraded', confidence = raw_cosine]
```

---

## 2. The 4-Tier Routing Cascade

When a task description is processed, Monomind routes it through a multi-tier waterfall:

### Tier 1: Deterministic Keyword Pre-Filter
- **File**: [`packages/@monomind/routing/src/keyword-pre-filter.ts`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/routing/src/keyword-pre-filter.ts#L18-L93)
- **Mechanism**: Fast first-match regex evaluation against `DEFAULT_KEYWORD_ROUTES` (30+ rules covering security, test files, DevOps/Docker/Kubernetes, Solidity, ZK proofs, MCP, React Native, Swift, Kotlin, embedded, Salesforce, game engines, SEO, supply chain, GraphQL, and Databases).
- **Custom Rules**: Allows prepending custom higher-priority rules via `KeywordRule` objects.
- **Outcome**: Returns `{ agentSlug, confidence: 1.0, method: 'keyword', routeName }` upon matching.

### Tier 2: Vector Cosine Similarity Matching
- **Files**: [`packages/@monomind/routing/src/route-layer.ts`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/routing/src/route-layer.ts#L73-L106), [`packages/@monomind/routing/src/encoder.ts`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/routing/src/encoder.ts), [`packages/@monomind/routing/src/cosine.ts`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/routing/src/cosine.ts)
The routing subsystem includes Vitest test suites under [`packages/@monomind/routing/__tests__/`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/routing/__tests__/):
- **Mechanism**:
  - **Centroids**: Routes define representative `utterances` (10–15 descriptions). `initialize()` averages these vectors into a route centroid via `computeCentroid()`. Host precomputed centroids can be injected to skip runtime calculation.
  - **Encoders**:
    - `LocalEncoder`: 256-dimensional deterministic pseudo-embeddings generated from MD5 unigram and bigram hashing with L2 normalization and a 2000-entry SHA-256 LRU cache.
    - `HNSWEncoder`: Wraps host-injected transformer pipeline embedder (e.g. HuggingFace feature-extraction pipeline); falls back to `LocalEncoder` when unavailable.
  - **Scoring**: Computes cosine similarity between task vector and centroids. If `score >= threshold` (default `0.5`), returns `method: 'semantic'` with normalized confidence `(score + 1) / 2`.

### Tier 3: Neural & LanceDB Augmentation (`hooks_route`)
- **File**: [`packages/@monomind/cli/src/mcp-tools/hooks-routing.ts`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/mcp-tools/hooks-routing.ts#L293-L391)
- **Mechanism**: Evaluates task vectors against the LanceDB vector store (`bridgeRouteTask`). If similarity is below `0.5`, queries neural `ReasoningBank` patterns (`suggestAgentsFromIntelligence`), prepending learned neural agents and blending confidence ($0.65 \times \text{neural} + 0.35 \times \text{keyword}$).

### Tier 4: LLM Fallback Classifier
- **Files**: [`packages/@monomind/routing/src/llm-fallback.ts`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/routing/src/llm-fallback.ts#L20-L88), [`packages/@monomind/routing/src/capability-index.ts`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/routing/src/capability-index.ts)
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
   - Evaluated in MCP hooks ([`hooks-routing.ts`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/mcp-tools/hooks-routing.ts#L395-L400)).
   - **`high`**: Description length $> 200$ characters OR contains `'complex'` / `'architecture'`. Duration: **2-4 hours**.
   - **`low`**: Description length $< 50$ characters OR contains `'simple'` / `'fix'`. Duration: **10-30 min**.
   - **`medium`**: Default / all other tasks. Duration: **30-60 min**.

2. **Q-Learning Exploration & Q-Values**:
   - Evaluated in [`monomind route task`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/commands/route.ts#L175-L221).
   - Task states are encoded via hash functions to maintain a state-agent Q-table. In `--q-learning` mode, agent selection favors maximum Q-values with optional epsilon exploration (`--explore`). Rewards are logged via `monomind route feedback`.

3. **Coverage-Aware Effort & Impact**:
   - Evaluated in [`monomind route coverage`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/commands/route.ts#L618-L800).
   - Computes gap scores (`targetCoverage - currentCoverage`), priority scores (1-10), and estimated implementation effort in hours based on un-covered AST line counts and test gaps.

---

## 4. Benchmark & Test Suite

The routing subsystem is validated by automated test suites in `packages/@monomind/routing/src/__tests__/`:

- `route-layer.test.ts`: Validates keyword short-circuiting, centroid initialization idempotency, fallback routes (`general-purpose`), runtime route addition (`addRoute`), global threshold overrides, LLM fallback execution, precomputed centroid performance, and debug output (`allScores`).
- `keyword-pre-filter.test.ts`: Verifies regex matches across all 30+ default rules and validates custom rule precedence.
- `llm-fallback.test.ts`: Tests LLM prompt construction, slug validation, case-insensitive matching, and degraded fallback recovery.
- `encoder.test.ts`: Tests 256-D vector output, L2 normalization, MD5/SHA-256 hash determinism, and LRU cache eviction.
- `cosine.test.ts`: Verifies cosine similarity calculations and centroid mean computations.
- `capability-index.test.ts`: Benchmarks capability index character truncation (8000 char cap) and candidate hint generation.
