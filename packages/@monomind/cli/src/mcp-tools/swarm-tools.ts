/**
 * Swarm MCP Tools for CLI
 *
 * Tool definitions for swarm coordination with file-based state persistence.
 * Replaces previous stub implementations with real state tracking.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { type MCPTool, getProjectCwd } from './types.js';
import { agentTools } from './agent-tools.js';

// Swarm state persistence
const SWARM_DIR = '.monomind/swarm';
const SWARM_STATE_FILE = 'swarm-state.json';

interface SwarmState {
  swarmId: string;
  topology: string;
  maxAgents: number;
  status: 'initializing' | 'running' | 'paused' | 'shutting_down' | 'terminated';
  agents: string[];
  tasks: string[];
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface SwarmStore {
  swarms: Record<string, SwarmState>;
  version: string;
}

function getSwarmDir(): string {
  return join(getProjectCwd(), SWARM_DIR);
}

function getSwarmStatePath(): string {
  return join(getSwarmDir(), SWARM_STATE_FILE);
}

function ensureSwarmDir(): void {
  const dir = getSwarmDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

const MAX_SWARM_STORE_BYTES = 10 * 1024 * 1024;

function loadSwarmStore(): SwarmStore {
  try {
    const path = getSwarmStatePath();
    if (existsSync(path)) {
      if (statSync(path).size > MAX_SWARM_STORE_BYTES) return { swarms: {}, version: '3.0.0' };
      return JSON.parse(readFileSync(path, 'utf-8'));
    }
  } catch { /* return default */ }
  return { swarms: {}, version: '3.0.0' };
}

function saveSwarmStore(store: SwarmStore): void {
  ensureSwarmDir();
  const dest = getSwarmStatePath();
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
  renameSync(tmp, dest);
}

// Input validation
const VALID_TOPOLOGIES = new Set([
  'hierarchical', 'mesh', 'hierarchical-mesh', 'ring', 'star', 'hybrid', 'adaptive',
]);

export const swarmTools: MCPTool[] = [
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
      const topology = (input.topology as string) || 'hierarchical-mesh';
      const maxAgents = Math.min(Math.max((input.maxAgents as number) || 8, 1), 50);
      // Cap strategy and config string fields: all are persisted in the swarm
      // JSON store.  topology is already validated against VALID_TOPOLOGIES so
      // an invalid long value is rejected; the others have no validation.
      const MAX_SWARM_FIELD_LEN = 256;
      const rawStrategy = (input.strategy as string) || 'specialized';
      const strategy = typeof rawStrategy === 'string' && rawStrategy.length > MAX_SWARM_FIELD_LEN
        ? rawStrategy.slice(0, MAX_SWARM_FIELD_LEN) : rawStrategy;
      const config = (input.config || {}) as Record<string, unknown>;

      if (!VALID_TOPOLOGIES.has(topology)) {
        return {
          success: false,
          error: `Invalid topology: ${topology}. Valid: ${[...VALID_TOPOLOGIES].join(', ')}`,
        };
      }

      const swarmId = `swarm-${Date.now()}-${randomBytes(6).toString('hex')}`;
      const now = new Date().toISOString();

      const swarmState: SwarmState = {
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
          communicationProtocol: (() => {
            const raw = (config.communicationProtocol as string) || 'message-bus';
            return typeof raw === 'string' && raw.length > MAX_SWARM_FIELD_LEN ? raw.slice(0, MAX_SWARM_FIELD_LEN) : raw;
          })(),
          autoScaling: (config.autoScaling as boolean) ?? true,
          consensusMechanism: (() => {
            const raw = (config.consensusMechanism as string) || 'majority';
            return typeof raw === 'string' && raw.length > MAX_SWARM_FIELD_LEN ? raw.slice(0, MAX_SWARM_FIELD_LEN) : raw;
          })(),
        },
        createdAt: now,
        updatedAt: now,
      };

      const store = loadSwarmStore();

      const MAX_SWARMS = 500;
      // Evict terminated swarms first to free space
      for (const [id, s] of Object.entries(store.swarms)) {
        if (s.status === 'terminated') delete store.swarms[id];
      }
      if (Object.keys(store.swarms).length >= MAX_SWARMS) {
        return { success: false, error: 'Swarm limit reached' };
      }

      store.swarms[swarmId] = swarmState;
      saveSwarmStore(store);

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
      const swarmId = input.swarmId as string;

      const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
      if (swarmId && FORBIDDEN_KEYS.has(swarmId)) {
        return { status: 'not_found', message: `Swarm ${swarmId} not found` };
      }

      if (swarmId && Object.hasOwn(store.swarms, swarmId)) {
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
    name: 'swarm_scale',
    description: 'Scale a swarm to a target agent count by spawning or terminating agents',
    category: 'swarm',
    inputSchema: {
      type: 'object',
      properties: {
        swarmId: { type: 'string', description: 'Swarm ID to scale' },
        targetAgents: { type: 'number', description: 'Target number of agents' },
        agentType: { type: 'string', description: 'Agent type for newly spawned agents (default: worker)' },
      },
      required: ['swarmId', 'targetAgents'],
    },
    handler: async (input) => {
      const swarmId = input.swarmId as string;
      const targetAgents = input.targetAgents as number;
      const agentType = (input.agentType as string) || 'worker';

      const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
      if (!swarmId || FORBIDDEN_KEYS.has(swarmId)) {
        return { success: false, error: 'Invalid swarm ID' };
      }
      if (!Number.isFinite(targetAgents) || targetAgents < 0 || !Number.isInteger(targetAgents)) {
        return { success: false, error: 'targetAgents must be a non-negative integer' };
      }

      const store = loadSwarmStore();
      if (!Object.hasOwn(store.swarms, swarmId)) {
        return { success: false, error: `Swarm ${swarmId} not found` };
      }

      const swarm = store.swarms[swarmId];
      const currentCount = swarm.agents.length;
      const delta = targetAgents - currentCount;

      const spawnTool = agentTools.find(t => t.name === 'agent_spawn')!;
      const terminateTool = agentTools.find(t => t.name === 'agent_terminate')!;

      const spawned: string[] = [];
      const terminated: string[] = [];

      if (delta > 0) {
        for (let i = 0; i < delta; i++) {
          const result = await spawnTool.handler({ agentType }) as { success: boolean; agentId?: string };
          if (result.success && result.agentId) {
            swarm.agents.push(result.agentId);
            spawned.push(result.agentId);
          }
        }
      } else if (delta < 0) {
        const toRemove = swarm.agents.slice(0, -delta);
        for (const agentId of toRemove) {
          const result = await terminateTool.handler({ agentId }) as { success: boolean };
          if (result.success) {
            terminated.push(agentId);
          }
        }
        swarm.agents = swarm.agents.filter(id => !terminated.includes(id));
      }

      swarm.maxAgents = Math.max(swarm.maxAgents, swarm.agents.length);
      swarm.updatedAt = new Date().toISOString();
      saveSwarmStore(store);

      return {
        success: true,
        swarmId,
        previousCount: currentCount,
        currentCount: swarm.agents.length,
        targetAgents,
        spawned,
        terminated,
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
      const swarmId = input.swarmId as string;

      const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
      if (swarmId && FORBIDDEN_KEYS.has(swarmId)) {
        return { success: false, error: `Swarm ${swarmId} not found` };
      }

      // Find the swarm
      let target: SwarmState | undefined;
      if (swarmId && Object.hasOwn(store.swarms, swarmId)) {
        target = store.swarms[swarmId];
      } else {
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

      return {
        success: true,
        swarmId: target.swarmId,
        terminated: true,
        graceful: (input.graceful as boolean) ?? true,
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
      const swarmId = input.swarmId as string;

      const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
      if (swarmId && FORBIDDEN_KEYS.has(swarmId)) {
        return { status: 'not_found', healthy: false, checks: [{ name: 'swarm_exists', status: 'fail', message: `Swarm ${swarmId} not found` }], checkedAt: new Date().toISOString() };
      }

      // Find the swarm
      let target: SwarmState | undefined;
      if (swarmId) {
        target = Object.hasOwn(store.swarms, swarmId) ? store.swarms[swarmId] : undefined;
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
      } else {
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
