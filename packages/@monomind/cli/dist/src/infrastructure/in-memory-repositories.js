/**
 * In-Memory Repositories - CLI Infrastructure
 *
 * Lightweight in-memory implementations for CLI use.
 *
 * @module v1/cli/infrastructure
 */
/**
 * In-Memory Agent Repository
 */
export class InMemoryAgentRepository {
    agents = new Map();
    initialized = false;
    async initialize() {
        this.initialized = true;
    }
    async shutdown() {
        this.agents.clear();
        this.initialized = false;
    }
    async clear() {
        this.agents.clear();
    }
    async save(agent) {
        this.agents.set(agent.id, agent);
    }
    async findById(id) {
        return this.agents.get(id) ?? null;
    }
    async findByName(name) {
        for (const agent of this.agents.values()) {
            if (agent.name === name)
                return agent;
        }
        return null;
    }
    async delete(id) {
        return this.agents.delete(id);
    }
    async exists(id) {
        return this.agents.has(id);
    }
    async saveMany(agents) {
        for (const agent of agents) {
            this.agents.set(agent.id, agent);
        }
    }
    async findByIds(ids) {
        return ids.map((id) => this.agents.get(id)).filter((a) => a !== undefined);
    }
    async deleteMany(ids) {
        let deleted = 0;
        for (const id of ids) {
            if (this.agents.delete(id))
                deleted++;
        }
        return deleted;
    }
    async findAll(options) {
        let result = Array.from(this.agents.values());
        if (options?.status)
            result = result.filter((a) => a.status === options.status);
        if (options?.role)
            result = result.filter((a) => a.role === options.role);
        if (options?.domain)
            result = result.filter((a) => a.domain === options.domain);
        if (options?.limit)
            result = result.slice(0, options.limit);
        return result;
    }
    async findByStatus(status) {
        return this.findAll({ status });
    }
    async findByRole(role) {
        return this.findAll({ role });
    }
    async findByDomain(domain) {
        return this.findAll({ domain });
    }
    async findByParent(parentId) {
        return Array.from(this.agents.values()).filter((a) => a.parentId === parentId);
    }
    async findByCapability(capability) {
        return Array.from(this.agents.values()).filter((a) => a.hasCapability(capability));
    }
    async findAvailable() {
        return Array.from(this.agents.values()).filter((a) => a.isAvailable());
    }
    async getStatistics() {
        const agents = Array.from(this.agents.values());
        const byStatus = {
            idle: 0,
            active: 0,
            busy: 0,
            paused: 0,
            terminated: 0,
            error: 0,
        };
        const byRole = {};
        const byDomain = {};
        let totalCompleted = 0;
        let totalUtilization = 0;
        for (const agent of agents) {
            byStatus[agent.status]++;
            byRole[agent.role] = (byRole[agent.role] ?? 0) + 1;
            byDomain[agent.domain] = (byDomain[agent.domain] ?? 0) + 1;
            totalCompleted += agent.completedTaskCount;
            totalUtilization += agent.getUtilization();
        }
        return {
            total: agents.length,
            byStatus,
            byRole,
            byDomain,
            totalTasksCompleted: totalCompleted,
            averageUtilization: agents.length > 0 ? totalUtilization / agents.length : 0,
        };
    }
    async count(options) {
        return (await this.findAll(options)).length;
    }
}
/**
 * In-Memory Task Repository
 */
export class InMemoryTaskRepository {
    tasks = new Map();
    initialized = false;
    async initialize() {
        this.initialized = true;
    }
    async shutdown() {
        this.tasks.clear();
        this.initialized = false;
    }
    async clear() {
        this.tasks.clear();
    }
    async save(task) {
        this.tasks.set(task.id, task);
    }
    async findById(id) {
        return this.tasks.get(id) ?? null;
    }
    async delete(id) {
        return this.tasks.delete(id);
    }
    async exists(id) {
        return this.tasks.has(id);
    }
    async saveMany(tasks) {
        for (const task of tasks) {
            this.tasks.set(task.id, task);
        }
    }
    async findByIds(ids) {
        return ids.map((id) => this.tasks.get(id)).filter((t) => t !== undefined);
    }
    async deleteMany(ids) {
        let deleted = 0;
        for (const id of ids) {
            if (this.tasks.delete(id))
                deleted++;
        }
        return deleted;
    }
    async findAll(options) {
        let result = Array.from(this.tasks.values());
        if (options?.status)
            result = result.filter((t) => t.status === options.status);
        if (options?.priority)
            result = result.filter((t) => t.priority === options.priority);
        if (options?.type)
            result = result.filter((t) => t.type === options.type);
        if (options?.assignedAgentId)
            result = result.filter((t) => t.assignedAgentId === options.assignedAgentId);
        if (options?.limit)
            result = result.slice(0, options.limit);
        return result;
    }
    async findByStatus(status) {
        return this.findAll({ status });
    }
    async findByPriority(priority) {
        return this.findAll({ priority });
    }
    async findByAgent(agentId) {
        return this.findAll({ assignedAgentId: agentId });
    }
    async findPending() {
        return this.findByStatus('pending');
    }
    async findQueued() {
        return this.findByStatus('queued');
    }
    async findRunning() {
        return this.findByStatus('running');
    }
    async findTimedOut() {
        return Array.from(this.tasks.values()).filter((t) => t.isTimedOut());
    }
    async getNextTask(agentCapabilities) {
        const queued = await this.findQueued();
        if (queued.length === 0)
            return null;
        queued.sort((a, b) => a.comparePriority(b));
        return queued[0];
    }
    async getTaskQueue(limit = 10) {
        const queued = await this.findQueued();
        queued.sort((a, b) => a.comparePriority(b));
        return queued.slice(0, limit);
    }
    async getStatistics() {
        const tasks = Array.from(this.tasks.values());
        const byStatus = {
            pending: 0,
            queued: 0,
            assigned: 0,
            running: 0,
            completed: 0,
            failed: 0,
            cancelled: 0,
        };
        const byPriority = {
            critical: 0,
            high: 0,
            normal: 0,
            low: 0,
        };
        const byType = {};
        let totalDuration = 0;
        let completedCount = 0;
        let failedCount = 0;
        let retryTotal = 0;
        for (const task of tasks) {
            byStatus[task.status]++;
            byPriority[task.priority]++;
            byType[task.type] = (byType[task.type] ?? 0) + 1;
            if (task.status === 'completed') {
                completedCount++;
                const duration = task.getExecutionDuration();
                if (duration)
                    totalDuration += duration;
            }
            if (task.status === 'failed')
                failedCount++;
            retryTotal += task.retryCount;
        }
        return {
            total: tasks.length,
            byStatus,
            byPriority,
            byType,
            averageExecutionTime: completedCount > 0 ? totalDuration / completedCount : 0,
            successRate: tasks.length > 0 ? completedCount / tasks.length : 0,
            retryRate: tasks.length > 0 ? retryTotal / tasks.length : 0,
        };
    }
    async count(options) {
        return (await this.findAll(options)).length;
    }
}
//# sourceMappingURL=in-memory-repositories.js.map