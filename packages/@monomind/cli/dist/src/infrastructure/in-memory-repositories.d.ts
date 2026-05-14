/**
 * In-Memory Repositories - CLI Infrastructure
 *
 * Lightweight in-memory implementations for CLI use.
 *
 * @module v1/cli/infrastructure
 */
import { Agent, AgentStatus, AgentRole } from '../../../swarm/src/domain/entities/agent.js';
import { Task, TaskStatus, TaskPriority } from '../../../swarm/src/domain/entities/task.js';
import { IAgentRepository, AgentQueryOptions, AgentStatistics } from '../../../swarm/src/domain/repositories/agent-repository.interface.js';
import { ITaskRepository, TaskQueryOptions, TaskStatistics } from '../../../swarm/src/domain/repositories/task-repository.interface.js';
/**
 * In-Memory Agent Repository
 */
export declare class InMemoryAgentRepository implements IAgentRepository {
    private agents;
    private initialized;
    initialize(): Promise<void>;
    shutdown(): Promise<void>;
    clear(): Promise<void>;
    save(agent: Agent): Promise<void>;
    findById(id: string): Promise<Agent | null>;
    findByName(name: string): Promise<Agent | null>;
    delete(id: string): Promise<boolean>;
    exists(id: string): Promise<boolean>;
    saveMany(agents: Agent[]): Promise<void>;
    findByIds(ids: string[]): Promise<Agent[]>;
    deleteMany(ids: string[]): Promise<number>;
    findAll(options?: AgentQueryOptions): Promise<Agent[]>;
    findByStatus(status: AgentStatus): Promise<Agent[]>;
    findByRole(role: AgentRole): Promise<Agent[]>;
    findByDomain(domain: string): Promise<Agent[]>;
    findByParent(parentId: string): Promise<Agent[]>;
    findByCapability(capability: string): Promise<Agent[]>;
    findAvailable(): Promise<Agent[]>;
    getStatistics(): Promise<AgentStatistics>;
    count(options?: AgentQueryOptions): Promise<number>;
}
/**
 * In-Memory Task Repository
 */
export declare class InMemoryTaskRepository implements ITaskRepository {
    private tasks;
    private initialized;
    initialize(): Promise<void>;
    shutdown(): Promise<void>;
    clear(): Promise<void>;
    save(task: Task): Promise<void>;
    findById(id: string): Promise<Task | null>;
    delete(id: string): Promise<boolean>;
    exists(id: string): Promise<boolean>;
    saveMany(tasks: Task[]): Promise<void>;
    findByIds(ids: string[]): Promise<Task[]>;
    deleteMany(ids: string[]): Promise<number>;
    findAll(options?: TaskQueryOptions): Promise<Task[]>;
    findByStatus(status: TaskStatus): Promise<Task[]>;
    findByPriority(priority: TaskPriority): Promise<Task[]>;
    findByAgent(agentId: string): Promise<Task[]>;
    findPending(): Promise<Task[]>;
    findQueued(): Promise<Task[]>;
    findRunning(): Promise<Task[]>;
    findTimedOut(): Promise<Task[]>;
    getNextTask(agentCapabilities?: string[]): Promise<Task | null>;
    getTaskQueue(limit?: number): Promise<Task[]>;
    getStatistics(): Promise<TaskStatistics>;
    count(options?: TaskQueryOptions): Promise<number>;
}
//# sourceMappingURL=in-memory-repositories.d.ts.map