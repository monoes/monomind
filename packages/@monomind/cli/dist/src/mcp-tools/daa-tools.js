/**
 * DAA (Decentralized Autonomous Agents) MCP Tools for CLI
 *
 * V2 Compatibility - DAA agent management tools
 *
 * ⚠️ IMPORTANT: These tools provide LOCAL STATE MANAGEMENT.
 * - Agent coordination is tracked locally
 * - No distributed network communication
 * - Useful for workflow orchestration and state tracking
 */
import { getProjectCwd } from './types.js';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
// Storage paths
const STORAGE_DIR = '.monomind';
const DAA_DIR = 'daa';
const DAA_FILE = 'store.json';
function getDAADir() {
    return join(getProjectCwd(), STORAGE_DIR, DAA_DIR);
}
function getDAAPath() {
    return join(getDAADir(), DAA_FILE);
}
function ensureDAADir() {
    const dir = getDAADir();
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}
function loadDAAStore() {
    try {
        const path = getDAAPath();
        if (existsSync(path)) {
            // Cap on disk read so a planted multi-GB store.json can't OOM the daemon
            // on first MCP call.
            const stat = statSync(path);
            if (stat.size > 25 * 1024 * 1024) {
                return { agents: {}, workflows: {}, knowledge: {}, version: '3.0.0' };
            }
            return JSON.parse(readFileSync(path, 'utf-8'));
        }
    }
    catch {
        // Return empty store
    }
    return { agents: {}, workflows: {}, knowledge: {}, version: '3.0.0' };
}
function saveDAAStore(store) {
    ensureDAADir();
    // Unique tmp filename so concurrent daa_* MCP calls cannot collide on the
    // same .tmp path mid-write.
    const tmpPath = `${getDAAPath()}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf-8');
    renameSync(tmpPath, getDAAPath());
}
export const daaTools = [
    {
        name: 'daa_agent_create',
        description: 'Create a decentralized autonomous agent',
        category: 'daa',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Agent ID' },
                name: { type: 'string', description: 'Agent name' },
                type: { type: 'string', description: 'Agent type' },
                cognitivePattern: { type: 'string', enum: ['convergent', 'divergent', 'lateral', 'systems', 'critical', 'adaptive'], description: 'Cognitive pattern' },
                learningRate: { type: 'number', description: 'Learning rate (0-1)' },
                enableMemory: { type: 'boolean', description: 'Enable persistent memory' },
                capabilities: { type: 'array', items: { type: 'string' }, description: 'Agent capabilities' },
            },
            required: ['id'],
        },
        handler: async (input) => {
            const store = loadDAAStore();
            const id = input.id;
            const agent = {
                id,
                name: input.name || `DAA-${id}`,
                type: input.type || 'autonomous',
                status: 'active',
                cognitivePattern: input.cognitivePattern || 'adaptive',
                learningRate: input.learningRate || 0.01,
                memory: input.enableMemory ?? true,
                capabilities: input.capabilities || ['reasoning', 'learning'],
                metrics: {
                    tasksCompleted: 0,
                    successRate: 1.0,
                    adaptations: 0,
                },
                createdAt: new Date().toISOString(),
                lastActivity: new Date().toISOString(),
            };
            if (['__proto__', 'constructor', 'prototype'].includes(id)) {
                return { success: false, error: 'Forbidden agent ID' };
            }
            store.agents[id] = agent;
            saveDAAStore(store);
            // Store agent in AgentDB for searchable agent registry
            try {
                const bridge = await import('../memory/memory-bridge.js');
                await bridge.bridgeStoreEntry({
                    key: `daa-agent-${id}`,
                    value: JSON.stringify({ id: agent.id, name: agent.name, type: agent.type, cognitivePattern: agent.cognitivePattern }),
                    namespace: 'daa-agents',
                    tags: [agent.type, agent.cognitivePattern],
                });
            }
            catch { /* AgentDB not available */ }
            return {
                success: true,
                agent: {
                    id: agent.id,
                    name: agent.name,
                    type: agent.type,
                    status: agent.status,
                    cognitivePattern: agent.cognitivePattern,
                    capabilities: agent.capabilities,
                },
                createdAt: agent.createdAt,
            };
        },
    },
    {
        name: 'daa_agent_adapt',
        description: 'Trigger agent adaptation based on feedback',
        category: 'daa',
        inputSchema: {
            type: 'object',
            properties: {
                agentId: { type: 'string', description: 'Agent ID' },
                feedback: { type: 'string', description: 'Feedback message' },
                performanceScore: { type: 'number', description: 'Performance score (0-1)' },
                suggestions: { type: 'array', items: { type: 'string' }, description: 'Improvement suggestions' },
            },
            required: ['agentId'],
        },
        handler: async (input) => {
            const agentId = input.agentId;
            if (typeof agentId !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(agentId)) {
                return { success: false, error: 'Invalid agent id' };
            }
            const store = loadDAAStore();
            const agent = Object.hasOwn(store.agents, agentId) ? store.agents[agentId] : undefined;
            if (!agent) {
                return { success: false, error: 'Agent not found' };
            }
            const performanceScore = input.performanceScore || 0.8;
            // Update agent metrics
            agent.metrics.adaptations++;
            agent.metrics.successRate = (agent.metrics.successRate + performanceScore) / 2;
            agent.lastActivity = new Date().toISOString();
            agent.status = 'active';
            saveDAAStore(store);
            // Store adaptation feedback in AgentDB for pattern learning (backward compat: JSON store above)
            let _storedIn = 'json-store';
            try {
                const bridge = await import('../memory/memory-bridge.js');
                await bridge.bridgeRecordFeedback({
                    taskId: `adapt-${agentId}-${agent.metrics.adaptations}`,
                    success: performanceScore >= 0.5,
                    quality: performanceScore,
                    agent: agentId,
                });
                _storedIn = 'agentdb';
            }
            catch { /* AgentDB not available */ }
            return {
                success: true,
                agentId,
                adaptation: {
                    feedback: input.feedback,
                    performanceScore,
                    adaptations: agent.metrics.adaptations,
                    newSuccessRate: agent.metrics.successRate,
                },
                status: agent.status,
                _storedIn,
            };
        },
    },
    {
        name: 'daa_workflow_create',
        description: 'Create an autonomous workflow',
        category: 'daa',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Workflow ID' },
                name: { type: 'string', description: 'Workflow name' },
                steps: { type: 'array', items: { type: 'object' }, description: 'Workflow steps' },
                strategy: { type: 'string', enum: ['parallel', 'sequential', 'adaptive'], description: 'Execution strategy' },
                dependencies: { type: 'object', description: 'Step dependencies' },
            },
            required: ['id', 'name'],
        },
        handler: async (input) => {
            const id = input.id;
            // Reject prototype-pollution keys: writing to store.workflows['__proto__']
            // mutates Object.prototype for the process.
            if (typeof id !== 'string' || id.length === 0 || id.length > 256 ||
                ['__proto__', 'constructor', 'prototype'].includes(id)) {
                return { success: false, error: 'Invalid workflow id' };
            }
            const store = loadDAAStore();
            const workflow = {
                id,
                name: input.name,
                status: 'pending',
                steps: (input.steps || []).map((s, i) => ({
                    name: typeof s === 'string' ? s : `Step ${i + 1}`,
                    status: 'pending',
                })),
                strategy: input.strategy || 'adaptive',
                createdAt: new Date().toISOString(),
            };
            store.workflows[id] = workflow;
            saveDAAStore(store);
            return {
                success: true,
                workflowId: id,
                name: workflow.name,
                steps: workflow.steps.length,
                strategy: workflow.strategy,
                createdAt: workflow.createdAt,
            };
        },
    },
    {
        name: 'daa_workflow_execute',
        description: 'Execute a DAA workflow',
        category: 'daa',
        inputSchema: {
            type: 'object',
            properties: {
                workflowId: { type: 'string', description: 'Workflow ID' },
                agentIds: { type: 'array', items: { type: 'string' }, description: 'Agent IDs to use' },
                parallelExecution: { type: 'boolean', description: 'Enable parallel execution' },
            },
            required: ['workflowId'],
        },
        handler: async (input) => {
            const workflowId = input.workflowId;
            if (typeof workflowId !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(workflowId)) {
                return { success: false, error: 'Invalid workflow id' };
            }
            const store = loadDAAStore();
            const workflow = Object.hasOwn(store.workflows, workflowId) ? store.workflows[workflowId] : undefined;
            if (!workflow) {
                return { success: false, error: 'Workflow not found' };
            }
            workflow.status = 'running';
            saveDAAStore(store);
            // Store workflow state in AgentDB for tracking
            try {
                const bridge = await import('../memory/memory-bridge.js');
                await bridge.bridgeStoreEntry({
                    key: `workflow-${workflowId}`,
                    value: JSON.stringify({
                        id: workflowId, status: 'running',
                        steps: workflow.steps.length, strategy: workflow.strategy,
                        startedAt: new Date().toISOString(),
                    }),
                    namespace: 'daa-workflows',
                });
            }
            catch { /* AgentDB not available */ }
            return {
                success: true,
                workflowId,
                status: workflow.status,
                steps: workflow.steps,
                startedAt: new Date().toISOString(),
                _note: 'Steps are tracked but not auto-executed. Use agent tools to execute each step.',
            };
        },
    },
    {
        name: 'daa_knowledge_share',
        description: 'Share knowledge between agents',
        category: 'daa',
        inputSchema: {
            type: 'object',
            properties: {
                sourceAgentId: { type: 'string', description: 'Source agent ID' },
                targetAgentIds: { type: 'array', items: { type: 'string' }, description: 'Target agent IDs' },
                knowledgeDomain: { type: 'string', description: 'Knowledge domain' },
                knowledgeContent: { type: 'object', description: 'Knowledge to share' },
            },
            required: ['sourceAgentId', 'targetAgentIds'],
        },
        handler: async (input) => {
            const store = loadDAAStore();
            const sourceId = input.sourceAgentId;
            const targetIds = input.targetAgentIds;
            const domain = input.knowledgeDomain || 'general';
            const knowledgeId = `knowledge-${Date.now()}`;
            const knowledgeEntry = {
                domain,
                content: input.knowledgeContent || {},
                sharedBy: sourceId,
                targetAgents: targetIds,
                timestamp: new Date().toISOString(),
            };
            // Primary: store in AgentDB for vector-searchable knowledge
            let _storedIn = 'json-store';
            try {
                const bridge = await import('../memory/memory-bridge.js');
                await bridge.bridgeStoreEntry({
                    key: knowledgeId,
                    value: JSON.stringify(knowledgeEntry),
                    namespace: 'daa-knowledge',
                    tags: [domain, sourceId, ...targetIds],
                });
                _storedIn = 'agentdb';
            }
            catch { /* AgentDB not available */ }
            // Backward compat: always persist in JSON store (cap at 1000 entries)
            if (Object.keys(store.knowledge).length >= 1000) {
                const oldest = Object.keys(store.knowledge)[0];
                if (oldest)
                    delete store.knowledge[oldest];
            }
            store.knowledge[knowledgeId] = knowledgeEntry;
            saveDAAStore(store);
            return {
                success: true,
                knowledgeId,
                sourceAgent: sourceId,
                targetAgents: targetIds,
                domain,
                sharedAt: knowledgeEntry.timestamp,
                _storedIn,
                _note: _storedIn === 'agentdb'
                    ? 'Knowledge stored in AgentDB (vector-searchable) and JSON store. Target agents can retrieve via daa_learning_status or memory search.'
                    : 'Knowledge stored in shared JSON registry. Target agents can retrieve via daa_learning_status. No cross-agent memory transfer occurs.',
            };
        },
    },
    {
        name: 'daa_learning_status',
        description: 'Get learning status for DAA agents',
        category: 'daa',
        inputSchema: {
            type: 'object',
            properties: {
                agentId: { type: 'string', description: 'Specific agent ID' },
                detailed: { type: 'boolean', description: 'Include detailed metrics' },
            },
        },
        handler: async (input) => {
            const store = loadDAAStore();
            const agentId = input.agentId;
            if (agentId) {
                if (typeof agentId !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(agentId)) {
                    return { success: false, error: 'Invalid agent id' };
                }
                const agent = Object.hasOwn(store.agents, agentId) ? store.agents[agentId] : undefined;
                if (!agent) {
                    return { success: false, error: 'Agent not found' };
                }
                return {
                    success: true,
                    agent: {
                        id: agent.id,
                        status: agent.status,
                        cognitivePattern: agent.cognitivePattern,
                        learningRate: agent.learningRate,
                        metrics: agent.metrics,
                    },
                };
            }
            const agents = Object.values(store.agents);
            return {
                success: true,
                summary: {
                    total: agents.length,
                    active: agents.filter(a => a.status === 'active').length,
                    learning: agents.filter(a => a.status === 'learning').length,
                    avgSuccessRate: agents.length > 0
                        ? agents.reduce((sum, a) => sum + a.metrics.successRate, 0) / agents.length
                        : 0,
                    totalAdaptations: agents.reduce((sum, a) => sum + a.metrics.adaptations, 0),
                },
                agents: agents.map(a => ({
                    id: a.id,
                    status: a.status,
                    successRate: a.metrics.successRate,
                    adaptations: a.metrics.adaptations,
                })),
            };
        },
    },
    {
        name: 'daa_cognitive_pattern',
        description: 'Analyze or change cognitive patterns',
        category: 'daa',
        inputSchema: {
            type: 'object',
            properties: {
                agentId: { type: 'string', description: 'Agent ID' },
                action: { type: 'string', enum: ['analyze', 'change'], description: 'Action' },
                pattern: { type: 'string', enum: ['convergent', 'divergent', 'lateral', 'systems', 'critical', 'adaptive'], description: 'New pattern' },
            },
        },
        handler: async (input) => {
            const store = loadDAAStore();
            const agentId = input.agentId;
            const action = input.action || 'analyze';
            if (agentId) {
                if (typeof agentId !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(agentId)) {
                    return { success: false, error: 'Invalid agent id' };
                }
                const agent = Object.hasOwn(store.agents, agentId) ? store.agents[agentId] : undefined;
                if (!agent) {
                    return { success: false, error: 'Agent not found' };
                }
                if (action === 'analyze') {
                    return {
                        success: true,
                        agentId,
                        currentPattern: agent.cognitivePattern,
                        learningRate: agent.learningRate,
                        metrics: agent.metrics,
                        _note: 'Pattern analysis requires real cognitive modeling. Current pattern and metrics shown.',
                    };
                }
                if (action === 'change' && input.pattern) {
                    const oldPattern = agent.cognitivePattern;
                    agent.cognitivePattern = input.pattern;
                    saveDAAStore(store);
                    return {
                        success: true,
                        agentId,
                        previousPattern: oldPattern,
                        newPattern: agent.cognitivePattern,
                        changedAt: new Date().toISOString(),
                    };
                }
            }
            // Return general pattern info
            const patternDescriptions = {
                convergent: 'Focused, analytical thinking for well-defined problems',
                divergent: 'Creative, exploratory thinking for open-ended problems',
                lateral: 'Indirect, creative approach to problem solving',
                systems: 'Holistic thinking considering interconnections',
                critical: 'Analytical evaluation and logical assessment',
                adaptive: 'Dynamic switching between patterns as needed',
            };
            return {
                success: true,
                patterns: patternDescriptions,
                recommendation: 'Use "adaptive" for general-purpose agents',
            };
        },
    },
    {
        name: 'daa_performance_metrics',
        description: 'Get DAA performance metrics',
        category: 'daa',
        inputSchema: {
            type: 'object',
            properties: {
                category: { type: 'string', enum: ['all', 'agents', 'workflows', 'learning'], description: 'Metrics category' },
                timeRange: { type: 'string', description: 'Time range' },
            },
        },
        handler: async (input) => {
            const store = loadDAAStore();
            const category = input.category || 'all';
            const agents = Object.values(store.agents);
            const workflows = Object.values(store.workflows);
            const metrics = {
                agents: {
                    total: agents.length,
                    active: agents.filter(a => a.status === 'active').length,
                    avgSuccessRate: agents.length > 0
                        ? agents.reduce((sum, a) => sum + a.metrics.successRate, 0) / agents.length
                        : 0,
                    totalTasks: agents.reduce((sum, a) => sum + a.metrics.tasksCompleted, 0),
                },
                workflows: {
                    total: workflows.length,
                    completed: workflows.filter(w => w.status === 'completed').length,
                    running: workflows.filter(w => w.status === 'running').length,
                    successRate: workflows.length > 0
                        ? workflows.filter(w => w.status === 'completed').length / workflows.length
                        : 0,
                },
                learning: {
                    totalAdaptations: agents.reduce((sum, a) => sum + a.metrics.adaptations, 0),
                    knowledgeItems: Object.keys(store.knowledge).length,
                    avgLearningRate: agents.length > 0
                        ? agents.reduce((sum, a) => sum + a.learningRate, 0) / agents.length
                        : 0,
                },
            };
            if (category === 'all') {
                return { success: true, metrics };
            }
            return {
                success: true,
                category,
                metrics: metrics[category],
            };
        },
    },
];
//# sourceMappingURL=daa-tools.js.map