# monovector/ — Keyword Routing & Outcome Measurement

This directory is the lean replacement for the removed `monovector` vector-DB / SONA
intelligence package. There is no neural training, no native/WASM engine, and no
`@monoes/*` runtime dependency here. What ships is a small set of pure-TypeScript
modules that route tasks deterministically and measure whether the routing helped.

> The full neural learning loop (SONA, MoE, Flash Attention, EWC++/LoRA, the native
> `VectorDb`) lives on the `monoes-full-loop` branch. None of it is available in the
> lean build — do not advertise it as installable.

## Modules

| File | Purpose |
|---|---|
| `index.ts` | Public surface: `createKeywordRouter`, capability/availability probes, re-exports |
| `capabilities.ts` | Reports lean capabilities (no native engine); `getCapabilities()` is a JS stub |
| `route-outcomes.ts` | Records recommended routes and correlates them with actual outcomes |
| `command-outcomes.ts` | Records command exit codes; derives recent success/failure signal |
| `diff-classifier.ts` | Pure-JS git-diff classification + risk scoring (feature/bugfix/refactor/…) |
| `init-state.ts` | Tracks initialization status |

## Keyword Router

`createKeywordRouter()` returns a deterministic router that maps a task description to
an agent type using keyword scoring — no LLM call, no learned weights.

```typescript
import { createKeywordRouter } from './index.js';

const router = createKeywordRouter();
const decision = router.route('implement user authentication');
// → { agentType, confidence, reasoning?, route?, alternatives? }
```

`isMonovectorAvailable()` and `isWasmBackendAvailable()` exist for backward
compatibility and report the lean reality (no native/WASM engine).

## Route-Outcome Measurement

The routing loop is closed by correlation, not by training. A recommended route is
recorded, then later joined to the observed outcome; `doctor` surfaces the resulting
accuracy and recommended-vs-actual adherence.

```typescript
import {
  recordRoute,
  joinLatestUnresolved,
  computeRoutingAccuracy,
  computeAdherence,
} from './route-outcomes.js';

await recordRoute(baseDir, { /* RouteOutcomeRecord */ });
await joinLatestUnresolved(baseDir, /* outcome */);

const { accuracy, sample } = await computeRoutingAccuracy(baseDir);
const { adherence } = await computeAdherence(baseDir);
```

## Command-Outcome Logging

```typescript
import { recordCommand, deriveRecentSuccess } from './command-outcomes.js';

await recordCommand(baseDir, { command: 'build', exitCode: 0, ts: Date.now() });
const recentlyHealthy = await deriveRecentSuccess(baseDir); // boolean | null
```

## Diff Classification

```typescript
import { createDiffClassifier, getGitDiffNumstat, assessOverallRisk } from './diff-classifier.js';

const files = getGitDiffNumstat('HEAD');
const classifier = createDiffClassifier();
// classifier.classify(...) → DiffClassification
```

## Persistence

All outcome records are plain JSON files under the project's `.monomind` base
directory — there is no vector database, no embedding store, and no quantized weight
file in the lean build. Semantic memory search is provided separately by
`@monomind/memory` (pure-JS HNSW via AgentDB).
