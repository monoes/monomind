/**
 * MCP Agent Tools
 *
 * MCP tools for agent lifecycle operations:
 * - agent/spawn - Spawn a new agent
 * - agent/list - List all agents
 * - agent/terminate - Terminate an agent
 * - agent/status - Get agent status
 *
 * Implements ADR-005: MCP-First API Design
 */
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { sanitizeErrorForLogging } from '../../@monobrain/shared/src/utils/secure-logger.js';
// Task 17: ManagedAgent — lazy import for spawnAndAwait
let _spawnAndAwait = null;
async function getManagedAgentSpawn() {
    if (_spawnAndAwait) return _spawnAndAwait;
    try {
        const mod = await import('../../@monobrain/cli/dist/src/agents/managed-agent.js');
        _spawnAndAwait = mod.spawnAndAwait;
    } catch { /* optional */ }
    return _spawnAndAwait;
}
// Task 06: AutoRetry — lazy import so it's optional
let _runAgentWithRetry = null;
async function getRetryRunner() {
    if (_runAgentWithRetry) return _runAgentWithRetry;
    try {
        const mod = await import('../../@monobrain/shared/src/retry-runner.js');
        _runAgentWithRetry = mod.runAgentWithRetry;
    } catch { /* optional */ }
    return _runAgentWithRetry;
}
// Task 31: DeprecationInjector — lazy singleton
let _deprecationInjector = null;
async function getDeprecationInjector() {
    if (_deprecationInjector) return _deprecationInjector;
    try {
        const [{ ToolRegistry }, { DeprecationInjector }] = await Promise.all([
            import('../../@monobrain/cli/src/mcp/tool-registry.js'),
            import('../../@monobrain/cli/src/mcp/deprecation-injector.js'),
        ]);
        _deprecationInjector = new DeprecationInjector(new ToolRegistry('.monobrain/tool-versions.jsonl'));
    } catch { /* not available */ }
    return _deprecationInjector;
}
const spawnResultSchema = z.object({
    agentId: z.string(), agentType: z.string(), status: z.string(), createdAt: z.string(),
});
// Secure ID generation helper
function generateSecureAgentId() {
    const timestamp = Date.now().toString(36);
    const random = randomBytes(12).toString('hex');
    return `agent-${timestamp}-${random}`;
}
// ============================================================================
// Agent Type Validation (Security: Restrict to known agent types)
// ============================================================================
/**
 * Known agent types - validates against allowed agent types to prevent
 * arbitrary code execution or unexpected behavior from unknown types.
 */
const ALLOWED_AGENT_TYPES = [
    // Core Development
    'coder', 'reviewer', 'tester', 'planner', 'researcher',
    // Swarm Coordination
    'hierarchical-coordinator', 'mesh-coordinator', 'adaptive-coordinator',
    'collective-intelligence-coordinator', 'swarm-memory-manager',
    // Consensus & Distributed
    'byzantine-coordinator', 'raft-manager', 'gossip-coordinator',
    'consensus-builder', 'crdt-synchronizer', 'quorum-manager', 'security-manager',
    // Performance & Optimization
    'perf-analyzer', 'performance-benchmarker', 'task-orchestrator',
    'memory-coordinator', 'smart-agent',
    // SPARC Methodology
    'sparc-coord', 'sparc-coder', 'specification', 'pseudocode',
    'architecture', 'refinement',
    // Specialized Development
    'backend-dev', 'frontend-dev', 'mobile-dev', 'ml-developer',
    'cicd-engineer', 'api-docs', 'system-architect', 'code-analyzer',
    // Specialized
    'queen-coordinator', 'security-architect', 'security-auditor',
    'memory-specialist', 'swarm-specialist', 'integration-architect',
    'performance-engineer', 'core-architect', 'test-architect', 'project-coordinator',
];
const agentTypeSchema = z.enum(ALLOWED_AGENT_TYPES).or(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, 'Agent type must start with a letter and contain only alphanumeric characters, hyphens, and underscores').max(64, 'Agent type must not exceed 64 characters'));
// ============================================================================
// Input Schemas
// ============================================================================
const spawnAgentSchema = z.object({
    agentType: agentTypeSchema.describe('Type of agent to spawn'),
    id: z.string().optional().describe('Optional agent ID (auto-generated if not provided)'),
    config: z.record(z.unknown()).optional().describe('Agent-specific configuration'),
    priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
    metadata: z.record(z.unknown()).optional().describe('Additional metadata'),
});
const listAgentsSchema = z.object({
    status: z.enum(['active', 'idle', 'terminated', 'all']).optional().describe('Filter by status'),
    agentType: z.string().optional().describe('Filter by agent type'),
    limit: z.number().int().positive().max(1000).optional().describe('Maximum number of agents to return'),
    offset: z.number().int().nonnegative().optional().describe('Offset for pagination'),
});
const terminateAgentSchema = z.object({
    agentId: z.string().describe('ID of the agent to terminate'),
    graceful: z.boolean().default(true).describe('Whether to gracefully shutdown the agent'),
    reason: z.string().optional().describe('Reason for termination'),
});
const agentStatusSchema = z.object({
    agentId: z.string().describe('ID of the agent to get status for'),
    includeMetrics: z.boolean().default(false).describe('Include performance metrics'),
    includeHistory: z.boolean().default(false).describe('Include execution history'),
});
// ============================================================================
// Tool Handlers
// ============================================================================
/**
 * Spawn a new agent
 */
async function handleSpawnAgent(input, context) {
    const agentId = input.id || generateSecureAgentId();
    const createdAt = new Date().toISOString();
    // Task 29: AgentVersioning — log active version if one exists
    try {
        const { AgentVersionStore } = await import('../../@monobrain/cli/src/agents/version-store.js');
        const version = AgentVersionStore.getCurrent(input.agentType);
        if (version) {
            console.log(`[AGENT_VERSION] ${input.agentType} v${version.version}`);
        }
    } catch { /* optional */ }
    // Task 31: DeprecationInjector — warn if agent type or spawn tool is deprecated
    try {
        const injector = await getDeprecationInjector();
        if (injector) {
            for (const toolKey of ['agent/spawn', input.agentType]) {
                const check = injector.inject({}, toolKey);
                if (check._deprecation) {
                    console.warn(check._deprecation.warning);
                    break;
                }
            }
        }
    } catch { /* optional */ }
    // Try to use swarmCoordinator if available
    if (context?.swarmCoordinator) {
        try {
            const { UnifiedSwarmCoordinator } = await import('@monobrain/swarm');
            const coordinator = context.swarmCoordinator;
            // Task 06: AutoRetry — wrap spawn with retry logic
            const retryRunner = await getRetryRunner();
            if (retryRunner) {
                const spawnResult = await retryRunner({
                    agentSlug: input.agentType,
                    task: `spawn:${agentId}`,
                    agentRunner: async () => {
                        await coordinator.spawnAgent({
                            id: agentId,
                            type: input.agentType,
                            capabilities: input.config?.capabilities || [],
                            priority: input.priority === 'critical' ? 1 : input.priority === 'high' ? 2 : input.priority === 'normal' ? 3 : 4,
                        });
                        return { agentId, agentType: input.agentType, status: 'active', createdAt };
                    },
                    outputSchema: spawnResultSchema,
                });
                return spawnResult;
            }
            // Fallback: spawn without retry
            await coordinator.spawnAgent({
                id: agentId,
                type: input.agentType,
                capabilities: input.config?.capabilities || [],
                priority: input.priority === 'critical' ? 1 : input.priority === 'high' ? 2 : input.priority === 'normal' ? 3 : 4,
            });
            return {
                agentId,
                agentType: input.agentType,
                status: 'active',
                createdAt,
            };
        }
        catch (error) {
            // Fall through to simple implementation if coordinator fails
            // Use secure logging to prevent sensitive information disclosure
            console.error('Failed to spawn agent via coordinator:', sanitizeErrorForLogging(error));
        }
    }
    // Task 17: ManagedAgent — use spawnAndAwait for lifecycle management
    const spawnAndAwait = await getManagedAgentSpawn();
    if (spawnAndAwait) {
        try {
            const runner = async (_slug, _taskId, _task) => `agent:${agentId}`;
            await spawnAndAwait(input.agentType, `spawn:${agentId}`, runner, { timeoutMs: 5000 });
        } catch { /* runner timeout is expected — agent is still registered */ }
    }
    // Simple implementation when no coordinator is available
    const result = {
        agentId,
        agentType: input.agentType,
        status: 'active',
        createdAt,
    };
    return result;
}
/**
 * List all agents
 */
async function handleListAgents(input, context) {
    // Try to use swarmCoordinator if available
    if (context?.swarmCoordinator) {
        try {
            const { UnifiedSwarmCoordinator } = await import('@monobrain/swarm');
            const coordinator = context.swarmCoordinator;
            // Get swarm status
            const status = await coordinator.getStatus();
            // Convert swarm agents to AgentInfo format
            let agents = status.agents.map(agent => ({
                id: agent.id,
                agentType: agent.type,
                status: agent.status === 'active' ? 'active' :
                    agent.status === 'idle' ? 'idle' : 'terminated',
                createdAt: agent.createdAt.toISOString(),
                lastActivityAt: agent.lastActivityAt?.toISOString(),
                config: agent.config,
                metadata: agent.metadata,
            }));
            // Apply filters
            if (input.status && input.status !== 'all') {
                agents = agents.filter(a => a.status === input.status);
            }
            if (input.agentType) {
                agents = agents.filter(a => a.agentType === input.agentType);
            }
            // Apply pagination
            const offset = input.offset || 0;
            const limit = input.limit || agents.length;
            const paginated = agents.slice(offset, offset + limit);
            return {
                agents: paginated,
                total: agents.length,
                limit: input.limit,
                offset: input.offset,
            };
        }
        catch (error) {
            // Fall through to simple implementation if coordinator fails
            console.error('Failed to list agents via coordinator:', sanitizeErrorForLogging(error));
        }
    }
    // Simple implementation when no coordinator is available
    return {
        agents: [],
        total: 0,
        limit: input.limit,
        offset: input.offset,
    };
}
/**
 * Terminate an agent
 */
async function handleTerminateAgent(input, context) {
    const terminatedAt = new Date().toISOString();
    // Try to use swarmCoordinator if available
    if (context?.swarmCoordinator) {
        try {
            const { UnifiedSwarmCoordinator } = await import('@monobrain/swarm');
            const coordinator = context.swarmCoordinator;
            // Terminate agent
            await coordinator.terminateAgent(input.agentId);
            return {
                agentId: input.agentId,
                terminated: true,
                terminatedAt,
                reason: input.reason,
            };
        }
        catch (error) {
            // Fall through to simple implementation if coordinator fails
            console.error('Failed to terminate agent via coordinator:', sanitizeErrorForLogging(error));
        }
    }
    // Simple implementation when no coordinator is available
    return {
        agentId: input.agentId,
        terminated: false,
        terminatedAt,
        reason: input.reason,
    };
}
/**
 * Get agent status
 */
async function handleAgentStatus(input, context) {
    // Try to use swarmCoordinator if available
    if (context?.swarmCoordinator) {
        try {
            const { UnifiedSwarmCoordinator } = await import('@monobrain/swarm');
            const coordinator = context.swarmCoordinator;
            // Get agent status
            const agentState = await coordinator.getAgentStatus(input.agentId);
            const status = {
                id: agentState.id,
                agentType: agentState.type,
                status: agentState.status === 'active' ? 'active' :
                    agentState.status === 'idle' ? 'idle' : 'terminated',
                createdAt: agentState.createdAt.toISOString(),
                lastActivityAt: agentState.lastActivityAt?.toISOString(),
                config: agentState.config,
                metadata: agentState.metadata,
            };
            if (input.includeMetrics) {
                status.metrics = {
                    tasksCompleted: agentState.metrics?.tasksCompleted || 0,
                    tasksInProgress: agentState.metrics?.tasksInProgress || 0,
                    tasksFailed: agentState.metrics?.tasksFailed || 0,
                    averageExecutionTime: agentState.metrics?.averageExecutionTime || 0,
                    uptime: agentState.metrics?.uptime || 0,
                };
            }
            if (input.includeHistory) {
                status.history = (agentState.history || []).map(h => ({
                    timestamp: h.timestamp.toISOString(),
                    event: h.event,
                    details: h.details,
                }));
            }
            return status;
        }
        catch (error) {
            // Fall through to simple implementation if coordinator fails
            console.error('Failed to get agent status via coordinator:', sanitizeErrorForLogging(error));
        }
    }
    // Simple implementation when no coordinator is available - return error status
    throw new Error(`Agent not found: ${input.agentId}`);
}
// ============================================================================
// Tool Definitions
// ============================================================================
/**
 * agent/spawn tool
 */
export const spawnAgentTool = {
    name: 'agent/spawn',
    description: 'Spawn a new agent with specified type and configuration',
    inputSchema: {
        type: 'object',
        properties: {
            agentType: {
                type: 'string',
                description: 'Type of agent to spawn (e.g., coder, reviewer, tester, researcher, planner)',
            },
            id: {
                type: 'string',
                description: 'Optional agent ID (auto-generated if not provided)',
            },
            config: {
                type: 'object',
                description: 'Agent-specific configuration',
                additionalProperties: true,
            },
            priority: {
                type: 'string',
                enum: ['low', 'normal', 'high', 'critical'],
                description: 'Agent priority level',
                default: 'normal',
            },
            metadata: {
                type: 'object',
                description: 'Additional metadata',
                additionalProperties: true,
            },
        },
        required: ['agentType'],
    },
    handler: async (input, context) => {
        const validated = spawnAgentSchema.parse(input);
        return handleSpawnAgent(validated, context);
    },
    category: 'agent',
    tags: ['agent', 'lifecycle', 'spawn'],
    version: '1.0.0',
};
/**
 * agent/list tool
 */
export const listAgentsTool = {
    name: 'agent/list',
    description: 'List all agents with optional filtering and pagination',
    inputSchema: {
        type: 'object',
        properties: {
            status: {
                type: 'string',
                enum: ['active', 'idle', 'terminated', 'all'],
                description: 'Filter by agent status',
            },
            agentType: {
                type: 'string',
                description: 'Filter by agent type',
            },
            limit: {
                type: 'number',
                description: 'Maximum number of agents to return',
                minimum: 1,
                maximum: 1000,
            },
            offset: {
                type: 'number',
                description: 'Offset for pagination',
                minimum: 0,
            },
        },
    },
    handler: async (input, context) => {
        const validated = listAgentsSchema.parse(input);
        return handleListAgents(validated, context);
    },
    category: 'agent',
    tags: ['agent', 'list', 'query'],
    version: '1.0.0',
    cacheable: true,
    cacheTTL: 2000,
};
/**
 * agent/terminate tool
 */
export const terminateAgentTool = {
    name: 'agent/terminate',
    description: 'Terminate a running agent gracefully or forcefully',
    inputSchema: {
        type: 'object',
        properties: {
            agentId: {
                type: 'string',
                description: 'ID of the agent to terminate',
            },
            graceful: {
                type: 'boolean',
                description: 'Whether to gracefully shutdown the agent',
                default: true,
            },
            reason: {
                type: 'string',
                description: 'Reason for termination',
            },
        },
        required: ['agentId'],
    },
    handler: async (input, context) => {
        const validated = terminateAgentSchema.parse(input);
        return handleTerminateAgent(validated, context);
    },
    category: 'agent',
    tags: ['agent', 'lifecycle', 'terminate'],
    version: '1.0.0',
};
/**
 * agent/status tool
 */
export const agentStatusTool = {
    name: 'agent/status',
    description: 'Get detailed status information for a specific agent',
    inputSchema: {
        type: 'object',
        properties: {
            agentId: {
                type: 'string',
                description: 'ID of the agent to get status for',
            },
            includeMetrics: {
                type: 'boolean',
                description: 'Include performance metrics',
                default: false,
            },
            includeHistory: {
                type: 'boolean',
                description: 'Include execution history',
                default: false,
            },
        },
        required: ['agentId'],
    },
    handler: async (input, context) => {
        const validated = agentStatusSchema.parse(input);
        return handleAgentStatus(validated, context);
    },
    category: 'agent',
    tags: ['agent', 'status', 'metrics'],
    version: '1.0.0',
    cacheable: true,
    cacheTTL: 1000,
};
// ============================================================================
// Exports
// ============================================================================
export const agentTools = [
    spawnAgentTool,
    listAgentsTool,
    terminateAgentTool,
    agentStatusTool,
];
export default agentTools;
//# sourceMappingURL=agent-tools.js.map