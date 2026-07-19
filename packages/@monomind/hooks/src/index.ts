/**
 * @monoes/hooks - Hooks & Workers Library
 *
 * A LIBRARY package, not a runtime hook dispatcher. It provides hook type
 * definitions (HookEvent, HookHandler, HookPriority), an in-memory
 * HookRegistry/HookExecutor for defining handlers, and a WorkerManager with
 * 15 background workers (performance, health, swarm, git, learning, adr,
 * ddd, security, patterns, cache, progress).
 *
 * NOT the authoritative hook dispatch path. The actual Claude Code hooks
 * that fire on every edit/command/task/session run through the plain CJS
 * handlers in `.claude/helpers/` (see `.claude/helpers/hook-handler.cjs`),
 * driven by settings.json — that is the "live" system. This package is
 * bridged in as OPTIONAL enrichment: the ddd and security workers are
 * invoked from the CJS handlers (session-restore / agent-start), and the
 * full WorkerManager is started by the CLI MCP server process
 * (initSubsystems in packages/@monomind/cli/src/index.ts).
 *
 * History: this package previously carried a large speculative surface
 * (MCP tool wrappers for AFLOW/LATS/GEPA/RLVR routing, dynamic agent
 * synthesis + DGM archive, trace/replay observability, interrupt
 * checkpoints, statusline generation, swarm messaging, arXiv-inspired
 * learning workers). None of it was ever invoked in practice — no
 * artifacts were ever produced on disk — and most of its backing modules
 * had already been removed, leaving handlers that silently degraded to
 * hardcoded data. That surface was deleted; what remains is the consumed
 * core.
 *
 * @packageDocumentation
 */

// Types
export * from './types.js';

// Registry
export {
  HookRegistry,
  defaultRegistry,
  registerHook,
  unregisterHook,
} from './registry/index.js';

// Executor
export {
  HookExecutor,
  defaultExecutor,
  executeHooks,
} from './executor/index.js';

// Workers - Cross-platform background workers
export {
  WorkerManager,
  WorkerPriority,
  AlertSeverity,
  WORKER_CONFIGS,
  DEFAULT_THRESHOLDS,
  createWorkerManager,
  workerManager,
  // Worker factories
  createPerformanceWorker,
  createHealthWorker,
  createSwarmWorker,
  createGitWorker,
  createLearningWorker,
  createADRWorker,
  createDDDWorker,
  createSecurityWorker,
  createPatternsWorker,
  createCacheWorker,
  createProgressWorker,
  createMapWorker,
  createAuditWorker,
  createOptimizeWorker,
  createConsolidateWorker,
  WORKER_ALIAS_MAP,
  // Types
  type WorkerConfig,
  type WorkerResult,
  type WorkerMetrics,
  type WorkerManagerStatus,
  type WorkerHandler,
  type WorkerAlert,
  type AlertThreshold,
  type PersistedWorkerState,
  type HistoricalMetric,
  type StatuslineData,
} from './workers/index.js';
