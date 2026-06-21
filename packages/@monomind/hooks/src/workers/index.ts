/**
 * V1 Workers System - Cross-Platform Background Workers
 *
 * Optimizes Monomind with non-blocking, scheduled workers.
 * Works on Linux, macOS, and Windows.
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

export { createPerformanceWorker } from './worker-performance.js';
export { createHealthWorker } from './worker-health.js';
export { createSwarmWorker } from './worker-swarm.js';
export { createGitWorker } from './worker-git.js';
export { createLearningWorker } from './worker-learning.js';
export { createADRWorker } from './worker-adr.js';
export { createDDDWorker } from './worker-ddd.js';
export { createSecurityWorker } from './worker-security.js';
export { createPatternsWorker } from './worker-patterns.js';
export { createCacheWorker } from './worker-cache.js';
export { createProgressWorker } from './worker-progress.js';

// ============================================================================
// Factory
// ============================================================================

import { createPerformanceWorker } from './worker-performance.js';
import { createHealthWorker } from './worker-health.js';
import { createSwarmWorker } from './worker-swarm.js';
import { createGitWorker } from './worker-git.js';
import { createLearningWorker } from './worker-learning.js';
import { createADRWorker } from './worker-adr.js';
import { createDDDWorker } from './worker-ddd.js';
import { createSecurityWorker } from './worker-security.js';
import { createPatternsWorker } from './worker-patterns.js';
import { createCacheWorker } from './worker-cache.js';
import { createProgressWorker } from './worker-progress.js';

export function createWorkerManager(projectRoot?: string): WorkerManager {
  const root = projectRoot || process.cwd();
  const manager = new WorkerManager(root);

  manager.register('performance', createPerformanceWorker(root));
  manager.register('health', createHealthWorker(root));
  manager.register('swarm', createSwarmWorker(root));
  manager.register('git', createGitWorker(root));
  manager.register('learning', createLearningWorker(root));
  manager.register('adr', createADRWorker(root));
  manager.register('ddd', createDDDWorker(root));
  manager.register('security', createSecurityWorker(root));
  manager.register('patterns', createPatternsWorker(root));
  manager.register('cache', createCacheWorker(root));
  manager.register('progress', createProgressWorker(root));

  return manager;
}

// Default instance
export const workerManager = createWorkerManager();

// Entity memory workers (Task 10)
export { EntityExtractorWorker, buildExtractionPrompt, parseEntityFacts } from './entity-extractor.js';
export type { EntityExtractorConfig } from './entity-extractor.js';
export { EntityCleanupWorker } from './entity-cleanup.js';
export type { EntityCleanupConfig } from './entity-cleanup.js';

// Episode binner worker (Task 11)
export { EpisodeBinnerWorker } from './episode-binner.js';
