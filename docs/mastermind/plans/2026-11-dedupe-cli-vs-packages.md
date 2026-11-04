# Dedupe: cli vs sibling packages (one owner per concern)

Status: plan plus a first safe subset (branch `refactor/dedupe-cli-vs-packages`).
Paths below are under `packages/@monomind/`.

## Key finding: the siblings are optionalDependencies

`cli/package.json` lists `@monoes/hooks`, `mcp`, `memory` and `routing` under
`optionalDependencies` (not `dependencies`). A static `import` of any of them
would crash CLI startup in an install made with `--omit=optional`. Every
`await import('@monoes/...')` in the CLI is therefore deliberate lazy loading.
Static imports are NOT safe until these move to `dependencies` (see F1).

## Concerns

### 1. Memory
- cli owner today: `cli/src/memory/` (~58 files; `memory-initializer.ts:144`,
  `memory-bridge-*.ts`, `memory-crud*.ts`, `memory-kg-*.ts`, schema/migrations).
- package owner: `memory/src/` (`sql-backend*.ts`, `sqlite-backend.ts`,
  `sqljs-backend.ts`, `knowledge/`, `migration*.ts`).
- Overlap: `memory-schema.ts` / `memory-migrations.ts` (cli) vs `sql-schema.ts`
  (package); chunker fallback `cli/src/knowledge/document-chunking.ts:34`
  duplicates `memory/src/knowledge` chunker on purpose (package may be absent).
- `sqlite-backend.ts` (167 lines) and `sqljs-backend.ts` (255) are NOT duplicates:
  both extend `SqlBackend` (sql-backend.ts) and only supply a driver. Each has
  its own tests and is exported from `memory/src/index.ts`. Keep.
- Callers of the package from cli: dynamic imports in `memory-bridge-store.ts`,
  `memory-bridge-backend.ts`, `knowledge/document-chunking.ts`,
  `knowledge/eval/harness-prep.ts`.
- Proposed owner: `@monoes/memory` for storage/schema/migrations; cli keeps the
  bridge (path resolution, embeddings, CLI-facing CRUD). Risk: high (schema).

### 2. HNSW
- Already consolidated. The ANN index lives in `memory/src/hnsw-index.ts` (+
  `hnsw-graph-ops/-distance/-heap/-serialize/-quantizer`) and is wired through
  `SqlBackend.search()` (`sql-backend-ann.ts`). `cli/src/memory/hnsw-operations.ts`
  (270 lines) holds only INT8 quantisation, batch cosine, softmax, top-k and
  flash-attention helpers (header says the second JS HNSW was already removed).
- Overlap left: `quantizeInt8` (cli, symmetric, scale per vector) vs `Quantizer`
  (`memory/src/hnsw-quantizer.ts:14`); different algorithm and API, not
  behaviourally identical, so no merge without a parity test. Importers of
  hnsw-operations: `memory-initializer.ts` and one test.
- Risk: medium. No deletion done.

### 3. Routing
- cli: `cli/src/routing/` (agent-pick.ts, pick-step.ts, embedder.ts,
  embed-worker.ts, llm-caller.ts, model-download.ts, route-layer-factory.ts).
- package: `routing/src/` (route-layer.ts, encoder.ts, keyword-pre-filter.ts,
  llm-fallback.ts, cosine.ts, routes/).
- Overlap: `cosineSimilarity` x4: `routing/src/cosine.ts:5`,
  `cli/src/utils/cosine-similarity.ts:22`, `memory/src/math-utils.ts:5`, plus
  `cosineDistance*` in `memory/src/hnsw-distance.ts`. Signatures and edge cases
  (zero vectors, Float32Array) differ; unify into one util only with a parity test.
- cli adds the model-backed embedder and the picker; package is the pure
  router. Proposed owner: package for RouteLayer/routes/cosine; cli for
  embedder, LLM caller, picker. Risk: low-medium.

### 4. MCP server
- cli: `cli/src/mcp-server.ts` (1260 lines, `MCPServerManager` :151, process /
  pid / transport management) with `mcp-client*.ts`, `mcp-tools/`.
- package: `mcp/src/server-core.ts` (`MCPServerCore`, abstract), `server.ts`
  (`createMCPServer` :310), registry, transport, auth.
- `MCPServerManager` wraps `createMCPServer` (lazy import at mcp-server.ts:847);
  it is lifecycle glue, not a second protocol implementation. Tool registry /
  session / rate-limit logic exists only in the package. Real overlap is small;
  the file is being split by the code-health work (do not touch here).
- Proposed owner: package = protocol, cli = process lifecycle. Risk: low.

### 5. Pattern store (JSON vs SQLite)
- JSON: `cli/src/memory/intelligence-*.ts` (`LocalReasoningBank` in
  intelligence-reasoning-bank.ts, persistence + lock in
  intelligence-persistence.ts), `cli/src/mcp-tools/hooks-intelligence-*.ts`,
  `hooks-learning.ts`. SQLite: memory backends (`memory_entries`, embeddings).
- Two unrelated stores with different shapes (patterns vs memory entries).
- DONE: `PatternStore` interface in `memory/src/pattern-store.ts`, exported
  from the memory index; `LocalReasoningBank implements PatternStore` (type-only
  import, no format change). Proposed owner: memory package defines the contract;
  JSON impl stays in cli until a SQLite impl exists. Risk: low (done).

## Executed (this branch)
1. Removed `as string` casts on `import('@monoes/routing'|'@monoes/memory')`
   (5 sites). Still lazy; result is now typed. Runtime unchanged.
2. Added `PatternStore` + `StoredPatternRecord` (memory pkg) and
   `implements PatternStore` on `LocalReasoningBank`.

Not done on purpose: static imports (optionalDependencies), deleting files
(found no zero-importer duplicates: sqlite/sqljs backends and hnsw-operations
all have importers/tests), HNSW/quantizer merge (not identical).

## Follow-ups
| id | item | effort |
|----|------|--------|
| F1 | Decide: promote mcp/memory/routing/hooks to `dependencies`, then switch lazy imports to static; check publish size, `--omit=optional` installs, doctor checks | 1-2 d |
| F2 | Cosine unification with shared parity tests (4 impls) — DONE, see below | 0.5 d |
| F3 | Quantizer parity test, then pick one of `quantizeInt8` / `Quantizer` — parity test DONE (they differ; no merge) | 1 d |
| F4 | Move schema/migrations (`memory-schema.ts`, `memory-migrations.ts`) next to `sql-schema.ts`; one source of DDL | 3-4 d |
| F5 | Remove inline chunker fallback once F1 lands | 0.5 d |
| F6 | SQLite-backed `PatternStore` + migration from patterns JSON (format change, needs its own plan) | 3 d |
| F7 | Slim `MCPServerManager` to lifecycle only after the mcp-server.ts split | 1-2 d |

### F2 result (branch refactor/dedupe-routing-cosine)
Parity tests: `tests/cli/vector-math-parity.test.ts` (imports each package's
source directly; inputs include zero, empty, NaN and different-length vectors).
- Centroid: cli `meanCentroid` (private, `cli/src/routing/embedder.ts`) and
  `computeCentroid` (`routing/src/cosine.ts`) gave equal output on every case
  (zero, NaN, ragged, empty vectors; both throw on an empty list, messages
  differ). The cli copy is deleted; `createSemanticRouting` now calls
  `computeCentroid` through a lazy `import('@monoes/routing')` (the embed
  worker has already loaded the package). The test keeps a verbatim copy of
  the removed function as the reference.
- Cosine: kept all four, because they differ on length mismatch only:
  cli `cosineSimilarity` truncates to the shorter vector; routing throws
  `Vector length mismatch`; memory `math-utils` returns 0; memory
  `cosineDistance` reads past the shorter vector and returns NaN. cli
  `batchCosineSim` (`hnsw-operations.ts`) also differs there (query norm over
  the whole query, vector norm over the overlap) and returns Float32 scores.
  They agree on equal-length input, zero vectors (0, distance 1), empty
  vectors (0) and NaN (NaN). cli `cosineSimilarity` also returns 0 for
  null/undefined, where the others throw. Merging needs a decision on the
  mismatch semantics first, plus F1 (the cli cannot statically import either
  package).
- Not touched: inline cosine in `cli/src/memory/intelligence-pattern-api.ts`
  (cli-internal; no zero-magnitude guard, so it yields NaN where the shared
  cli helper yields 0) and `quantizedCosineSim` (Int8 input, uses
  `sqrt(normA*normB)`).

### F3 result
Same test file pins how cli `quantizeInt8` and memory `Quantizer`
(`type: 'scalar', bits: 8`) differ: Int8 symmetric with per-vector scale
(`absMax/127`, round-trips via `dequantizeInt8`) vs Float32 affine min/max
mapping into [0, 1] (no round-trip to input scale); a constant vector keeps its
magnitude in `quantizeInt8` but collapses to zeros in `Quantizer`; `Quantizer`
enforces a fixed dimension. Not interchangeable; no merge.
