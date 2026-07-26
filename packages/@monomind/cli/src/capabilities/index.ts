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
export { codeCapability } from './cap-code.js';
export { documentsCapability } from './cap-documents.js';
export { mediaCapability } from './cap-media.js';
export { timelineCapability } from './cap-timeline.js';
export { graphCapability } from './cap-graph.js';
export { dataCapability } from './cap-data.js';
