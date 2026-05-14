/**
 * Container Worker Pool
 * Docker-based worker pool for high-throughput headless execution.
 *
 * ADR-020: Headless Worker Integration Architecture - Phase 3
 * - Manages pool of Docker containers for isolated worker execution
 * - Supports dynamic scaling based on workload
 * - Provides container lifecycle management
 * - Integrates with WorkerQueue for task distribution
 *
 * Key Features:
 * - Container pooling with configurable size
 * - Health checking and auto-recovery
 * - Resource limits (CPU, memory)
 * - Volume mounting for workspace access
 * - Network isolation per worker type
 */
import { EventEmitter } from 'events';
import type { HeadlessWorkerType, HeadlessExecutionResult, SandboxMode } from './headless-worker-executor.js';
/**
 * Container state
 */
export type ContainerState = 'creating' | 'ready' | 'busy' | 'unhealthy' | 'terminated';
/**
 * Container info
 */
export interface ContainerInfo {
    id: string;
    name: string;
    state: ContainerState;
    createdAt: Date;
    lastUsedAt?: Date;
    workerType?: HeadlessWorkerType;
    executionCount: number;
    healthCheckFailures: number;
    pid?: number;
}
/**
 * Container pool configuration
 */
export interface ContainerPoolConfig {
    /** Maximum number of containers in the pool */
    maxContainers: number;
    /** Minimum number of containers to keep warm */
    minContainers: number;
    /** Docker image to use */
    image: string;
    /** Container resource limits */
    resources: {
        cpus: string;
        memory: string;
    };
    /** Health check interval in ms */
    healthCheckIntervalMs: number;
    /** Container idle timeout in ms */
    idleTimeoutMs: number;
    /** Workspace volume mount path */
    workspacePath: string;
    /** State persistence path */
    statePath: string;
    /** Network name for container isolation */
    network?: string;
    /** Environment variables for containers */
    env?: Record<string, string>;
    /** Default sandbox mode */
    defaultSandbox: SandboxMode;
}
/**
 * Container execution options
 */
export interface ContainerExecutionOptions {
    workerType: HeadlessWorkerType;
    prompt: string;
    contextPatterns?: string[];
    sandbox?: SandboxMode;
    model?: string;
    timeoutMs?: number;
}
/**
 * Pool status
 */
export interface ContainerPoolStatus {
    totalContainers: number;
    readyContainers: number;
    busyContainers: number;
    unhealthyContainers: number;
    queuedTasks: number;
    containers: ContainerInfo[];
    dockerAvailable: boolean;
    lastHealthCheck?: Date;
}
/**
 * ContainerWorkerPool - Manages Docker containers for headless worker execution
 */
export declare class ContainerWorkerPool extends EventEmitter {
    private config;
    private projectRoot;
    private containers;
    private taskQueue;
    private healthCheckTimer?;
    private idleCheckTimer?;
    private dockerAvailable;
    private initialized;
    private isShuttingDown;
    private exitHandlersRegistered;
    constructor(projectRoot: string, config?: Partial<ContainerPoolConfig>);
    /**
     * Initialize the container pool
     */
    initialize(): Promise<boolean>;
    /**
     * Register process exit handlers to clean up containers
     */
    private registerExitHandlers;
    /**
     * Execute a worker in a container
     */
    execute(options: ContainerExecutionOptions): Promise<HeadlessExecutionResult>;
    /**
     * Scale pool for batch execution
     */
    scaleForBatch(workerCount: number): Promise<void>;
    /**
     * Get pool status
     */
    getStatus(): ContainerPoolStatus;
    /**
     * Shutdown the pool
     */
    shutdown(): Promise<void>;
    /**
     * Check if Docker is available (async)
     */
    private checkDockerAvailable;
    /**
     * Ensure the container image exists (async)
     */
    private ensureImage;
    /**
     * Create a new container
     */
    private createContainer;
    /**
     * Terminate a container (async)
     */
    private terminateContainer;
    /**
     * Get a ready container
     */
    private getReadyContainer;
    /**
     * Scale to minimum containers
     */
    private scaleToMinimum;
    /**
     * Execute worker in a specific container
     */
    private executeInContainer;
    /**
     * Execute command in container
     */
    private execInContainer;
    /**
     * Build worker command for container execution
     */
    private buildWorkerCommand;
    /**
     * Process queued tasks
     */
    private processQueue;
    /**
     * Start health check timer
     */
    private startHealthChecks;
    /**
     * Run health checks on all containers
     */
    private runHealthChecks;
    /**
     * Start idle check timer
     */
    private startIdleChecks;
    /**
     * Terminate idle containers above minimum
     */
    private runIdleChecks;
    /**
     * Try to parse JSON from output
     */
    private tryParseJson;
    /**
     * Create an error result
     */
    private createErrorResult;
}
export default ContainerWorkerPool;
//# sourceMappingURL=container-worker-pool.d.ts.map