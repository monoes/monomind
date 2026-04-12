/**
 * @monobrain/mcp - Task Manager
 *
 * MCP 2025-11-25 compliant async task management
 * Supports: task tracking, progress reporting, cancellation
 */
import { EventEmitter } from 'events';
import type { TaskState, TaskProgress, TaskResult, ILogger } from './types.js';
export type TaskExecutor<T = unknown> = (reportProgress: (progress: TaskProgress) => void, signal: AbortSignal) => Promise<T>;
export interface TaskManagerOptions {
    maxConcurrentTasks?: number;
    taskTimeout?: number;
    cleanupInterval?: number;
    taskRetentionTime?: number;
}
export declare class TaskManager extends EventEmitter {
    private readonly logger;
    private tasks;
    private runningCount;
    private taskCounter;
    private cleanupTimer?;
    private readonly options;
    constructor(logger: ILogger, options?: TaskManagerOptions);
    /**
     * Create a new task
     */
    createTask<T>(executor: TaskExecutor<T>, metadata?: Record<string, unknown>): string;
    /**
     * Start a pending task
     */
    private startTask;
    /**
     * Start next pending task if available
     */
    private startNextPendingTask;
    /**
     * Cancel a task
     */
    cancelTask(taskId: string, reason?: string): boolean;
    /**
     * Get task status
     */
    getTask(taskId: string): TaskResult | undefined;
    /**
     * Get all tasks
     */
    getAllTasks(): TaskResult[];
    /**
     * Get tasks by state
     */
    getTasksByState(state: TaskState): TaskResult[];
    /**
     * Wait for task completion
     */
    waitForTask(taskId: string, timeout?: number): Promise<TaskResult>;
    /**
     * Get stats
     */
    getStats(): {
        totalTasks: number;
        pendingTasks: number;
        runningTasks: number;
        completedTasks: number;
        failedTasks: number;
        cancelledTasks: number;
    };
    /**
     * Start cleanup timer
     */
    private startCleanupTimer;
    /**
     * Cleanup old completed/failed/cancelled tasks
     */
    private cleanupOldTasks;
    /**
     * Destroy the task manager
     */
    destroy(): void;
}
export declare function createTaskManager(logger: ILogger, options?: TaskManagerOptions): TaskManager;
//# sourceMappingURL=task-manager.d.ts.map