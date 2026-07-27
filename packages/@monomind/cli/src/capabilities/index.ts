export * from './types.js';
export { scanDirectory, saveFingerprint, loadFingerprint } from './scanner.js';
export { CapabilityManager } from './manager.js';
// `FileWatcher` (./watcher.ts) was deleted 2026-07: it was built, exported and
// unit-tested but never instantiated anywhere in production. Nothing in the
// capabilities pipeline watches files — `search scan` re-fingerprints on demand
// (see commands/search-universal.ts) and monograph has its own separate watcher
// (`monograph_watch`). Nothing outside this package could reach it either:
// capabilities/ is not in package.json's `exports` map and src/index.ts never
// re-exported it. If incremental re-scanning is wanted later, wire it to the
// scanner at the same time rather than landing an unused class again.
//
// `EnrichmentPipeline` (./enrichment.ts) and the `enrich` command were never
// merged, for the same reason plus one worse one. Its only public entry point
// was `commands/enrich.ts`, which called loadState/pause/resume/getSummary but
// never `runTier()` — the one method that does the actual enriching had zero
// callers, so `enrich --status` would have reported progress on a pipeline
// nothing ever ran. On top of that, the branch tip did not compile: the final
// review-fix commit redeclared `const raw` in `loadState()` (TS2451). The
// T0/T1/T2 vocabulary it defined (`EnrichmentTier`/`EnrichmentStatus`/
// `EnrichmentState`/`EnrichResult` and the optional `enrich()` hook on
// `CapabilityModule`) was removed from types.ts at the same time as this note:
// no capability module implemented the hook and nothing constructed the state,
// so the types described a runtime that did not exist. Reintroduce them
// together with a caller, not ahead of one.
// Branch of record: feat/universal-second-brain (orphaned — shares no history
// with main after the rewrite, so it can never be merged; read it with
// `git show feat/universal-second-brain:<path>`).
export { codeCapability } from './cap-code.js';
export { documentsCapability } from './cap-documents.js';
export { mediaCapability } from './cap-media.js';
export { timelineCapability } from './cap-timeline.js';
export { graphCapability } from './cap-graph.js';
export { dataCapability } from './cap-data.js';
