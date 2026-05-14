/**
 * Worker Daemon Service
 * Node.js-based background worker system that auto-runs like shell daemons
 *
 * Workers:
 * - map: Codebase mapping (5 min interval)
 * - audit: Security analysis (10 min interval)
 * - optimize: Performance optimization (15 min interval)
 * - consolidate: Memory consolidation (30 min interval)
 * - testgaps: Test coverage analysis (20 min interval)
 */
import { EventEmitter } from 'events';
import { HeadlessWorkerExecutor } from './headless-worker-executor.js';
export type WorkerType = 'ultralearn' | 'optimize' | 'consolidate' | 'predict' | 'audit' | 'map' | 'preload' | 'deepdive' | 'document' | 'refactor' | 'benchmark' | 'testgaps';
interface WorkerConfig {
    type: WorkerType;
    intervalMs: number;
    priority: 'low' | 'normal' | 'high' | 'critical';
    description: string;
    enabled: boolean;
}
interface WorkerState {
    lastRun?: Date;
    nextRun?: Date;
    runCount: number;
    successCount: number;
    failureCount: number;
    averageDurationMs: number;
    isRunning: boolean;
}
interface WorkerResult {
    workerId: string;
    type: WorkerType;
    success: boolean;
    durationMs: number;
    output?: unknown;
    error?: string;
    timestamp: Date;
}
interface DaemonStatus {
    running: boolean;
    pid: number;
    startedAt?: Date;
    workers: Map<WorkerType, WorkerState>;
    config: DaemonConfig;
}
export interface DaemonConfig {
    autoStart: boolean;
    logDir: string;
    stateFile: string;
    maxConcurrent: number;
    workerTimeoutMs: number;
    resourceThresholds: {
        maxCpuLoad: number;
        minFreeMemoryPercent: number;
    };
    workers: WorkerConfig[];
}
/**
 * Worker Daemon - Manages background workers with Node.js
 */
export declare class WorkerDaemon extends EventEmitter {
    private config;
    private workers;
    private timers;
    private running;
    private startedAt?;
    private projectRoot;
    private runningWorkers;
    private pendingWorkers;
    private headlessExecutor;
    private headlessAvailable;
    private originalConfig?;
    constructor(projectRoot: string, config?: Partial<DaemonConfig>);
    /**
     * Initialize headless executor if Claude Code is available
     */
    private initHeadlessExecutor;
    /**
     * Check if headless execution is available
     */
    isHeadlessAvailable(): boolean;
    /**
     * Get headless executor instance
     */
    getHeadlessExecutor(): HeadlessWorkerExecutor | null;
    /**
     * Detect effective CPU count for the current environment.
     *
     * Inside Docker / K8s containers, os.cpus().length reports the HOST cpu
     * count, not the container limit (Node.js #28762 — wontfix).  We read
     * cgroup v2 / v1 quota files first so the maxCpuLoad threshold stays
     * meaningful under resource-limited containers.
     */
    static getEffectiveCpuCount(): number;
    /**
     * Read daemon-specific config from .monomind/config.json
     * Supports dot-notation keys like 'daemon.resourceThresholds.maxCpuLoad'
     */
    private readDaemonConfigFromFile;
    /**
     * Setup graceful shutdown handlers
     */
    private setupShutdownHandlers;
    /**
     * Check if system resources allow worker execution
     */
    private canRunWorker;
    /**
     * Process pending workers queue
     *
     * When executeWorkerWithConcurrencyControl defers a worker (returns null),
     * we break immediately to avoid a busy-wait loop — the deferred worker is
     * already back on the pendingWorkers queue by that point. If no workers are
     * currently running when we break, we schedule a backoff retry so the queue
     * does not get permanently stuck.
     */
    private processPendingWorkers;
    private initializeWorkerStates;
    /**
     * Get the PID file path for singleton enforcement (#1395 Bug 3).
     */
    private get pidFile();
    /**
     * Check if another daemon instance is already running.
     * Returns the existing PID if alive, or null if no daemon is running.
     */
    private checkExistingDaemon;
    /**
     * Write PID file with O_EXCL for atomic singleton enforcement (closes the
     * TOCTOU window between checkExistingDaemon and writePidFile that previously
     * allowed two concurrent `daemon start` calls to both succeed).
     * Returns true on success, false if another daemon raced us.
     */
    private writePidFile;
    /**
     * Remove PID file on shutdown.
     */
    private removePidFile;
    /**
     * Start the daemon and all enabled workers
     */
    start(): Promise<void>;
    /**
     * Stop the daemon and all workers
     */
    stop(): Promise<void>;
    /**
     * Get daemon status
     */
    getStatus(): DaemonStatus;
    /**
     * Schedule a worker to run at intervals with staggered start
     */
    private scheduleWorker;
    /**
     * Execute a worker with concurrency control (P0 fix)
     */
    private executeWorkerWithConcurrencyControl;
    /**
     * Execute a worker with timeout protection
     */
    private executeWorker;
    /**
     * Run a function with timeout (P1 fix)
     * @param fn - The async function to execute
     * @param timeoutMs - Timeout in milliseconds
     * @param timeoutMessage - Error message on timeout
     * @param onTimeout - Optional cleanup callback invoked when timeout fires (#1117: kills orphan processes)
     */
    private runWithTimeout;
    /**
     * Run the actual worker logic
     */
    private runWorkerLogic;
    private runMapWorker;
    /**
     * Local audit worker (fallback when headless unavailable)
     */
    private runAuditWorkerLocal;
    /**
     * Local optimize worker (fallback when headless unavailable)
     */
    private runOptimizeWorkerLocal;
    private runConsolidateWorker;
    /**
     * Local testgaps worker (fallback when headless unavailable)
     */
    private runTestGapsWorkerLocal;
    /**
     * Local predict worker (fallback when headless unavailable)
     */
    private runPredictWorkerLocal;
    /**
     * Local document worker (fallback when headless unavailable)
     */
    private runDocumentWorkerLocal;
    /**
     * Local ultralearn worker (fallback when headless unavailable)
     */
    private runUltralearnWorkerLocal;
    /**
     * Local refactor worker (fallback when headless unavailable)
     */
    private runRefactorWorkerLocal;
    /**
     * Local deepdive worker (fallback when headless unavailable)
     */
    private runDeepdiveWorkerLocal;
    /**
     * Local benchmark worker
     */
    private runBenchmarkWorkerLocal;
    /**
     * Local preload worker
     */
    private runPreloadWorkerLocal;
    /**
     * Manually trigger a worker
     */
    triggerWorker(type: WorkerType): Promise<WorkerResult>;
    /**
     * Enable/disable a worker
     */
    setWorkerEnabled(type: WorkerType, enabled: boolean): void;
    /**
     * Save daemon state to file
     */
    private saveState;
    /**
     * Log message
     */
    private log;
}
/**
 * Get or create daemon instance
 */
export declare function getDaemon(projectRoot?: string, config?: Partial<DaemonConfig>): WorkerDaemon;
/**
 * Start daemon (for use in session-start hook)
 */
export declare function startDaemon(projectRoot: string, config?: Partial<DaemonConfig>): Promise<WorkerDaemon>;
/**
 * Stop daemon
 */
export declare function stopDaemon(): Promise<void>;
export default WorkerDaemon;
//# sourceMappingURL=worker-daemon.d.ts.map