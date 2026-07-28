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
  WorkerConfig,
  WorkerMetrics,
  WorkerManagerStatus,
  WorkerAlert,
  AlertThreshold,
  PersistedWorkerState,
  HistoricalMetric,
  StatuslineData,
} from './worker-manager.js';

import {
  WorkerPriority,
  AlertSeverity,
  DEFAULT_THRESHOLDS,
  WORKER_CONFIGS,
  WORKER_ALIAS_MAP,
  WorkerManager,
} from './worker-manager.js';

import type { WorkerResult, WorkerHandler } from './worker-manager.js';

export type {
  WorkerConfig,
  WorkerResult,
  WorkerMetrics,
  WorkerManagerStatus,
  WorkerHandler,
  WorkerAlert,
  AlertThreshold,
  PersistedWorkerState,
  HistoricalMetric,
  StatuslineData,
};

export {
  WorkerPriority,
  AlertSeverity,
  DEFAULT_THRESHOLDS,
  WORKER_CONFIGS,
  WORKER_ALIAS_MAP,
  WorkerManager,
};

// ============================================================================
// Re-export shared utilities
// ============================================================================

export { isValidWorkerName } from './worker-utils.js';

// ============================================================================
// Re-export worker factory functions
// ============================================================================

export { createHealthWorker } from './worker-health.js';
export { createDDDWorker } from './worker-ddd.js';
export { createSecurityWorker } from './worker-security.js';
export { createCacheWorker } from './worker-cache.js';
export { createProgressWorker } from './worker-progress.js';
export { createMapWorker } from './worker-map.js';
export { createAuditWorker } from './worker-audit.js';
export { createConsolidateWorker } from './worker-consolidate.js';

// ============================================================================
// Factory
// ============================================================================

import { createHealthWorker } from './worker-health.js';
import { createDDDWorker } from './worker-ddd.js';
import { createSecurityWorker } from './worker-security.js';
import { createCacheWorker } from './worker-cache.js';
import { createProgressWorker } from './worker-progress.js';
import { createMapWorker } from './worker-map.js';
import { createAuditWorker } from './worker-audit.js';
import { createConsolidateWorker } from './worker-consolidate.js';

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

  return manager;
}

// Default instance
export const workerManager = createWorkerManager();
