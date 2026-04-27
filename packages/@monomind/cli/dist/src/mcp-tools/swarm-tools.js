/**
 * Swarm MCP Tools for CLI
 *
 * Tool definitions for swarm coordination with file-based state persistence.
 * Replaces previous stub implementations with real state tracking.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectCwd } from './types.js';
function logEvent(kind, data) {
    try {
        const dir = join(getProjectCwd(), '.monomind', 'swarm');
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const event = { ts: new Date().toISOString(), source: 'mcp', kind, ...data };
        appendFileSync(join(dir, 'events.jsonl'), JSON.stringify(event) + '\n');
    } catch { }
}
// Swarm state persistence
const SWARM_DIR = '.monomind/swarm';
const SWARM_STATE_FILE = 'swarm-state.json';
function getSwarmDir() {
    return join(getProjectCwd(), SWARM_DIR);
}
function getSwarmStatePath() {
    return join(getSwarmDir(), SWARM_STATE_FILE);
}
function ensureSwarmDir() {
    const dir = getSwarmDir();
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
}
function loadSwarmStore() {
    try {
        const path = getSwarmStatePath();
        if (existsSync(path)) {
            return JSON.parse(readFileSync(path, 'utf-8'));
        }
    }
    catch { /* return default */ }
    return { swarms: {}, version: '3.0.0' };
}
function saveSwarmStore(store) {
    ensureSwarmDir();
    writeFileSync(getSwarmStatePath(), JSON.stringify(store, null, 2), 'utf-8');
}
// Input validation
const VALID_TOPOLOGIES = new Set([
    'hierarchical', 'mesh', 'hierarchical-mesh', 'ring', 'star', 'hybrid', 'adaptive',
]);
export const swarmTools = [
    {
        name: 'swarm_init',
        description: 'Initialize a swarm with persistent state tracking',
        category: 'swarm',
        inputSchema: {
            type: 'object',
            properties: {
                topology: { type: 'string', description: 'Swarm topology type (hierarchical, mesh, hierarchical-mesh, ring, star, hybrid, adaptive)' },
                maxAgents: { type: 'number', description: 'Maximum number of agents (1-50)' },
                strategy: { type: 'string', description: 'Agent strategy (specialized, balanced, adaptive)' },
                config: { type: 'object', description: 'Additional swarm configuration' },
            },
        },
        handler: async (input) => {
            const topology = input.topology || 'hierarchical-mesh';
            const maxAgents = Math.min(Math.max(input.maxAgents || 15, 1), 50);
            const strategy = input.strategy || 'specialized';
            const config = (input.config || {});
            if (!VALID_TOPOLOGIES.has(topology)) {
                return {
                    success: false,
                    error: `Invalid topology: ${topology}. Valid: ${[...VALID_TOPOLOGIES].join(', ')}`,
                };
            }
            const swarmId = `swarm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const now = new Date().toISOString();
            const swarmState = {
                swarmId,
                topology,
                maxAgents,
                status: 'running',
                agents: [],
                tasks: [],
                config: {
                    topology,
                    maxAgents,
                    strategy,
                    communicationProtocol: config.communicationProtocol || 'message-bus',
                    autoScaling: config.autoScaling ?? true,
                    consensusMechanism: config.consensusMechanism || 'majority',
                },
                createdAt: now,
                updatedAt: now,
            };
            const store = loadSwarmStore();
            store.swarms[swarmId] = swarmState;
            saveSwarmStore(store);
            logEvent('swarm.init', { swarmId, topology, strategy, maxAgents, config: swarmState.config });
            return {
                success: true,
                swarmId,
                topology,
                strategy,
                maxAgents,
                initializedAt: now,
                config: swarmState.config,
                persisted: true,
            };
        },
    },
    {
        name: 'swarm_status',
        description: 'Get swarm status from persistent state',
        category: 'swarm',
        inputSchema: {
            type: 'object',
            properties: {
                swarmId: { type: 'string', description: 'Swarm ID (omit for most recent)' },
            },
        },
        handler: async (input) => {
            const store = loadSwarmStore();
            const swarmId = input.swarmId;
            if (swarmId && store.swarms[swarmId]) {
                const swarm = store.swarms[swarmId];
                return {
                    swarmId: swarm.swarmId,
                    status: swarm.status,
                    topology: swarm.topology,
                    maxAgents: swarm.maxAgents,
                    agentCount: swarm.agents.length,
                    taskCount: swarm.tasks.length,
                    config: swarm.config,
                    createdAt: swarm.createdAt,
                    updatedAt: swarm.updatedAt,
                };
            }
            // Return most recent swarm if no ID specified
            const swarmIds = Object.keys(store.swarms);
            if (swarmIds.length === 0) {
                return {
                    status: 'no_swarm',
                    message: 'No active swarms. Use swarm_init to create one.',
                    totalSwarms: 0,
                };
            }
            const latest = swarmIds
                .map(id => store.swarms[id])
                .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
            return {
                swarmId: latest.swarmId,
                status: latest.status,
                topology: latest.topology,
                maxAgents: latest.maxAgents,
                agentCount: latest.agents.length,
                taskCount: latest.tasks.length,
                config: latest.config,
                createdAt: latest.createdAt,
                updatedAt: latest.updatedAt,
                totalSwarms: swarmIds.length,
            };
        },
    },
    {
        name: 'swarm_shutdown',
        description: 'Shutdown a swarm and update persistent state',
        category: 'swarm',
        inputSchema: {
            type: 'object',
            properties: {
                swarmId: { type: 'string', description: 'Swarm ID to shutdown' },
                graceful: { type: 'boolean', description: 'Graceful shutdown (default: true)' },
            },
        },
        handler: async (input) => {
            const store = loadSwarmStore();
            const swarmId = input.swarmId;
            // Find the swarm
            let target;
            if (swarmId && store.swarms[swarmId]) {
                target = store.swarms[swarmId];
            }
            else {
                // Shutdown most recent running swarm
                const running = Object.values(store.swarms)
                    .filter(s => s.status === 'running')
                    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
                target = running[0];
            }
            if (!target) {
                return {
                    success: false,
                    error: swarmId ? `Swarm ${swarmId} not found` : 'No running swarms to shutdown',
                };
            }
            if (target.status === 'terminated') {
                return {
                    success: false,
                    swarmId: target.swarmId,
                    error: 'Swarm already terminated',
                };
            }
            target.status = 'terminated';
            target.updatedAt = new Date().toISOString();
            saveSwarmStore(store);
            logEvent('swarm.shutdown', { swarmId: target.swarmId, topology: target.topology, agentCount: target.agents.length, graceful: input.graceful ?? true });
            return {
                success: true,
                swarmId: target.swarmId,
                terminated: true,
                graceful: input.graceful ?? true,
                agentsTerminated: target.agents.length,
                terminatedAt: target.updatedAt,
            };
        },
    },
    {
        name: 'swarm_health',
        description: 'Check swarm health status with real state inspection',
        category: 'swarm',
        inputSchema: {
            type: 'object',
            properties: {
                swarmId: { type: 'string', description: 'Swarm ID to check' },
            },
        },
        handler: async (input) => {
            const store = loadSwarmStore();
            const swarmId = input.swarmId;
            // Find the swarm
            let target;
            if (swarmId) {
                target = store.swarms[swarmId];
                if (!target) {
                    return {
                        status: 'not_found',
                        healthy: false,
                        checks: [
                            { name: 'swarm_exists', status: 'fail', message: `Swarm ${swarmId} not found` },
                        ],
                        checkedAt: new Date().toISOString(),
                    };
                }
            }
            else {
                const running = Object.values(store.swarms)
                    .filter(s => s.status === 'running')
                    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
                target = running[0];
            }
            if (!target) {
                return {
                    status: 'no_swarm',
                    healthy: false,
                    checks: [
                        { name: 'swarm_exists', status: 'fail', message: 'No active swarm found' },
                    ],
                    checkedAt: new Date().toISOString(),
                };
            }
            const isRunning = target.status === 'running';
            const stateFileExists = existsSync(getSwarmStatePath());
            const checks = [
                {
                    name: 'coordinator',
                    status: isRunning ? 'ok' : 'warn',
                    message: isRunning ? 'Coordinator active' : `Swarm status: ${target.status}`,
                },
                {
                    name: 'agents',
                    status: target.agents.length > 0 ? 'ok' : 'info',
                    message: `${target.agents.length} agents registered (max: ${target.maxAgents})`,
                },
                {
                    name: 'persistence',
                    status: stateFileExists ? 'ok' : 'warn',
                    message: stateFileExists ? 'State file persisted' : 'State file missing',
                },
                {
                    name: 'topology',
                    status: 'ok',
                    message: `Topology: ${target.topology}`,
                },
            ];
            const healthy = isRunning && stateFileExists;
            return {
                status: healthy ? 'healthy' : 'degraded',
                healthy,
                swarmId: target.swarmId,
                topology: target.topology,
                agentCount: target.agents.length,
                checks,
                checkedAt: new Date().toISOString(),
            };
        },
    },
];
//# sourceMappingURL=swarm-tools.js.map