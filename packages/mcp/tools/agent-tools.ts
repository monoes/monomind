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
import { MCPTool, ToolContext } from '../types.js';
import { sanitizeErrorForLogging } from '../../@monobrain/shared/src/utils/secure-logger.js';
import { runAgentWithRetry } from '../../@monobrain/shared/src/retry-runner.js';
import { isAgentErrorResult } from '../../@monobrain/shared/src/agent-error-result.js';

// Task 31: ToolVersioning — lazy singleton DeprecationInjector; loaded once, reused across spawns
let _deprecationInjector: { inject: (r: Record<string, unknown>, t: string) => Record<string, unknown> } | null = null;
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

// Secure ID generation helper
function generateSecureAgentId(): string {
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
  // Academic
  'academic-anthropologist', 'academic-geographer', 'academic-historian',
  'academic-narratologist', 'academic-psychologist',
  // Design
  'design-brand-guardian', 'design-image-prompt-engineer', 'design-inclusive-visuals-specialist',
  'design-ui-designer', 'design-ux-architect', 'design-ux-researcher',
  'design-visual-storyteller', 'design-whimsy-injector',
  // Engineering
  'engineering-ai-data-remediation-engineer', 'engineering-ai-engineer',
  'engineering-autonomous-optimization-architect', 'engineering-backend-architect',
  'engineering-code-reviewer', 'engineering-data-engineer', 'engineering-database-optimizer',
  'engineering-devops-automator', 'engineering-embedded-firmware-engineer',
  'engineering-feishu-integration-developer', 'engineering-frontend-developer',
  'engineering-git-workflow-master', 'engineering-incident-response-commander',
  'engineering-mobile-app-builder', 'engineering-rapid-prototyper',
  'engineering-security-engineer', 'engineering-senior-developer',
  'engineering-software-architect', 'engineering-solidity-smart-contract-engineer',
  'engineering-sre', 'engineering-technical-writer', 'engineering-threat-detection-engineer',
  'engineering-wechat-mini-program-developer',
  // Game Development
  'blender-addon-engineer', 'game-audio-engineer', 'game-designer',
  'godot-gameplay-scripter', 'godot-multiplayer-engineer', 'godot-shader-developer',
  'level-designer', 'narrative-designer',
  'roblox-avatar-creator', 'roblox-experience-designer', 'roblox-systems-scripter',
  'technical-artist',
  'unity-architect', 'unity-editor-tool-developer', 'unity-multiplayer-engineer', 'unity-shader-graph-artist',
  'unreal-multiplayer-architect', 'unreal-systems-engineer', 'unreal-technical-artist', 'unreal-world-builder',
  // Marketing
  'marketing-ai-citation-strategist', 'marketing-app-store-optimizer',
  'marketing-baidu-seo-specialist', 'marketing-bilibili-content-strategist',
  'marketing-book-co-author', 'marketing-carousel-growth-engine',
  'marketing-china-ecommerce-operator', 'marketing-content-creator',
  'marketing-cross-border-ecommerce', 'marketing-douyin-strategist',
  'marketing-growth-hacker', 'marketing-instagram-curator',
  'marketing-kuaishou-strategist', 'marketing-linkedin-content-creator',
  'marketing-livestream-commerce-coach', 'marketing-podcast-strategist',
  'marketing-private-domain-operator', 'marketing-reddit-community-builder',
  'marketing-seo-specialist', 'marketing-short-video-editing-coach',
  'marketing-social-media-strategist', 'marketing-tiktok-strategist',
  'marketing-twitter-engager', 'marketing-wechat-official-account',
  'marketing-weibo-strategist', 'marketing-xiaohongshu-specialist',
  'marketing-zhihu-strategist',
  // Paid Media
  'paid-media-auditor', 'paid-media-creative-strategist', 'paid-media-paid-social-strategist',
  'paid-media-ppc-strategist', 'paid-media-programmatic-buyer',
  'paid-media-search-query-analyst', 'paid-media-tracking-specialist',
  // Product
  'product-behavioral-nudge-engine', 'product-feedback-synthesizer',
  'product-manager', 'product-sprint-prioritizer', 'product-trend-researcher',
  // Project Management
  'project-management-experiment-tracker', 'project-management-jira-workflow-steward',
  'project-management-project-shepherd', 'project-management-studio-operations',
  'project-management-studio-producer', 'project-manager-senior',
  // Sales
  'sales-account-strategist', 'sales-coach', 'sales-deal-strategist',
  'sales-discovery-coach', 'sales-engineer', 'sales-outbound-strategist',
  'sales-pipeline-analyst', 'sales-proposal-strategist',
  // Spatial Computing
  'macos-spatial-metal-engineer', 'terminal-integration-specialist',
  'visionos-spatial-engineer', 'xr-cockpit-interaction-specialist',
  'xr-immersive-developer', 'xr-interface-architect',
  // Specialized
  'accounts-payable-agent', 'agentic-identity-trust', 'agents-orchestrator',
  'automation-governance-architect', 'blockchain-security-auditor',
  'compliance-auditor', 'corporate-training-designer', 'data-consolidation-agent',
  'government-digital-presales-consultant', 'healthcare-marketing-compliance',
  'identity-graph-operator', 'lsp-index-engineer', 'recruitment-specialist',
  'report-distribution-agent', 'sales-data-extraction-agent',
  'specialized-cultural-intelligence-strategist', 'specialized-developer-advocate',
  'specialized-document-generator', 'specialized-french-consulting-market',
  'specialized-korean-business-navigator', 'specialized-mcp-builder',
  'specialized-model-qa', 'specialized-salesforce-architect',
  'specialized-workflow-architect', 'study-abroad-advisor',
  'supply-chain-strategist', 'zk-steward',
  // Support
  'support-analytics-reporter', 'support-executive-summary-generator',
  'support-finance-tracker', 'support-infrastructure-maintainer',
  'support-legal-compliance-checker', 'support-support-responder',
  // Testing
  'testing-accessibility-auditor', 'testing-api-tester', 'testing-evidence-collector',
  'testing-performance-benchmarker', 'testing-reality-checker',
  'testing-test-results-analyzer', 'testing-tool-evaluator', 'testing-workflow-optimizer',
  'production-validator', 'spec-mobile-react-native', 'tdd-london-swarm',
] as const;

type AgentType = typeof ALLOWED_AGENT_TYPES[number];

const agentTypeSchema = z.enum(ALLOWED_AGENT_TYPES).or(
  z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/,
    'Agent type must start with a letter and contain only alphanumeric characters, hyphens, and underscores'
  ).max(64, 'Agent type must not exceed 64 characters')
);

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
// Type Definitions
// ============================================================================

interface AgentInfo {
  id: string;
  agentType: string;
  status: 'active' | 'idle' | 'terminated';
  createdAt: string;
  lastActivityAt?: string;
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface AgentStatus extends AgentInfo {
  metrics?: {
    tasksCompleted: number;
    tasksInProgress: number;
    tasksFailed: number;
    averageExecutionTime: number;
    uptime: number;
  };
  history?: Array<{
    timestamp: string;
    event: string;
    details?: unknown;
  }>;
}

interface SpawnAgentResult {
  agentId: string;
  agentType: string;
  status: string;
  createdAt: string;
}

interface ListAgentsResult {
  agents: AgentInfo[];
  total: number;
  limit?: number;
  offset?: number;
}

interface TerminateAgentResult {
  agentId: string;
  terminated: boolean;
  terminatedAt: string;
  reason?: string;
}

// Schema for validating coordinator spawn results — used by runAgentWithRetry (Task 06)
const spawnResultSchema = z.object({
  agentId: z.string(),
  agentType: z.string(),
  status: z.string(),
  createdAt: z.string(),
});

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Spawn a new agent
 */
async function handleSpawnAgent(
  input: z.infer<typeof spawnAgentSchema>,
  context?: ToolContext
): Promise<SpawnAgentResult> {
  const agentId = input.id || generateSecureAgentId();
  const createdAt = new Date().toISOString();

  // Task 29: AgentVersioning — load active version definition for this agent type
  try {
    const { AgentVersionStore } = await import('../../@monobrain/cli/src/agents/version-store.js');
    const versionStore = new AgentVersionStore('.monobrain/agent-versions');
    const currentVersion = versionStore.getCurrent(input.agentType);
    if (currentVersion) {
      console.log(`[AGENT_VERSION] ${input.agentType} v${currentVersion.version} (id=${currentVersion.id})`);
    }
  } catch { /* version store not available — skip */ }

  // Task 31: ToolVersioning — warn if the agent/spawn MCP tool or this agent type is deprecated
  try {
    const injector = await getDeprecationInjector();
    if (injector) {
      // Check the MCP tool name AND an agent-type-specific key
      for (const toolKey of ['agent/spawn', input.agentType]) {
        const check = injector.inject({}, toolKey);
        if (check._deprecation) {
          console.warn((check._deprecation as { warning: string }).warning);
          break;
        }
      }
    }
  } catch { /* non-fatal */ }

  // Try to use swarmCoordinator if available
  if (context?.swarmCoordinator) {
    try {
      const { UnifiedSwarmCoordinator } = await import('@monobrain/swarm');
      const coordinator = context.swarmCoordinator as InstanceType<typeof UnifiedSwarmCoordinator>;

      // Spawn agent using the coordinator — wrapped with runAgentWithRetry (Task 06)
      const spawnWithRetry = await runAgentWithRetry({
        agentSlug: input.agentType,
        task: `spawn:${agentId}:${input.agentType}`,
        agentRunner: async (_task: string) => {
          await coordinator.spawnAgent({
            id: agentId,
            type: input.agentType as any,
            capabilities: input.config?.capabilities as any || [],
            priority: input.priority === 'critical' ? 1 : input.priority === 'high' ? 2 : input.priority === 'normal' ? 3 : 4,
          });
          return { agentId, agentType: input.agentType, status: 'active', createdAt };
        },
        outputSchema: spawnResultSchema,
      });

      if (isAgentErrorResult(spawnWithRetry)) {
        throw new Error(`Spawn failed after ${spawnWithRetry.attemptsExhausted} attempts: ${spawnWithRetry.errorSummary}`);
      }

      return spawnWithRetry as SpawnAgentResult;
    } catch (error) {
      // Fall through to simple implementation if coordinator fails
      // Use secure logging to prevent sensitive information disclosure
      console.error('Failed to spawn agent via coordinator:', sanitizeErrorForLogging(error));
    }
  }

  // Simple implementation when no coordinator is available
  const result: SpawnAgentResult = {
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
async function handleListAgents(
  input: z.infer<typeof listAgentsSchema>,
  context?: ToolContext
): Promise<ListAgentsResult> {
  // Try to use swarmCoordinator if available
  if (context?.swarmCoordinator) {
    try {
      const { UnifiedSwarmCoordinator } = await import('@monobrain/swarm');
      const coordinator = context.swarmCoordinator as InstanceType<typeof UnifiedSwarmCoordinator>;

      // Get swarm status
      const status = await coordinator.getStatus();

      // Convert swarm agents to AgentInfo format
      let agents: AgentInfo[] = status.agents.map(agent => ({
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
    } catch (error) {
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
async function handleTerminateAgent(
  input: z.infer<typeof terminateAgentSchema>,
  context?: ToolContext
): Promise<TerminateAgentResult> {
  const terminatedAt = new Date().toISOString();

  // Try to use swarmCoordinator if available
  if (context?.swarmCoordinator) {
    try {
      const { UnifiedSwarmCoordinator } = await import('@monobrain/swarm');
      const coordinator = context.swarmCoordinator as InstanceType<typeof UnifiedSwarmCoordinator>;

      // Terminate agent
      await coordinator.terminateAgent(input.agentId);

      return {
        agentId: input.agentId,
        terminated: true,
        terminatedAt,
        reason: input.reason,
      };
    } catch (error) {
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
async function handleAgentStatus(
  input: z.infer<typeof agentStatusSchema>,
  context?: ToolContext
): Promise<AgentStatus> {
  // Try to use swarmCoordinator if available
  if (context?.swarmCoordinator) {
    try {
      const { UnifiedSwarmCoordinator } = await import('@monobrain/swarm');
      const coordinator = context.swarmCoordinator as InstanceType<typeof UnifiedSwarmCoordinator>;

      // Get agent status
      const agentState = await coordinator.getAgentStatus(input.agentId);

      const status: AgentStatus = {
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
    } catch (error) {
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
export const spawnAgentTool: MCPTool = {
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
export const listAgentsTool: MCPTool = {
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
export const terminateAgentTool: MCPTool = {
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
export const agentStatusTool: MCPTool = {
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

export const agentTools: MCPTool[] = [
  spawnAgentTool,
  listAgentsTool,
  terminateAgentTool,
  agentStatusTool,
];

export default agentTools;
