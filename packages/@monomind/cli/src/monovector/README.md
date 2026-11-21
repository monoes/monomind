# monovector/ — Keyword Routing & Outcome Measurement

This directory is the lean replacement for the removed `monovector` vector-DB / SONA
intelligence package. There is no neural training, no native/WASM engine, and no
`@monoes/*` runtime dependency here. What ships is a small set of pure-TypeScript
modules that route tasks through the central picker and measure whether the routing helped.

> The full neural learning loop (SONA, MoE, Flash Attention, EWC++/LoRA, the native
> `VectorDb`) lives on the `monoes-full-loop` branch. None of it is available in the
> lean build — do not advertise it as installable. (The lean build does keep a JS
> keyword-pattern `SONA Optimizer` in `../memory/sona-optimizer.ts` and EWC
> consolidation in `../memory/ewc-consolidation.ts`; neither trains a model.)

## Modules

| File                  | Purpose                                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`            | Public surface: `createKeywordRouter`, re-exports                                                                                                                |
| `route-outcomes.ts`   | Records recommended routes and correlates them with actual outcomes                                                                                              |
| `command-outcomes.ts` | Records command exit codes; derives recent success/failure signal                                                                                                |
| `model-outcomes.ts`   | Records model-routing decisions for `hooks model-outcome` / `hooks model-stats`                                                                                  |
| `diff-classifier.ts`  | Pure-JS git-diff classification + risk scoring (feature/bugfix/refactor/…); split across `diff-classifier-core.ts`, `diff-classifier-types.ts` and `diff-git.ts` |
| `coverage-router.ts`  | Coverage-aware routing over coverage files on disk (`monomind route coverage`)                                                                                   |
| `coverage-tools.ts`   | `coverage_*` MCP tools wrapping `coverage-router.ts`                                                                                                             |
| `init-state.ts`       | Tracks initialization status                                                                                                                                     |

## Keyword Router

`createKeywordRouter()` returns a router that maps a task description to an agent type
by delegating to the central picker (`routing/agent-pick.ts → pickAgents`), so it agrees
with `monomind pick` and `hooks route`. `route()` returns a Promise. The picker uses the
Jev decision model when one is configured, else BM25 keyword ranking with a bounded
outcome prior from `.monomind/pick-stats.json`; no model is trained.

```typescript
import { createKeywordRouter } from './index.js';

const router = createKeywordRouter();
const decision = await router.route('implement user authentication');
// → { agentType, confidence, reasoning?, route, alternatives? }
```

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

await recordRoute(baseDir, {
  /* RouteOutcomeRecord */
});
await joinLatestUnresolved(baseDir, { agentActuallyUsed, measuredSuccess });

const { accuracy, totalWithOutcome } = await computeRoutingAccuracy(baseDir);
const { adherence, sample } = await computeAdherence(baseDir);
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
`@monoes/memory` (opt-in vector backends; not on the routing hot path).
