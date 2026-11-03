/**
 * Agent MCP Tools — pool management, health, update.
 * Extracted from agent-tools.ts.
 */

import { randomBytes } from 'node:crypto';
import {
  type AgentRecord,
  loadAgentStore,
  loadAgentStoreOrNull,
  saveAgentStore,
} from './agent-tools-store.js';
import type { MCPTool } from './types.js';

export const agentPoolTools: MCPTool[] = [
  {
    name: 'agent_pool',
    description: 'Manage agent pool',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'scale', 'drain'],
          description: 'Pool action (default: status)',
        },
        targetSize: { type: 'number', description: 'Target pool size (for scale action)' },
        agentType: { type: 'string', description: 'Agent type filter' },
      },
      // `action` is deliberately NOT required: the handler defaults it to
      // 'status', and the CLI `agent pool` command relies on that default.
      // It was previously declared required, which nothing enforced — once
      // required params became enforced, that false contract broke the CLI.
    },
    handler: async (input) => {
      const action = (input.action as string) || 'status'; // Default to status
      const store = loadAgentStoreOrNull();
      if (!store) {
        // 'scale'/'drain' would otherwise build on an empty store and save it,
        // wiping every real agent; 'status' reporting all-zeros on a corrupt
        // store would also be misleading, so all three branches bail here.
        return {
          action,
          error:
            'Agent store is unreadable/corrupt — refusing to proceed to avoid overwriting real agent data.',
        };
      }
      const agents = Object.values(store.agents).filter((a) => a.status !== 'terminated');

      if (action === 'status') {
        const byType: Record<string, number> = {};
        const byStatus: Record<string, number> = {};
        for (const agent of agents) {
          byType[agent.agentType] = (byType[agent.agentType] || 0) + 1;
          byStatus[agent.status] = (byStatus[agent.status] || 0) + 1;
        }
        const busyAgents = agents.filter((a) => a.status === 'busy').length;
        const utilization = agents.length > 0 ? busyAgents / agents.length : 0;
        return {
          action,
          // CLI expected fields
          poolId: 'agent-pool-default',
          currentSize: agents.length,
          utilization,
          agents: agents.map((a) => ({
            id: a.agentId,
            type: a.agentType,
            status: a.status,
          })),
          // Additional fields
          id: 'agent-pool-default',
          size: agents.length,
          totalAgents: agents.length,
          byType,
          byStatus,
          avgHealth:
            agents.length > 0 ? agents.reduce((sum, a) => sum + a.health, 0) / agents.length : 0,
        };
      }

      if (action === 'scale') {
        const targetSize = Math.min(Math.max((input.targetSize as number) || 5, 1), 50);
        const agentType = (input.agentType as string) || 'worker';
        const currentSize = agents.filter((a) => a.agentType === agentType).length;
        const delta = targetSize - currentSize;
        const added: string[] = [];
        const removed: string[] = [];

        if (delta > 0) {
          for (let i = 0; i < delta; i++) {
            const agentId = `agent-${Date.now()}-${randomBytes(4).toString('hex')}`;
            store.agents[agentId] = {
              agentId,
              agentType,
              status: 'idle',
              health: 1.0,
              taskCount: 0,
              config: {},
              createdAt: new Date().toISOString(),
            };
            added.push(agentId);
          }
        } else if (delta < 0) {
          const toRemove = agents
            .filter((a) => a.agentType === agentType && a.status === 'idle')
            .slice(0, -delta);
          for (const agent of toRemove) {
            store.agents[agent.agentId].status = 'terminated';
            removed.push(agent.agentId);
          }
        }

        saveAgentStore(store);
        return {
          action,
          agentType,
          previousSize: currentSize,
          targetSize,
          newSize: currentSize + delta,
          added,
          removed,
        };
      }

      if (action === 'drain') {
        const agentType = input.agentType as string;
        // Scope "remaining" to the same population drain operated over — when
        // filtered by agentType, agents.length (all non-terminated agents,
        // any type) minus drained (only that type's count) mixed two
        // different populations and produced a meaningless total.
        const scoped = agentType ? agents.filter((a) => a.agentType === agentType) : agents;
        let drained = 0;
        for (const agent of scoped) {
          if (agent.status === 'idle') {
            store.agents[agent.agentId].status = 'terminated';
            drained++;
          }
        }
        saveAgentStore(store);
        return {
          action,
          agentType: agentType || 'all',
          drained,
          remaining: scoped.length - drained,
        };
      }

      return { action, error: 'Unknown action' };
    },
  },
  {
    name: 'agent_health',
    description: 'Check agent health',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Specific agent ID (optional)' },
        threshold: { type: 'number', description: 'Health threshold (0-1)' },
      },
    },
    handler: async (input) => {
      const store = loadAgentStore();
      const agents = Object.values(store.agents).filter((a) => a.status !== 'terminated');
      const threshold = (input.threshold as number) || 0.5;

      if (input.agentId !== undefined) {
        const agentId = input.agentId as string;
        if (
          typeof agentId !== 'string' ||
          ['__proto__', 'constructor', 'prototype'].includes(agentId)
        ) {
          return { agentId, error: 'Invalid agent ID' };
        }
        const agent = Object.hasOwn(store.agents, agentId) ? store.agents[agentId] : undefined;
        if (agent) {
          return {
            agentId: agent.agentId,
            health: agent.health,
            status: agent.status,
            healthy: agent.health >= threshold,
            taskCount: agent.taskCount,
            uptime: Date.now() - new Date(agent.createdAt).getTime(),
          };
        }
        return { agentId, error: 'Agent not found' };
      }

      const healthyAgents = agents.filter((a) => a.health >= threshold);
      const degradedAgents = agents.filter((a) => a.health >= 0.3 && a.health < threshold);
      const unhealthyAgents = agents.filter((a) => a.health < 0.3);
      const avgHealth =
        agents.length > 0 ? agents.reduce((sum, a) => sum + a.health, 0) / agents.length : 1;

      return {
        // CLI expected fields
        agents: agents.map((a) => {
          const uptime = Date.now() - new Date(a.createdAt).getTime();
          return {
            id: a.agentId,
            type: a.agentType,
            health: a.health >= threshold ? 'healthy' : a.health >= 0.3 ? 'degraded' : 'unhealthy',
            uptime,
            tasks: {
              active: a.taskCount > 0 ? 1 : 0,
              queued: 0,
              completed: a.taskCount,
              failed: 0,
            },
            _note: 'Per-agent OS metrics not available — use system_metrics for real CPU/memory',
          };
        }),
        overall: {
          healthy: healthyAgents.length,
          degraded: degradedAgents.length,
          unhealthy: unhealthyAgents.length,
          cpu: null,
          memory: null,
          _note: 'Per-agent CPU/memory not available — use system_metrics for real OS-level stats',
          score: Math.round(avgHealth * 100),
          issues: unhealthyAgents.length,
        },
        // Additional fields
        total: agents.length,
        healthyCount: healthyAgents.length,
        unhealthyCount: unhealthyAgents.length,
        threshold,
        avgHealth,
        unhealthyAgents: unhealthyAgents.map((a) => ({
          agentId: a.agentId,
          health: a.health,
          status: a.status,
        })),
      };
    },
  },
  {
    name: 'agent_update',
    description: 'Update agent status or config',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'ID of agent' },
        status: { type: 'string', description: 'New status' },
        health: { type: 'number', description: 'Health value (0-1)' },
        taskCount: { type: 'number', description: 'Task count' },
        config: { type: 'object', description: 'Config updates' },
      },
      required: ['agentId'],
    },
    handler: async (input) => {
      const agentId = input.agentId as string;
      if (
        !agentId ||
        typeof agentId !== 'string' ||
        ['__proto__', 'constructor', 'prototype'].includes(agentId)
      ) {
        return { success: false, agentId, error: 'Invalid agent ID' };
      }
      const store = loadAgentStoreOrNull();
      if (!store) {
        return {
          success: false,
          agentId,
          error:
            'Agent store is unreadable/corrupt — refusing to update to avoid overwriting real agent data.',
        };
      }
      const agent = Object.hasOwn(store.agents, agentId) ? store.agents[agentId] : undefined;

      if (agent) {
        if (input.status) agent.status = input.status as AgentRecord['status'];
        if (typeof input.health === 'number') agent.health = input.health as number;
        if (typeof input.taskCount === 'number') agent.taskCount = input.taskCount as number;
        if (input.config) {
          agent.config = { ...agent.config, ...(input.config as Record<string, unknown>) };
        }
        saveAgentStore(store);

        return {
          success: true,
          agentId,
          updated: true,
          agent: {
            agentId: agent.agentId,
            status: agent.status,
            health: agent.health,
            taskCount: agent.taskCount,
          },
        };
      }

      return {
        success: false,
        agentId,
        error: 'Agent not found',
      };
    },
  },
];
