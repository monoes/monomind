# autoresearch (karpathy/autoresearch)

**Source:** https://github.com/karpathy/autoresearch  
**Category:** Autonomous Research Loop  
**Role in Monobrain:** Experiment loop protocol, time-budget enforcement, bin packing for API chunking

---

## What It Is

autoresearch is Andrej Karpathy's framework for running autonomous research experiments with LLMs. Its key contributions are a structured experiment loop (BASELINE/KEEP/DISCARD protocol), fixed time-budget per experiment run to prevent runaway costs, and Best-Fit Decreasing bin packing for distributing large inputs across API chunk limits.

## What We Extracted

### 1. Experiment Loop Protocol (BASELINE/KEEP/DISCARD `results.tsv`)
autoresearch tracks every experiment in a `results.tsv` file with three outcomes:
- **BASELINE**: The control measurement before any change
- **KEEP**: A change that improved on baseline
- **DISCARD**: A change that did not improve

Monobrain's `@monoes/graph` pipeline adopted this for its graph optimization experiments. When the pipeline tests different graph construction parameters (node extraction thresholds, edge weights, community detection resolution), it logs each run as BASELINE/KEEP/DISCARD, making it possible to roll back to the last KEEP configuration automatically.

### 2. Fixed Time-Budget Per Run
autoresearch enforces a hard time limit per experiment run to prevent any single experiment from consuming unbounded compute. Monobrain implements this via `runWithTimeout()` in `hook-handler.cjs` — every async operation that touches external dependencies (intelligence.init, intelligence.consolidate, @monobrain/hooks workers) runs inside a timeout wrapper that cancels and logs the failure without blocking the hook response.

### 3. Best-Fit Decreasing Bin Packing for API Chunking
autoresearch uses the Best-Fit Decreasing (BFD) bin packing algorithm to optimally distribute documents across API calls that have token limits, minimizing the number of calls while respecting the limit. Monobrain's `@monoes/graph` pipeline uses this for chunking large codebases into graph construction batches — files are sorted by estimated token count descending, then packed into bins that stay under the API context limit.

## How It Improved Monobrain

The time-budget enforcement pattern from autoresearch solved a real production problem: early versions of the hook system would occasionally hang for 30+ seconds when the intelligence module was slow to initialize. The `runWithTimeout()` wrapper, directly inspired by autoresearch's fixed-budget approach, ensures hook responses always complete within the configured timeout regardless of subsystem slowness.

The BFD bin packing for chunking also improved the quality of graph construction — without it, files were chunked arbitrarily and context boundaries cut through logical units like class definitions and function signatures.

## Key Files Influenced

- `hook-handler.cjs` `runWithTimeout()` — fixed time-budget enforcement
- `packages/@monobrain/graph/src/pipeline.ts` — BASELINE/KEEP/DISCARD experiment protocol
- `packages/@monobrain/graph/src/` — BFD bin packing for API chunking
- `hook-handler.cjs` `session-restore` — timeout-guarded intelligence.init
