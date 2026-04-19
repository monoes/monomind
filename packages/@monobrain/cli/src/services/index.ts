/**
 * CLI Services Index
 * Central registry for all background services
 */

export {
  WorkerDaemon,
  getDaemon,
  startDaemon,
  stopDaemon,
  type WorkerType,
} from './worker-daemon.js';

export {
  HeadlessWorkerExecutor,
  HEADLESS_WORKER_TYPES,
  HEADLESS_WORKER_CONFIGS,
  LOCAL_WORKER_TYPES,
  LOCAL_WORKER_CONFIGS,
  ALL_WORKER_CONFIGS,
  isHeadlessWorker,
  isLocalWorker,
  getModelId,
  getWorkerConfig,
  type HeadlessWorkerType,
  type LocalWorkerType,
  type HeadlessWorkerConfig,
  type HeadlessExecutionResult,
  type HeadlessExecutorConfig,
  type HeadlessOptions,
  type PoolStatus,
  type SandboxMode,
  type ModelType,
  type OutputFormat,
  type ExecutionMode,
  type WorkerPriority,
  type WorkerConfig,
} from './headless-worker-executor.js';

// Re-export types
export type { default as WorkerDaemonType, DaemonConfig } from './worker-daemon.js';
export type { default as HeadlessWorkerExecutorType } from './headless-worker-executor.js';
