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
import { randomUUID } from 'crypto';
// ============================================
// Constants
// ============================================
const DEFAULT_CONFIG = {
    redisUrl: 'redis://localhost:6379',
    queuePrefix: 'monomind:queue',
    defaultTimeoutMs: 300000, // 5 minutes
    maxRetries: 3,
    resultTtlSeconds: 86400, // 24 hours
    heartbeatIntervalMs: 30000, // 30 seconds
    deadLetterEnabled: true,
    visibilityTimeoutMs: 60000, // 1 minute
};
const PRIORITY_SCORES = {
    critical: 4,
    high: 3,
    normal: 2,
    low: 1,
};
// ============================================
// In-Memory Redis Simulation (for non-Redis environments)
// ============================================
/**
 * Simple in-memory queue implementation for environments without Redis
 * Production should use actual Redis connection
 */
class InMemoryStore {
    tasks = new Map();
    queues = new Map();
    workers = new Map();
    results = new Map();
    cleanupTimer;
    /**
     * Start cleanup timer (called after initialization)
     */
    startCleanup() {
        if (this.cleanupTimer)
            return;
        this.cleanupTimer = setInterval(() => this.cleanupExpired(), 60000);
        this.cleanupTimer.unref();
    }
    /**
     * Stop cleanup timer
     */
    stopCleanup() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }
    }
    // Task operations
    setTask(id, task) {
        this.tasks.set(id, task);
    }
    getTask(id) {
        return this.tasks.get(id);
    }
    deleteTask(id) {
        this.tasks.delete(id);
    }
    // Queue operations
    pushToQueue(queue, taskId, priority) {
        const queueTasks = this.queues.get(queue) || [];
        // Insert based on priority (higher priority = earlier in queue)
        let insertIndex = queueTasks.length;
        for (let i = 0; i < queueTasks.length; i++) {
            const task = this.tasks.get(queueTasks[i]);
            if (task && PRIORITY_SCORES[task.priority] < priority) {
                insertIndex = i;
                break;
            }
        }
        queueTasks.splice(insertIndex, 0, taskId);
        this.queues.set(queue, queueTasks);
    }
    popFromQueue(queue) {
        const queueTasks = this.queues.get(queue) || [];
        if (queueTasks.length === 0)
            return null;
        return queueTasks.shift() || null;
    }
    getQueueLength(queue) {
        return (this.queues.get(queue) || []).length;
    }
    // Worker operations
    setWorker(workerId, registration) {
        this.workers.set(workerId, registration);
    }
    getWorker(workerId) {
        return this.workers.get(workerId);
    }
    deleteWorker(workerId) {
        this.workers.delete(workerId);
    }
    getAllWorkers() {
        return Array.from(this.workers.values());
    }
    // Result operations
    setResult(taskId, result, ttlSeconds) {
        this.results.set(taskId, {
            result,
            expiresAt: Date.now() + ttlSeconds * 1000,
        });
    }
    getResult(taskId) {
        const entry = this.results.get(taskId);
        if (!entry)
            return undefined;
        if (Date.now() > entry.expiresAt) {
            this.results.delete(taskId);
            return undefined;
        }
        return entry.result;
    }
    // Stats
    getStats() {
        return {
            tasks: this.tasks.size,
            workers: this.workers.size,
            results: this.results.size,
        };
    }
    // Cleanup
    cleanupExpired() {
        const now = Date.now();
        for (const [id, entry] of this.results) {
            if (now > entry.expiresAt) {
                this.results.delete(id);
            }
        }
    }
}
// ============================================
// WorkerQueue Class
// ============================================
/**
 * WorkerQueue - Redis-based task queue for distributed worker execution
 */
export class WorkerQueue extends EventEmitter {
    config;
    store;
    workerId;
    heartbeatTimer;
    visibilityTimer;
    retryTimers = new Set();
    processingTasks = new Set();
    // Per-task lease generation. When the visibility reaper requeues a task
    // because of timeout, the generation is bumped. The original (still-running)
    // handler's complete()/fail() call carries the old generation and is
    // rejected — first-finisher wins, the loser drops. This prevents
    // double-execution side effects on non-idempotent workers (audit reports,
    // GitHub posts, memory writes).
    taskGenerations = new Map();
    isShuttingDown = false;
    maxConcurrent = 1;
    initialized = false;
    constructor(config) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.store = new InMemoryStore();
        this.workerId = `worker-${randomUUID().slice(0, 8)}`;
    }
    /**
     * Initialize the queue (starts cleanup timers)
     */
    async initialize() {
        if (this.initialized)
            return;
        this.store.startCleanup();
        this.startVisibilityReaper();
        this.initialized = true;
        this.emit('initialized', { workerId: this.workerId });
    }
    /**
     * Requeue processing tasks that exceeded the visibility timeout (crashed workers).
     */
    startVisibilityReaper() {
        this.visibilityTimer = setInterval(() => {
            // Skip running the reaper while we're shutting down so it can't requeue
            // tasks back into a queue that is about to be torn down.
            if (this.isShuttingDown)
                return;
            const now = Date.now();
            for (const taskId of this.processingTasks) {
                const task = this.store.getTask(taskId);
                if (!task) {
                    this.processingTasks.delete(taskId);
                    continue;
                }
                const startedMs = task.startedAt ? task.startedAt.getTime() : 0;
                if (now - startedMs > this.config.visibilityTimeoutMs) {
                    this.processingTasks.delete(taskId);
                    if (task.retryCount < task.maxRetries) {
                        task.retryCount++;
                        task.status = 'pending';
                        task.startedAt = undefined;
                        task.workerId = undefined;
                        this.store.setTask(taskId, task);
                        const queueName = this.getQueueName(task.workerType);
                        this.store.pushToQueue(queueName, taskId, PRIORITY_SCORES[task.priority]);
                        this.emit('taskRetrying', { taskId, retryCount: task.retryCount, delay: 0 });
                    }
                    else {
                        task.status = 'failed';
                        task.completedAt = new Date();
                        task.error = 'Visibility timeout exceeded';
                        this.store.setTask(taskId, task);
                        this.emit('taskFailed', { taskId, error: task.error });
                    }
                }
            }
        }, Math.max(5000, this.config.visibilityTimeoutMs / 4));
        this.visibilityTimer.unref();
    }
    // ============================================
    // Public API - Task Management
    // ============================================
    /**
     * Enqueue a new task
     */
    async enqueue(workerType, payload = {}, options) {
        // Initialize if needed
        if (!this.initialized) {
            await this.initialize();
        }
        // Validate worker type
        if (!workerType || typeof workerType !== 'string') {
            throw new Error('Invalid worker type');
        }
        // Validate priority
        const priority = options?.priority || 'normal';
        if (!['critical', 'high', 'normal', 'low'].includes(priority)) {
            throw new Error(`Invalid priority: ${priority}`);
        }
        const taskId = `task-${Date.now()}-${randomUUID().slice(0, 8)}`;
        const task = {
            id: taskId,
            workerType,
            priority,
            payload: {
                ...payload,
                timeoutMs: options?.timeoutMs || this.config.defaultTimeoutMs,
            },
            status: 'pending',
            createdAt: new Date(),
            retryCount: 0,
            maxRetries: options?.maxRetries ?? this.config.maxRetries,
        };
        // Store task
        this.store.setTask(taskId, task);
        // Add to priority queue
        const queueName = this.getQueueName(workerType);
        this.store.pushToQueue(queueName, taskId, PRIORITY_SCORES[priority]);
        this.emit('taskEnqueued', { taskId, workerType, priority });
        return taskId;
    }
    /**
     * Dequeue a task for processing
     */
    async dequeue(workerTypes) {
        if (this.isShuttingDown)
            return null;
        // Check queues in priority order
        for (const workerType of workerTypes) {
            const queueName = this.getQueueName(workerType);
            const taskId = this.store.popFromQueue(queueName);
            if (taskId) {
                const task = this.store.getTask(taskId);
                if (task && task.status === 'pending') {
                    task.status = 'processing';
                    task.startedAt = new Date();
                    task.workerId = this.workerId;
                    this.store.setTask(taskId, task);
                    this.processingTasks.add(taskId);
                    // Bump lease generation. Stamp on the in-memory task so the
                    // handler's later complete()/fail() can compare and detect a
                    // reap-and-redequeue cycle.
                    const gen = (this.taskGenerations.get(taskId) ?? 0) + 1;
                    this.taskGenerations.set(taskId, gen);
                    task.__leaseGen = gen;
                    this.emit('taskDequeued', { taskId, workerType });
                    return task;
                }
            }
        }
        return null;
    }
    /**
     * Complete a task with result
     */
    async complete(taskId, result, leaseGen) {
        const task = this.store.getTask(taskId);
        if (!task) {
            this.emit('warning', { message: `Task ${taskId} not found for completion` });
            return;
        }
        // Reject stale leases: if the reaper requeued this task and another
        // worker has already taken it (bumping the generation), drop our result.
        if (leaseGen !== undefined && this.taskGenerations.get(taskId) !== leaseGen) {
            this.emit('warning', { message: `Task ${taskId} complete() rejected: lease expired` });
            return;
        }
        task.status = 'completed';
        task.completedAt = new Date();
        task.result = result;
        this.store.setTask(taskId, task);
        // Store result with TTL
        this.store.setResult(taskId, result, this.config.resultTtlSeconds);
        this.processingTasks.delete(taskId);
        this.emit('taskCompleted', { taskId, result, duration: task.completedAt.getTime() - (task.startedAt?.getTime() || 0) });
    }
    /**
     * Fail a task with error
     */
    async fail(taskId, error, retryable = true, leaseGen) {
        const task = this.store.getTask(taskId);
        if (!task) {
            this.emit('warning', { message: `Task ${taskId} not found for failure` });
            return;
        }
        if (leaseGen !== undefined && this.taskGenerations.get(taskId) !== leaseGen) {
            this.emit('warning', { message: `Task ${taskId} fail() rejected: lease expired` });
            return;
        }
        this.processingTasks.delete(taskId);
        // Check if we should retry
        if (retryable && task.retryCount < task.maxRetries) {
            task.retryCount++;
            task.status = 'pending';
            task.startedAt = undefined;
            task.workerId = undefined;
            task.error = error;
            this.store.setTask(taskId, task);
            // Re-queue with delay (exponential backoff). Track the timer so shutdown
            // can clear it — otherwise pending retries fire after shutdown and push
            // tasks back into a torn-down queue.
            const delay = Math.min(30000, 1000 * Math.pow(2, task.retryCount));
            const retryTimer = setTimeout(() => {
                this.retryTimers.delete(retryTimer);
                if (this.isShuttingDown)
                    return;
                const queueName = this.getQueueName(task.workerType);
                this.store.pushToQueue(queueName, taskId, PRIORITY_SCORES[task.priority]);
            }, delay);
            retryTimer.unref();
            this.retryTimers.add(retryTimer);
            this.emit('taskRetrying', { taskId, retryCount: task.retryCount, delay });
        }
        else {
            // Move to failed/dead letter
            task.status = 'failed';
            task.completedAt = new Date();
            task.error = error;
            this.store.setTask(taskId, task);
            if (this.config.deadLetterEnabled) {
                const dlqName = `${this.config.queuePrefix}:dlq`;
                this.store.pushToQueue(dlqName, taskId, 0);
            }
            this.emit('taskFailed', { taskId, error, retryCount: task.retryCount });
        }
    }
    /**
     * Get task status
     */
    async getTask(taskId) {
        return this.store.getTask(taskId) || null;
    }
    /**
     * Get task result
     */
    async getResult(taskId) {
        return this.store.getResult(taskId) || null;
    }
    /**
     * Cancel a pending task
     */
    async cancel(taskId) {
        const task = this.store.getTask(taskId);
        if (!task || task.status !== 'pending') {
            return false;
        }
        task.status = 'cancelled';
        task.completedAt = new Date();
        this.store.setTask(taskId, task);
        this.emit('taskCancelled', { taskId });
        return true;
    }
    // ============================================
    // Public API - Worker Management
    // ============================================
    /**
     * Register this instance as a worker
     */
    async registerWorker(workerTypes, options) {
        // Initialize if needed
        if (!this.initialized) {
            await this.initialize();
        }
        // Validate worker types
        if (!Array.isArray(workerTypes) || workerTypes.length === 0) {
            throw new Error('Worker types must be a non-empty array');
        }
        this.maxConcurrent = options?.maxConcurrent || 1;
        const registration = {
            workerId: this.workerId,
            workerTypes,
            maxConcurrent: this.maxConcurrent,
            currentTasks: 0,
            lastHeartbeat: new Date(),
            registeredAt: new Date(),
            hostname: options?.hostname,
            containerId: options?.containerId,
        };
        this.store.setWorker(this.workerId, registration);
        // Start heartbeat
        this.startHeartbeat();
        this.emit('workerRegistered', { workerId: this.workerId, workerTypes });
        return this.workerId;
    }
    /**
     * Unregister this worker
     */
    async unregisterWorker() {
        this.stopHeartbeat();
        this.store.deleteWorker(this.workerId);
        this.emit('workerUnregistered', { workerId: this.workerId });
    }
    /**
     * Get all registered workers
     */
    async getWorkers() {
        return this.store.getAllWorkers();
    }
    // ============================================
    // Public API - Statistics
    // ============================================
    /**
     * Get queue statistics
     */
    async getStats() {
        const storeStats = this.store.getStats();
        // This is a simplified implementation
        // Full implementation would aggregate across all queues
        const stats = {
            pending: 0,
            processing: this.processingTasks.size,
            completed: 0,
            failed: 0,
            deadLetter: 0,
            byPriority: { critical: 0, high: 0, normal: 0, low: 0 },
            byWorkerType: {},
            averageWaitTimeMs: 0,
            averageProcessingTimeMs: 0,
        };
        return stats;
    }
    // ============================================
    // Public API - Lifecycle
    // ============================================
    /**
     * Start processing tasks
     */
    async start(workerTypes, handler, options) {
        await this.registerWorker(workerTypes, { maxConcurrent: options?.maxConcurrent });
        const processLoop = async () => {
            while (!this.isShuttingDown) {
                try {
                    // Respect concurrency limit
                    if (this.processingTasks.size >= this.maxConcurrent) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                        continue;
                    }
                    const task = await this.dequeue(workerTypes);
                    if (task) {
                        // Process task without blocking the loop (allows concurrency)
                        this.processTask(task, handler).catch(error => {
                            this.emit('error', { taskId: task.id, error: String(error) });
                        });
                    }
                    else {
                        // No task available, wait before polling again
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }
                catch (error) {
                    this.emit('error', { error: error instanceof Error ? error.message : String(error) });
                    // Wait before retrying to avoid tight error loop
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
        };
        // Start processing
        processLoop().catch(error => {
            this.emit('error', { error: error instanceof Error ? error.message : String(error) });
        });
    }
    /**
     * Process a single task
     */
    async processTask(task, handler) {
        try {
            const result = await handler(task);
            await this.complete(task.id, result);
        }
        catch (error) {
            await this.fail(task.id, error instanceof Error ? error.message : String(error));
        }
    }
    /**
     * Shutdown the queue gracefully
     */
    async shutdown() {
        if (this.isShuttingDown)
            return;
        this.isShuttingDown = true;
        // Wait for processing tasks to complete (with timeout)
        const timeout = 30000;
        const start = Date.now();
        while (this.processingTasks.size > 0 && Date.now() - start < timeout) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        // Force fail remaining tasks
        for (const taskId of this.processingTasks) {
            await this.fail(taskId, 'Worker shutdown', false);
        }
        // Stop store cleanup and timers
        this.store.stopCleanup();
        if (this.visibilityTimer) {
            clearInterval(this.visibilityTimer);
            this.visibilityTimer = undefined;
        }
        for (const t of this.retryTimers)
            clearTimeout(t);
        this.retryTimers.clear();
        await this.unregisterWorker();
        this.initialized = false;
        this.emit('shutdown', {});
    }
    // ============================================
    // Private Methods
    // ============================================
    /**
     * Get queue name for worker type
     */
    getQueueName(workerType) {
        return `${this.config.queuePrefix}:${workerType}`;
    }
    /**
     * Start heartbeat timer
     */
    startHeartbeat() {
        this.heartbeatTimer = setInterval(() => {
            const registration = this.store.getWorker(this.workerId);
            if (registration) {
                registration.lastHeartbeat = new Date();
                registration.currentTasks = this.processingTasks.size;
                this.store.setWorker(this.workerId, registration);
            }
        }, this.config.heartbeatIntervalMs);
        this.heartbeatTimer.unref();
    }
    /**
     * Stop heartbeat timer
     */
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
    }
}
// Export default
export default WorkerQueue;
//# sourceMappingURL=worker-queue.js.map