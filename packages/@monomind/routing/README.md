<p align="center">
  <img src="https://raw.githubusercontent.com/monoes/monomind/main/assets/packages/routing.png" alt="@monoes/routing" width="600" />
</p>

# @monoes/routing

[![npm version](https://img.shields.io/npm/v/@monoes/routing?style=flat-square)](https://www.npmjs.com/package/@monoes/routing)
[![license](https://img.shields.io/npm/l/@monoes/routing?style=flat-square)](https://github.com/monoes/monomind/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)

> **Semantic task-to-agent routing** for Monomind (`@monoes/routing` `v1.0.3` / Monomind CLI `v2.9.0`).

Part of the [Monomind](https://github.com/monoes/monomind) ecosystem. Handles deterministic keyword filtering, vector centroid embedding matching, neural routing, and LLM fallback classification to route user tasks to specialized agent roles.

---

## 🏗 Task-to-Agent Cascade Architecture

When a task description is processed, `@monoes/routing` executes a multi-tier cascade flow (fast deterministic $\rightarrow$ embedding similarity $\rightarrow$ neural augmentation $\rightarrow$ LLM fallback):

```
                       Task Description
                              │
                              ▼
                ┌───────────────────────────┐
                │ Tier 1: Keyword Pre-Filter │ ── Match ──▶ confidence: 1.0 (method: 'keyword')
                │ (30+ rules, < 1ms)        │
                └───────────────────────────┘
                              │ No Match
                              ▼
                ┌───────────────────────────┐
                │ Tier 2: Cosine Centroid   │ ── Sim >= 0.5 ──▶ confidence: cosine (method: 'semantic')
                │ (256-D MD5/HNSW Vector)   │
                └───────────────────────────┘
                              │ Below Threshold
                              ▼
                ┌───────────────────────────┐
                │ Tier 3: Neural & LanceDB  │ ── Score = 0.65*neural + 0.35*keyword
                │ (Vector Rerank)           │
                └───────────────────────────┘
                              │ Below Threshold
                              ▼
                ┌───────────────────────────┐
                │ Tier 4: LLM Fallback      │ ── Classify ──▶ confidence: 0.85 (method: 'llm_fallback')
                │ (Claude Haiku / Degraded) │
                └───────────────────────────┘
```

### 1. Tier 1: Deterministic Keyword Pre-Filter
- **Source**: [`keyword-pre-filter.ts:18-93`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/routing/src/keyword-pre-filter.ts#L18-L93)
- Evaluates tasks using fast regular expression matching against 30+ default rule definitions (e.g., CVE security checks, unit test files, Docker/DevOps configs, Solidity/ZK contracts, MCP tools).
- Returns immediate match with `confidence: 1.0` and `method: 'keyword'`.

### 2. Tier 2: Cosine Centroid Embedding Match
- **Source**: [`route-layer.ts:73-106`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/routing/src/route-layer.ts#L73-L106), [`cosine.ts:5-20`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/routing/src/cosine.ts#L5-L20)
- Computes cosine similarity between task vector embeddings and agent route centroid vectors.
- Supports lightweight 256-D MD5/SHA-256 hash embeddings (`LocalEncoder`) or transformer embeddings (`HNSWEncoder`).
- If similarity $\ge \text{threshold}$ (default: 0.5), routes task with `method: 'semantic'`.

### 3. Tier 3: Neural & LanceDB Vector Reranking
- **Source**: [`hooks-routing.ts:293-391`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/mcp-tools/hooks-routing.ts#L293-L391)
- Blends neural model score with keyword match score: $\text{FinalScore} = 0.65 \times \text{neuralScore} + 0.35 \times \text{keywordMatchScore}$.
- Consults local LanceDB vector indices for past successful route outcomes.

### 4. Tier 4: LLM Fallback Classification
- **Source**: [`llm-fallback.ts:20-88`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/routing/src/llm-fallback.ts#L20-L88), [`prompts/classify.ts:4-28`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/routing/src/prompts/classify.ts#L4-L28)
- Constructs a compact capability prompt (max 8,000 chars) detailing candidate agent descriptions and returns classification with `confidence: 0.85` and `method: 'llm_fallback'`.
- On API failure or missing key, degrades gracefully to the default route with `method: 'semantic_degraded'`.

---

## 💻 CLI Command Reference (`monomind route`)

The Monomind CLI provides 9 subcommands under `monomind route` (defined in [`src/commands/route.ts:80-800`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/commands/route.ts#L80-L800)):

| Subcommand | Usage | Description | Key Flags |
|---|---|---|---|
| `task` | `monomind route task "<prompt>"` | Primary CLI entry point. Routes a task prompt to the best agent slug. | `--json`, `--verbose` |
| `semantic` | `monomind route semantic "<prompt>"` | Executes full `@monoes/routing` embedding + centroid pipeline. | `--threshold N`, `--json` |
| `list-agents` | `monomind route list-agents` | Displays all registered agents, capabilities, and keyword patterns. | `--format json` |
| `stats` | `monomind route stats` | Displays routing performance metrics, cache hits, and tier usage breakdown. | `--reset` |
| `feedback` | `monomind route feedback <id> <correct_agent>` | Records user feedback to update local neural/LanceDB routing weights. | `--weight N` |
| `reset` | `monomind route reset` | Resets cached route centroids, outcomes, and feedback data. | `--force` |
| `export` | `monomind route export --out <file>` | Exports learned routing centroids and capability index to JSON. | `--out` |
| `import` | `monomind route import --in <file>` | Imports routing centroids and rules from external JSON file. | `--in`, `--merge` |
| `coverage` / `cov` | `monomind route coverage` | Runs benchmark coverage test across sample task prompts. | `--min-score N` |

---

## ⚡ Task Complexity Scoring Rules

Task complexity is dynamically calculated to estimate execution duration, budget allocation, and agent delegation hierarchy:

- **High Complexity** ("2–4 hours"): Prompts containing architecture refactoring, full stack migrations, multi-package dependencies, or text length $> 500$ chars.
- **Medium Complexity** ("30–60 min"): Standard feature implementations, multi-file bugfixes, API integration, or text length $> 150$ chars.
- **Complexity Scoring**:
  - `High` (Estimated 2-4 hours): Task description contains `'complex'` or `'architecture'` OR character `length > 200` ([`hooks-routing.ts:395-400`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/cli/src/mcp-tools/hooks-routing.ts#L395-L400)).
  - `Low` (Estimated 10-30 min): Task description contains `'simple'` or `'fix'` OR character `length < 50`.
  - `Medium` (Estimated 30-60 min): All other standard task prompts.

---

## Test Suites

Vitest test suites are located in [`packages/@monomind/routing/__tests__/`](file:///Users/morteza/Desktop/tools/monomind/packages/@monomind/routing/__tests__/):
- `route-layer.test.ts`: Cascade evaluation, thresholds, and fallback behavior.
- `keyword-pre-filter.test.ts`: Regex rule precedence and pattern matching.
- `encoder.test.ts`: 256-D MD5/SHA-256 local encoding and LRU cache eviction.
- `llm-fallback.test.ts`: LLM prompt construction, candidate hint parsing, and error recovery.
- `cosine.test.ts`: Validates vector dot product calculation and centroid position aggregation.
- `capability-index.test.ts`: Ensures agent capability indexing stays under the 8,000-character context budget.

Run unit tests via:
```bash
pnpm --filter @monoes/routing test
```

---

## 🚀 Usage Example

```typescript
import { RouteLayer } from '@monoes/routing';

const router = new RouteLayer({
  routes: [
    { name: 'coder', agentSlug: 'coder', utterances: ['implement feature', 'build api'], threshold: 0.5 },
    { name: 'tester', agentSlug: 'tester', utterances: ['write unit test', 'add coverage'], threshold: 0.5 },
    { name: 'security', agentSlug: 'security-engineer', utterances: ['fix cve', 'audit vulnerability'], threshold: 0.5 },
  ],
  enableKeywordFilter: true,
});

await router.initialize();

// Tier 1 Match (<1ms)
const res1 = await router.route('Fix CVE-2024-12345 vulnerability');
// { agentSlug: 'security-engineer', confidence: 1.0, method: 'keyword' }

// Tier 2 Match (Embedding Centroid)
const res2 = await router.route('Create new REST endpoint for user profiles');
// { agentSlug: 'coder', confidence: 0.82, method: 'semantic' }
```

---

## 🔗 Links

- [GitHub Repository](https://github.com/monoes/monomind)
- [Documentation Site](https://monoes.github.io/monomind/)
- [Monomind CLI Command Reference](https://monoes.github.io/monomind/#routing)

## 📄 License

MIT

