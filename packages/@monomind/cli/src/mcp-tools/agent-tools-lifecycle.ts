/**
 * Agent MCP Tools — spawn, terminate, status, list.
 * Extracted from agent-tools.ts.
 */

import { randomBytes } from 'node:crypto';
import { isBlockedModel } from '../model-guard.js';
import {
  type AgentRecord,
  determineAgentModel,
  loadAgentStore,
  loadAgentStoreOrNull,
  saveAgentStore,
} from './agent-tools-store.js';
import type { MCPTool } from './types.js';

const REGISTERED_NOTE =
  'Agent recorded in the agent store; no process was started. Run an agent turn with `monomind agent exec`.';

export const agentLifecycleTools: MCPTool[] = [
  {
    name: 'agent_spawn',
    description:
      'Register a new agent record (type, model, status) in the persistent agent store — a DB entry, not a running agent.',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentType: { type: 'string', description: 'Type of agent to spawn' },
        agentId: { type: 'string', description: 'Optional custom agent ID' },
        config: { type: 'object', description: 'Agent configuration' },
        domain: { type: 'string', description: 'Agent domain' },
        model: {
          type: 'string',
          enum: ['haiku', 'sonnet', 'opus', 'inherit'],
          description: 'Claude model to use (haiku=fast/cheap, sonnet=balanced, opus=most capable)',
        },
        task: { type: 'string', description: 'Task description for intelligent model routing' },
      },
      required: ['agentType'],
    },
    handler: async (input) => {
      const store = loadAgentStoreOrNull();
      if (!store) {
        return {
          success: false,
          error:
            'Agent store is unreadable/corrupt — refusing to spawn to avoid overwriting real agent data. Retry, or check the store file if this persists.',
        };
      }
      // Cap agentId: used as the JSON object key in store.agents[agentId].
      // An oversized key inflates the on-disk store for every spawned agent.
      // Cap agentType/domain: persisted as AgentRecord field values.
      const MAX_AGENT_ID_LEN = 256;
      const MAX_AGENT_TYPE_LEN = 128;
      const MAX_AGENT_DOMAIN_LEN = 256;
      const rawAgentId =
        (input.agentId as string) || `agent-${Date.now()}-${randomBytes(4).toString('hex')}`;
      const agentId =
        typeof rawAgentId === 'string' && rawAgentId.length > MAX_AGENT_ID_LEN
          ? rawAgentId.slice(0, MAX_AGENT_ID_LEN)
          : rawAgentId;
      const rawAgentType = input.agentType as string;
      const agentType =
        typeof rawAgentType === 'string' && rawAgentType.length > MAX_AGENT_TYPE_LEN
          ? rawAgentType.slice(0, MAX_AGENT_TYPE_LEN)
          : rawAgentType;

      if (['__proto__', 'constructor', 'prototype'].includes(agentId)) {
        return { success: false, agentId, error: 'Forbidden agent ID' };
      }

      if (input.agentId && store.agents[agentId]) {
        return {
          success: false,
          agentId,
          error: `Agent ${agentId} already exists. Terminate it first or omit agentId to auto-generate.`,
        };
      }
      const config = (input.config as Record<string, unknown>) || {};

      // Claude Fable and GPT Astra are never assigned or routed (model-guard.ts).
      for (const asked of [input.model, config.model]) {
        if (isBlockedModel(asked)) {
          return {
            success: false,
            agentId,
            error: `Model "${String(asked)}" is blocked: Claude Fable and GPT Astra models are never assigned or routed.`,
          };
        }
      }

      // Add explicit model to config if provided
      if (input.model) {
        config.model = input.model;
      }

      // Get task from either top-level or config (CLI passes it in config.task)
      const task = (input.task as string) || (config.task as string) || undefined;
      const rawDomain = input.domain as string;
      const domain =
        typeof rawDomain === 'string' && rawDomain.length > MAX_AGENT_DOMAIN_LEN
          ? rawDomain.slice(0, MAX_AGENT_DOMAIN_LEN)
          : rawDomain;

      // Determine model using ADR-026 3-tier routing logic
      const routingResult = await determineAgentModel(agentType, config, task);

      const agent: AgentRecord = {
        agentId,
        agentType,
        status: 'idle',
        health: 1.0,
        taskCount: 0,
        config,
        createdAt: new Date().toISOString(),
        domain,
        model: routingResult.model,
        modelRoutedBy: routingResult.routedBy,
      };

      store.agents[agentId] = agent;
      saveAgentStore(store);

      // Include Agent Booster routing info if applicable
      const response: Record<string, unknown> = {
        success: true,
        agentId,
        agentType: agent.agentType,
        model: agent.model,
        modelRoutedBy: routingResult.routedBy,
        // A store row, not a process (#418).
        status: 'registered',
        createdAt: agent.createdAt,
        note: REGISTERED_NOTE,
      };

      // Add Agent Booster info if task can skip LLM
      if (routingResult.canSkipLLM) {
        response.canSkipLLM = true;
        response.agentBoosterIntent = routingResult.agentBoosterIntent;
        response.tier = routingResult.tier;
        response.note = `${REGISTERED_NOTE} Agent Booster AST routing identified intent "${routingResult.agentBoosterIntent}", but no MCP tool executes it — this agent will run through the normal LLM path.`;
      } else if (routingResult.tier) {
        response.tier = routingResult.tier;
      }

      return response;
    },
  },
  {
    name: 'agent_terminate',
    description: 'Terminate an agent',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'ID of agent to terminate' },
        force: { type: 'boolean', description: 'Force immediate termination' },
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
            'Agent store is unreadable/corrupt — refusing to terminate to avoid overwriting real agent data.',
        };
      }

      if (Object.hasOwn(store.agents, agentId)) {
        store.agents[agentId].status = 'terminated';
        saveAgentStore(store);

        return {
          success: true,
          agentId,
          terminated: true,
          terminatedAt: new Date().toISOString(),
        };
      }

      return {
        success: false,
        agentId,
        error: 'Agent not found',
      };
    },
  },
  {
    name: 'agent_status',
    description: 'Get agent status',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'ID of agent' },
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
        return { agentId, error: 'Invalid agent ID' };
      }
      const store = loadAgentStore();
      const agent = Object.hasOwn(store.agents, agentId) ? store.agents[agentId] : undefined;

      if (agent) {
        return {
          agentId: agent.agentId,
          agentType: agent.agentType,
          status: agent.status,
          health: agent.health,
          taskCount: agent.taskCount,
          createdAt: agent.createdAt,
          domain: agent.domain,
          lastResult: agent.lastResult || null,
        };
      }

      return {
        agentId,
        status: 'not_found',
        error: 'Agent not found',
      };
    },
  },
  {
    name: 'agent_list',
    description: 'List all agents',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter by status (pass "all" or omit to include every status)',
        },
        domain: { type: 'string', description: 'Filter by domain' },
        agentType: { type: 'string', description: 'Filter by agent type' },
        includeTerminated: { type: 'boolean', description: 'Include terminated agents' },
      },
    },
    handler: async (input) => {
      const store = loadAgentStore();
      let agents = Object.values(store.agents);

      // Filter by status. 'all' (the CLI's `--all` flag sends this literal
      // string) means "no status filter" — it used to be treated as a real
      // status value to match against, which no agent ever has, so `--all`
      // silently returned zero agents instead of every agent.
      if (input.status && input.status !== 'all') {
        agents = agents.filter((a) => a.status === input.status);
      } else if (input.status !== 'all' && !input.includeTerminated) {
        agents = agents.filter((a) => a.status !== 'terminated');
      }

      // Filter by domain
      if (input.domain) {
        agents = agents.filter((a) => a.domain === input.domain);
      }

      // Filter by agent type — the CLI's `--type` flag has sent this since
      // it was added, but this handler never read it, so `--type` was a
      // silent no-op that returned every agent regardless of the filter.
      if (input.agentType) {
        agents = agents.filter((a) => a.agentType === input.agentType);
      }

      return {
        agents: agents.map((a) => ({
          agentId: a.agentId,
          agentType: a.agentType,
          status: a.status,
          health: a.health,
          taskCount: a.taskCount,
          createdAt: a.createdAt,
          domain: a.domain,
        })),
        total: agents.length,
        filters: {
          status: input.status,
          domain: input.domain,
          agentType: input.agentType,
          includeTerminated: input.includeTerminated,
        },
      };
    },
  },
];
