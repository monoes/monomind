/**
 * V1 Workers System - Cross-Platform Background Workers
 *
 * Workers run on-demand via `hooks worker run <name>` and are triggered
 * at session-start by session-restore-handler's freshness check.
 * No interval timers — a single-user CLI doesn't need them.
 *
 * WorkerManager class and shared types live in worker-manager.ts (ARCH-3 extraction).
 * Worker factory functions live in individual worker-*.ts files (ARCH-3b extraction).
 * Shared utilities live in worker-utils.ts.
 * This file acts as the barrel: imports + re-exports.
 */

// ============================================================================
// Re-export everything from worker-manager (types + class + configs)
// ============================================================================

import type {
  AlertThreshold,
  HistoricalMetric,
  PersistedWorkerState,
  StatuslineData,
  WorkerAlert,
  WorkerConfig,
  WorkerHandler,
  WorkerManagerStatus,
  WorkerMetrics,
  WorkerResult,
} from './worker-manager.js';
import {
  AlertSeverity,
  DEFAULT_THRESHOLDS,
  WORKER_ALIAS_MAP,
  WORKER_CONFIGS,
  WorkerManager,
  WorkerPriority,
} from './worker-manager.js';

export type {
  AlertThreshold,
  HistoricalMetric,
  PersistedWorkerState,
  StatuslineData,
  WorkerAlert,
  WorkerConfig,
  WorkerHandler,
  WorkerManagerStatus,
  WorkerMetrics,
  WorkerResult,
};

export {
  AlertSeverity,
  DEFAULT_THRESHOLDS,
  WORKER_ALIAS_MAP,
  WORKER_CONFIGS,
  WorkerManager,
  WorkerPriority,
};

// ============================================================================
// Re-export shared utilities
// ============================================================================

export { isValidWorkerName } from './worker-utils.js';

// ============================================================================
// Re-export worker factory functions
// ============================================================================

export { createAuditWorker } from './worker-audit.js';
export { createCacheWorker } from './worker-cache.js';
export { createConsolidateWorker } from './worker-consolidate.js';
export { createDDDWorker } from './worker-ddd.js';
export { createHealthWorker } from './worker-health.js';
export { createMapWorker } from './worker-map.js';
export { createProgressWorker } from './worker-progress.js';
export { createReflexionWorker, getReflectionsForTask } from './worker-reflexion.js';
export { createSecurityWorker } from './worker-security.js';

// ============================================================================
// Factory
// ============================================================================

import { createAuditWorker } from './worker-audit.js';
import { createCacheWorker } from './worker-cache.js';
import { createConsolidateWorker } from './worker-consolidate.js';
import { createDDDWorker } from './worker-ddd.js';
import { createHealthWorker } from './worker-health.js';
import { createMapWorker } from './worker-map.js';
import { createProgressWorker } from './worker-progress.js';
import { createReflexionWorker } from './worker-reflexion.js';
import { createSecurityWorker } from './worker-security.js';

export function createWorkerManager(projectRoot?: string): WorkerManager {
  const root = projectRoot || process.cwd();
  const manager = new WorkerManager(root);

  manager.register('health', createHealthWorker(root));
  manager.register('ddd', createDDDWorker(root));
  manager.register('security', createSecurityWorker(root));
  manager.register('cache', createCacheWorker(root));
  manager.register('progress', createProgressWorker(root));
  manager.register('map', createMapWorker(root));
  manager.register('audit', createAuditWorker(root));
  manager.register('consolidate', createConsolidateWorker(root));
  manager.register('reflexion', createReflexionWorker(root));

  return manager;
}

// PKG-2: the old `export const workerManager = createWorkerManager();` ran at
// module evaluation, pinning process.cwd() at import time before the host
// process had a chance to chdir to the project root. Construction is now
// deferred to first access. Callers that just need a one-off instance should
// call createWorkerManager() directly with an explicit projectRoot.
let _workerManager: WorkerManager | undefined;

/**
 * Lazy singleton accessor — construction (and the cwd() it pins) is deferred
 * to first call. Use this instead of the old top-level `workerManager` value.
 */
export function getWorkerManager(): WorkerManager {
  if (!_workerManager) _workerManager = createWorkerManager();
  return _workerManager;
}

// Backwards-compat named export. Construction is deferred to first property
// access via a Proxy so importing this module no longer pins cwd. New
// consumers should prefer getWorkerManager() or createWorkerManager().
export const workerManager: WorkerManager = new Proxy({} as WorkerManager, {
  get(_target, prop, receiver) {
    const wm = getWorkerManager();
    const value = Reflect.get(wm as object, prop, receiver);
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(wm)
      : value;
  },
});
