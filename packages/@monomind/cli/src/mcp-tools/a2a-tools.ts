/**
 * A2A Agent Card MCP Tools
 *
 * Implements the Agent-to-Agent (A2A) Protocol's Agent Card specification.
 * Each agent type exposes a JSON card at a well-known endpoint so other
 * agents can discover its capabilities and communicate via SSE transport.
 *
 * Source: https://a2a-protocol.org
 *
 * @module v1/cli/mcp-tools/a2a-tools
 */

import type { MCPTool } from './types.js';

// ===== Input validation helpers =====

const MAX_AGENT_TYPE_LEN = 64;   // slug length — catalogue keys are all < 30 chars
const MAX_BASE_URL_LEN = 2048;   // typical browser URL limit
const MAX_TASK_ID_LEN = 256;
const MAX_SESSION_ID_LEN = 256;
// Allowlist of URL schemes that are safe to embed in returned Agent Card urls.
// Prevents javascript:, data:, file:// etc. from being reflected back to callers.
const ALLOWED_URL_SCHEMES = new Set(['http:', 'https:']);

/**
 * Validate and return an agent type slug.
 * Returns null when the value is not a string or exceeds the max length.
 */
function validateAgentType(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_AGENT_TYPE_LEN) return null;
  return value;
}

/**
 * Validate and return a base URL.
 * Accepts only http/https schemes and caps length to prevent oversized reflected values.
 * Falls back to the default localhost URL on failure.
 */
function validateBaseUrl(value: unknown, fallback = 'http://localhost:3000'): string {
  if (typeof value !== 'string' || value.length === 0) return fallback;
  if (value.length > MAX_BASE_URL_LEN) return fallback;
  try {
    const parsed = new URL(value);
    if (!ALLOWED_URL_SCHEMES.has(parsed.protocol)) return fallback;
    // Reject URLs with credentials — they should never appear in Agent Card endpoints
    if (parsed.username || parsed.password) return fallback;
  } catch {
    return fallback;
  }
  return value;
}

/**
 * Validate an optional string ID (taskId / sessionId).
 * Returns undefined when the value is absent; null when it is present but invalid.
 */
function validateOptionalId(value: unknown, maxLen: number): string | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLen) return null;
  return value;
}

// ===== A2A Protocol Types (a2a-protocol.org) =====

interface A2AProvider {
  organization: string;
  url: string;
}

interface A2ACapabilities {
  streaming: boolean;
  pushNotifications: boolean;
  stateTransitionHistory: boolean;
}

interface A2AAuthentication {
  schemes: string[];
}

interface A2ASkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

interface A2AAgentCard {
  /** A2A protocol version */
  protocolVersion: string;
  /** Unique agent type identifier */
  name: string;
  /** Human-readable description */
  description: string;
  /** Agent Card endpoint URL */
  url: string;
  /** Provider metadata */
  provider: A2AProvider;
  /** Protocol version semver */
  version: string;
  /** Documentation URL */
  documentationUrl?: string;
  /** Agent capabilities */
  capabilities: A2ACapabilities;
  /** Authentication requirements */
  authentication: A2AAuthentication;
  /** Default output MIME types */
  defaultOutputModes: string[];
  /** Default input MIME types */
  defaultInputModes: string[];
  /** Declared skills / tool capabilities */
  skills: A2ASkill[];
}

// ===== Agent type catalogue =====

/** Well-known agent types and their A2A card metadata */
const AGENT_CARD_CATALOGUE: Record<string, Omit<A2AAgentCard, 'url' | 'protocolVersion'>> = {
  coder: {
    name: 'monomind/coder',
    description: 'Implementation specialist — writes clean, efficient code from specifications',
    provider: { organization: 'monomind', url: 'https://github.com/monoes/monomind' },
    version: '1.0.0',
    documentationUrl: 'https://github.com/monoes/monomind#agents',
    capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: true },
    authentication: { schemes: ['bearer'] },
    defaultOutputModes: ['application/json', 'text/plain'],
    defaultInputModes: ['application/json', 'text/plain'],
    skills: [
      { id: 'implement-feature', name: 'Implement Feature', description: 'Write code for a feature from a spec', tags: ['code', 'implementation'], examples: ['Implement OAuth2 login handler'] },
      { id: 'fix-bug', name: 'Fix Bug', description: 'Diagnose and patch a defect', tags: ['debug', 'bugfix'] },
      { id: 'refactor', name: 'Refactor Code', description: 'Improve code structure without changing behaviour', tags: ['refactor', 'cleanup'] },
    ],
  },
  reviewer: {
    name: 'monomind/reviewer',
    description: 'Code review specialist — correctness, security, performance, maintainability',
    provider: { organization: 'monomind', url: 'https://github.com/monoes/monomind' },
    version: '1.0.0',
    capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: true },
    authentication: { schemes: ['bearer'] },
    defaultOutputModes: ['application/json', 'text/plain'],
    defaultInputModes: ['application/json', 'text/plain'],
    skills: [
      { id: 'code-review', name: 'Code Review', description: 'Review a diff or file for bugs and quality issues', tags: ['review', 'security', 'quality'] },
      { id: 'security-audit', name: 'Security Audit', description: 'Audit code for OWASP top-10 vulnerabilities', tags: ['security', 'audit'] },
    ],
  },
  tester: {
    name: 'monomind/tester',
    description: 'QA specialist — test strategy, test writing, coverage analysis',
    provider: { organization: 'monomind', url: 'https://github.com/monoes/monomind' },
    version: '1.0.0',
    capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: true },
    authentication: { schemes: ['bearer'] },
    defaultOutputModes: ['application/json', 'text/plain'],
    defaultInputModes: ['application/json', 'text/plain'],
    skills: [
      { id: 'write-tests', name: 'Write Tests', description: 'Write unit, integration, or e2e tests', tags: ['testing', 'tdd'] },
      { id: 'coverage-analysis', name: 'Coverage Analysis', description: 'Identify test coverage gaps', tags: ['coverage', 'quality'] },
    ],
  },
  researcher: {
    name: 'monomind/researcher',
    description: 'Research specialist — web search, code exploration, information synthesis',
    provider: { organization: 'monomind', url: 'https://github.com/monoes/monomind' },
    version: '1.0.0',
    capabilities: { streaming: true, pushNotifications: true, stateTransitionHistory: true },
    authentication: { schemes: ['bearer'] },
    defaultOutputModes: ['application/json', 'text/plain'],
    defaultInputModes: ['application/json', 'text/plain'],
    skills: [
      { id: 'web-research', name: 'Web Research', description: 'Search and synthesise information from the web', tags: ['research', 'search'] },
      { id: 'codebase-exploration', name: 'Codebase Exploration', description: 'Map and summarise a codebase', tags: ['research', 'code'] },
    ],
  },
  'security-architect': {
    name: 'monomind/security-architect',
    description: 'Security architecture specialist — threat modelling, CVE remediation, secure design',
    provider: { organization: 'monomind', url: 'https://github.com/monoes/monomind' },
    version: '1.0.0',
    capabilities: { streaming: true, pushNotifications: false, stateTransitionHistory: true },
    authentication: { schemes: ['bearer', 'mtls'] },
    defaultOutputModes: ['application/json', 'text/plain'],
    defaultInputModes: ['application/json', 'text/plain'],
    skills: [
      { id: 'threat-model', name: 'Threat Modelling', description: 'STRIDE/DREAD threat analysis', tags: ['security', 'threat-model'] },
      { id: 'redteam', name: 'Red Team', description: 'Adversarial prompt and API attack scenarios (PyRIT-style)', tags: ['security', 'redteam'] },
    ],
  },
};

function buildAgentCard(agentType: string, baseUrl: string): A2AAgentCard | null {
  const meta = AGENT_CARD_CATALOGUE[agentType];
  if (!meta) return null;
  return {
    protocolVersion: '0.2.2',
    url: `${baseUrl}/agents/${agentType}/.well-known/agent.json`,
    ...meta,
  };
}

// ===== MCP Tools =====

export const a2aTools: MCPTool[] = [
  {
    name: 'a2a_agent_card',
    description: 'Return the A2A protocol Agent Card JSON for a given agent type. Source: https://a2a-protocol.org',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentType: {
          type: 'string',
          description: 'Agent type slug (e.g. "coder", "reviewer", "tester", "researcher", "security-architect")',
        },
        baseUrl: {
          type: 'string',
          description: 'Base URL of the monomind server (default: "http://localhost:3000")',
        },
      },
      required: ['agentType'],
    },
    handler: async (input) => {
      const agentType = validateAgentType(input.agentType);
      if (!agentType) {
        return { success: false, error: 'agentType is required (non-empty string, max 64 chars)' };
      }
      const baseUrl = validateBaseUrl(input.baseUrl);

      const card = buildAgentCard(agentType, baseUrl);
      if (!card) {
        return {
          success: false,
          error: `Unknown agent type. Available: ${Object.keys(AGENT_CARD_CATALOGUE).join(', ')}`,
        };
      }

      return { success: true, agentCard: card, protocol: 'a2a', source: 'https://a2a-protocol.org' };
    },
  },

  {
    name: 'a2a_discover',
    description: 'List all available agent types with their A2A Agent Cards. Source: https://a2a-protocol.org',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        baseUrl: {
          type: 'string',
          description: 'Base URL of the monomind server (default: "http://localhost:3000")',
        },
        capabilities: {
          type: 'object',
          description: 'Filter agents by capability requirements (e.g. {streaming: true})',
        },
      },
    },
    handler: async (input) => {
      const baseUrl = validateBaseUrl(input.baseUrl);
      // Only accept a plain object capability filter to prevent prototype pollution.
      // Object.create(null) maps and class instances are intentionally rejected.
      const rawCap = input.capabilities;
      const capabilityFilter: Partial<A2ACapabilities> | undefined =
        rawCap !== null &&
        typeof rawCap === 'object' &&
        !Array.isArray(rawCap) &&
        Object.getPrototypeOf(rawCap) === Object.prototype
          ? (rawCap as Partial<A2ACapabilities>)
          : undefined;

      const KNOWN_CAPABILITY_KEYS: ReadonlySet<keyof A2ACapabilities> = new Set([
        'streaming', 'pushNotifications', 'stateTransitionHistory',
      ]);

      const cards = Object.keys(AGENT_CARD_CATALOGUE)
        .map(type => buildAgentCard(type, baseUrl))
        .filter((card): card is A2AAgentCard => {
          if (!card) return false;
          if (!capabilityFilter) return true;
          // Apply capability filter — only iterate known keys to prevent
          // prototype-chain access via attacker-controlled property names.
          for (const key of KNOWN_CAPABILITY_KEYS) {
            if (!(key in capabilityFilter)) continue;
            if (card.capabilities[key] !== capabilityFilter[key]) return false;
          }
          return true;
        });

      return {
        success: true,
        agents: cards,
        total: cards.length,
        protocol: 'a2a',
        source: 'https://a2a-protocol.org',
        registryUrl: `${baseUrl}/.well-known/agents`,
      };
    },
  },

  {
    name: 'a2a_send_task',
    description: 'Send a task to an agent using the A2A protocol (JSON-RPC over SSE transport). Source: https://a2a-protocol.org',
    category: 'agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentType: {
          type: 'string',
          description: 'Target agent type slug',
        },
        taskId: {
          type: 'string',
          description: 'Unique task identifier (auto-generated if omitted)',
        },
        message: {
          type: 'object',
          description: 'A2A message payload: {role, parts: [{type, text}]}',
        },
        sessionId: {
          type: 'string',
          description: 'Optional session ID for stateful conversations',
        },
        metadata: {
          type: 'object',
          description: 'Optional task metadata',
        },
      },
      required: ['agentType', 'message'],
    },
    handler: async (input) => {
      const agentType = validateAgentType(input.agentType);
      if (!agentType) {
        return { success: false, error: 'agentType is required (non-empty string, max 64 chars)' };
      }
      const message = input.message as { role: string; parts: Array<{ type: string; text?: string }> };
      const rawTaskId = validateOptionalId(input.taskId, MAX_TASK_ID_LEN);
      if (rawTaskId === null) {
        return { success: false, error: `taskId must be a non-empty string up to ${MAX_TASK_ID_LEN} chars` };
      }
      const taskId = rawTaskId ?? `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const rawSessionId = validateOptionalId(input.sessionId, MAX_SESSION_ID_LEN);
      if (rawSessionId === null) {
        return { success: false, error: `sessionId must be a non-empty string up to ${MAX_SESSION_ID_LEN} chars` };
      }
      const sessionId = rawSessionId;
      // Only accept plain objects for metadata to prevent prototype pollution
      const metadata: Record<string, unknown> =
        input.metadata !== null &&
        typeof input.metadata === 'object' &&
        !Array.isArray(input.metadata) &&
        Object.getPrototypeOf(input.metadata) === Object.prototype
          ? (input.metadata as Record<string, unknown>)
          : {};

      if (!AGENT_CARD_CATALOGUE[agentType]) {
        return {
          success: false,
          error: `Unknown agent type. Run a2a_discover to see available agents.`,
        };
      }

      // Return the A2A-compliant task submission envelope
      // In production this would POST to the agent's SSE endpoint
      const taskEnvelope = {
        jsonrpc: '2.0',
        method: 'tasks/send',
        id: taskId,
        params: {
          id: taskId,
          sessionId,
          message,
          metadata,
        },
      };

      return {
        success: true,
        taskId,
        agentType,
        status: 'submitted',
        envelope: taskEnvelope,
        transport: 'sse',
        protocol: 'a2a',
        source: 'https://a2a-protocol.org',
        note: 'Connect to the agent SSE endpoint to stream task progress events',
      };
    },
  },
];
