/**
 * @monobrain/mcp - Task Manager
 *
 * MCP 2025-11-25 compliant async task management
 * Supports: task tracking, progress reporting, cancellation
 */
import { EventEmitter } from 'events';
export class TaskManager extends EventEmitter {
    logger;
    tasks = new Map();
    runningCount = 0;
    taskCounter = 0;
    cleanupTimer;
    options;
    constructor(logger, options = {}) {
        super();
        this.logger = logger;
        this.options = {
            maxConcurrentTasks: options.maxConcurrentTasks ?? 10,
            taskTimeout: options.taskTimeout ?? 300000, // 5 minutes
            cleanupInterval: options.cleanupInterval ?? 60000, // 1 minute
            taskRetentionTime: options.taskRetentionTime ?? 3600000, // 1 hour
        };
        this.startCleanupTimer();
    }
    /**
     * Create a new task
     */
    createTask(executor, metadata) {
        const taskId = `task-${++this.taskCounter}-${Date.now()}`;
        const now = new Date();
        const task = {
            id: taskId,
            state: 'pending',
            createdAt: now,
            updatedAt: now,
            metadata,
            executor: executor,
        };
        this.tasks.set(taskId, task);
        this.logger.debug('Task created', { taskId });
        this.emit('task:created', { taskId });
        // Auto-start if we have capacity
        if (this.runningCount < this.options.maxConcurrentTasks) {
            this.startTask(taskId);
        }
        return taskId;
    }
    /**
     * Start a pending task
     */
    async startTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task || task.state !== 'pending') {
            return;
        }
        if (this.runningCount >= this.options.maxConcurrentTasks) {
            return;
        }
        task.state = 'running';
        task.updatedAt = new Date();
        task.abortController = new AbortController();
        this.runningCount++;
        this.logger.debug('Task started', { taskId });
        this.emit('task:started', { taskId });
        // Set up timeout
        const timeoutId = setTimeout(() => {
            this.cancelTask(taskId, 'Task timeout');
        }, this.options.taskTimeout);
        // Progress reporter
        const reportProgress = (progress) => {
            task.progress = progress;
            task.updatedAt = new Date();
            this.emit('task:progress', { taskId, progress });
        };
        try {
            const result = await task.executor(reportProgress, task.abortController.signal);
            clearTimeout(timeoutId);
            if (task.state === 'running') {
                task.state = 'completed';
                task.result = result;
                task.updatedAt = new Date();
                task.progress = { progress: 100, total: 100 };
                this.logger.debug('Task completed', { taskId });
                this.emit('task:completed', { taskId, result });
            }
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (task.state === 'running') {
                if (task.abortController.signal.aborted) {
                    task.state = 'cancelled';
                    this.logger.debug('Task cancelled', { taskId });
                    this.emit('task:cancelled', { taskId });
                }
                else {
                    task.state = 'failed';
                    task.error = {
                        code: -32603,
                        message: error instanceof Error ? error.message : 'Task failed',
                    };
                    this.logger.error('Task failed', { taskId, error });
                    this.emit('task:failed', { taskId, error: task.error });
                }
                task.updatedAt = new Date();
            }
        }
        finally {
            this.runningCount--;
            task.abortController = undefined;
            // Start next pending task
            this.startNextPendingTask();
        }
    }
    /**
     * Start next pending task if available
     */
    startNextPendingTask() {
        for (const [taskId, task] of this.tasks) {
            if (task.state === 'pending') {
                this.startTask(taskId);
                break;
            }
        }
    }
    /**
     * Cancel a task
     */
    cancelTask(taskId, reason) {
        const task = this.tasks.get(taskId);
        if (!task) {
            return false;
        }
        if (task.state !== 'pending' && task.state !== 'running') {
            return false;
        }
        if (task.abortController) {
            task.abortController.abort(reason);
        }
        if (task.state === 'pending') {
            task.state = 'cancelled';
            task.updatedAt = new Date();
            task.error = { code: -32800, message: reason || 'Cancelled' };
            this.emit('task:cancelled', { taskId, reason });
        }
        this.logger.debug('Task cancel requested', { taskId, reason });
        return true;
    }
    /**
     * Get task status
     */
    getTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task) {
            return undefined;
        }
        return {
            taskId: task.id,
            state: task.state,
            progress: task.progress,
            result: task.result,
            error: task.error,
        };
    }
    /**
     * Get all tasks
     */
    getAllTasks() {
        return Array.from(this.tasks.values()).map((task) => ({
            taskId: task.id,
            state: task.state,
            progress: task.progress,
            result: task.result,
            error: task.error,
        }));
    }
    /**
     * Get tasks by state
     */
    getTasksByState(state) {
        return Array.from(this.tasks.values())
            .filter((task) => task.state === state)
            .map((task) => ({
            taskId: task.id,
            state: task.state,
            progress: task.progress,
            result: task.result,
            error: task.error,
        }));
    }
    /**
     * Wait for task completion
     */
    async waitForTask(taskId, timeout) {
        const task = this.tasks.get(taskId);
        if (!task) {
            throw new Error(`Task not found: ${taskId}`);
        }
        const effectiveTimeout = timeout ?? this.options.taskTimeout;
        return new Promise((resolve, reject) => {
            const checkState = () => {
                const result = this.getTask(taskId);
                if (!result) {
                    reject(new Error(`Task not found: ${taskId}`));
                    return true;
                }
                if (result.state === 'completed' || result.state === 'failed' || result.state === 'cancelled') {
                    resolve(result);
                    return true;
                }
                return false;
            };
            if (checkState())
                return;
            const timeoutId = setTimeout(() => {
                this.off('task:completed', onComplete);
                this.off('task:failed', onFail);
                this.off('task:cancelled', onCancel);
                reject(new Error(`Wait timeout for task: ${taskId}`));
            }, effectiveTimeout);
            const cleanup = () => {
                clearTimeout(timeoutId);
                this.off('task:completed', onComplete);
                this.off('task:failed', onFail);
                this.off('task:cancelled', onCancel);
            };
            const onComplete = (event) => {
                if (event.taskId === taskId) {
                    cleanup();
                    resolve(this.getTask(taskId));
                }
            };
            const onFail = (event) => {
                if (event.taskId === taskId) {
                    cleanup();
                    resolve(this.getTask(taskId));
                }
            };
            const onCancel = (event) => {
                if (event.taskId === taskId) {
                    cleanup();
                    resolve(this.getTask(taskId));
                }
            };
            this.on('task:completed', onComplete);
            this.on('task:failed', onFail);
            this.on('task:cancelled', onCancel);
        });
    }
    /**
     * Get stats
     */
    getStats() {
        let pending = 0;
        let running = 0;
        let completed = 0;
        let failed = 0;
        let cancelled = 0;
        for (const task of this.tasks.values()) {
            switch (task.state) {
                case 'pending':
                    pending++;
                    break;
                case 'running':
                    running++;
                    break;
                case 'completed':
                    completed++;
                    break;
                case 'failed':
                    failed++;
                    break;
                case 'cancelled':
                    cancelled++;
                    break;
            }
        }
        return {
            totalTasks: this.tasks.size,
            pendingTasks: pending,
            runningTasks: running,
            completedTasks: completed,
            failedTasks: failed,
            cancelledTasks: cancelled,
        };
    }
    /**
     * Start cleanup timer
     */
    startCleanupTimer() {
        this.cleanupTimer = setInterval(() => {
            this.cleanupOldTasks();
        }, this.options.cleanupInterval);
    }
    /**
     * Cleanup old completed/failed/cancelled tasks
     */
    cleanupOldTasks() {
        const now = Date.now();
        const toDelete = [];
        for (const [taskId, task] of this.tasks) {
            if ((task.state === 'completed' || task.state === 'failed' || task.state === 'cancelled') &&
                now - task.updatedAt.getTime() > this.options.taskRetentionTime) {
                toDelete.push(taskId);
            }
        }
        for (const taskId of toDelete) {
            this.tasks.delete(taskId);
            this.logger.debug('Task cleaned up', { taskId });
        }
        if (toDelete.length > 0) {
            this.emit('tasks:cleaned', { count: toDelete.length });
        }
    }
    /**
     * Destroy the task manager
     */
    destroy() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }
        // Cancel all running tasks
        for (const task of this.tasks.values()) {
            if (task.abortController) {
                task.abortController.abort('Task manager destroyed');
            }
        }
        this.tasks.clear();
        this.removeAllListeners();
        this.logger.debug('Task manager destroyed');
    }
}
export function createTaskManager(logger, options) {
    return new TaskManager(logger, options);
}
//# sourceMappingURL=task-manager.js.map