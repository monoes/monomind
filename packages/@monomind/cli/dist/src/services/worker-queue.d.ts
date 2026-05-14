/**
 * Worker Queue Service
 * Redis-based task queue for distributed headless worker execution.
 *
 * ADR-020: Headless Worker Integration Architecture - Phase 4
 * - Priority-based task scheduling
 * - Result persistence and retrieval
 * - Distributed locking for task assignment
 * - Dead letter queue for failed tasks
 * - Metrics and monitoring
 *
 * Key Features:
 * - FIFO with priority levels (critical, high, normal, low)
 * - Automatic retry with exponential backoff
 * - Task timeout detection
 * - Result caching with TTL
 * - Worker heartbeat monitoring
 */
import { EventEmitter } from 'events';
import type { HeadlessWorkerType, HeadlessExecutionResult, WorkerPriority } from './headless-worker-executor.js';
/**
 * Task status
 */
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'timeout' | 'cancelled';
/**
 * Queue task
 */
export interface QueueTask {
    id: string;
    workerType: HeadlessWorkerType;
    priority: WorkerPriority;
    payload: {
        prompt?: string;
        contextPatterns?: string[];
        sandbox?: string;
        model?: string;
        timeoutMs?: number;
    };
    status: TaskStatus;
    createdAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    workerId?: string;
    retryCount: number;
    maxRetries: number;
    result?: HeadlessExecutionResult;
    error?: string;
}
/**
 * Queue configuration
 */
export interface WorkerQueueConfig {
    /** Redis connection URL */
    redisUrl: string;
    /** Queue name prefix */
    queuePrefix: string;
    /** Default task timeout in ms */
    defaultTimeoutMs: number;
    /** Maximum retries for failed tasks */
    maxRetries: number;
    /** Task result TTL in seconds */
    resultTtlSeconds: number;
    /** Worker heartbeat interval in ms */
    heartbeatIntervalMs: number;
    /** Dead letter queue enabled */
    deadLetterEnabled: boolean;
    /** Visibility timeout in ms (task processing lock) */
    visibilityTimeoutMs: number;
}
/**
 * Queue statistics
 */
export interface QueueStats {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    deadLetter: number;
    byPriority: Record<WorkerPriority, number>;
    byWorkerType: Partial<Record<HeadlessWorkerType, number>>;
    averageWaitTimeMs: number;
    averageProcessingTimeMs: number;
}
/**
 * Worker registration info
 */
export interface WorkerRegistration {
    workerId: string;
    workerTypes: HeadlessWorkerType[];
    maxConcurrent: number;
    currentTasks: number;
    lastHeartbeat: Date;
    registeredAt: Date;
    hostname?: string;
    containerId?: string;
}
/**
 * WorkerQueue - Redis-based task queue for distributed worker execution
 */
export declare class WorkerQueue extends EventEmitter {
    private config;
    private store;
    private workerId;
    private heartbeatTimer?;
    private visibilityTimer?;
    private retryTimers;
    private processingTasks;
    private taskGenerations;
    private isShuttingDown;
    private maxConcurrent;
    private initialized;
    constructor(config?: Partial<WorkerQueueConfig>);
    /**
     * Initialize the queue (starts cleanup timers)
     */
    initialize(): Promise<void>;
    /**
     * Requeue processing tasks that exceeded the visibility timeout (crashed workers).
     */
    private startVisibilityReaper;
    /**
     * Enqueue a new task
     */
    enqueue(workerType: HeadlessWorkerType, payload?: QueueTask['payload'], options?: {
        priority?: WorkerPriority;
        maxRetries?: number;
        timeoutMs?: number;
    }): Promise<string>;
    /**
     * Dequeue a task for processing
     */
    dequeue(workerTypes: HeadlessWorkerType[]): Promise<QueueTask | null>;
    /**
     * Complete a task with result
     */
    complete(taskId: string, result: HeadlessExecutionResult, leaseGen?: number): Promise<void>;
    /**
     * Fail a task with error
     */
    fail(taskId: string, error: string, retryable?: boolean, leaseGen?: number): Promise<void>;
    /**
     * Get task status
     */
    getTask(taskId: string): Promise<QueueTask | null>;
    /**
     * Get task result
     */
    getResult(taskId: string): Promise<HeadlessExecutionResult | null>;
    /**
     * Cancel a pending task
     */
    cancel(taskId: string): Promise<boolean>;
    /**
     * Register this instance as a worker
     */
    registerWorker(workerTypes: HeadlessWorkerType[], options?: {
        maxConcurrent?: number;
        hostname?: string;
        containerId?: string;
    }): Promise<string>;
    /**
     * Unregister this worker
     */
    unregisterWorker(): Promise<void>;
    /**
     * Get all registered workers
     */
    getWorkers(): Promise<WorkerRegistration[]>;
    /**
     * Get queue statistics
     */
    getStats(): Promise<QueueStats>;
    /**
     * Start processing tasks
     */
    start(workerTypes: HeadlessWorkerType[], handler: (task: QueueTask) => Promise<HeadlessExecutionResult>, options?: {
        maxConcurrent?: number;
    }): Promise<void>;
    /**
     * Process a single task
     */
    private processTask;
    /**
     * Shutdown the queue gracefully
     */
    shutdown(): Promise<void>;
    /**
     * Get queue name for worker type
     */
    private getQueueName;
    /**
     * Start heartbeat timer
     */
    private startHeartbeat;
    /**
     * Stop heartbeat timer
     */
    private stopHeartbeat;
}
export default WorkerQueue;
//# sourceMappingURL=worker-queue.d.ts.map