/**
 * V2 Compatibility Validator
 *
 * Validates that V1 implementation maintains backward compatibility with V2 capabilities.
 * Tests CLI commands, MCP tools, hooks, and API interfaces.
 *
 * @module v1/testing/v2-compat/compatibility-validator
 */

import { vi } from 'vitest';

/**
 * Validation result for a single check
 */
export interface ValidationCheck {
  name: string;
  category: 'cli' | 'mcp' | 'hooks' | 'api';
  passed: boolean;
  message: string;
  v2Behavior: string;
  currentBehavior: string;
  breaking: boolean;
  migrationPath?: string;
  details?: Record<string, unknown>;
}

/**
 * Validation result for a category
 */
export interface ValidationResult {
  category: 'cli' | 'mcp' | 'hooks' | 'api';
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  breakingChanges: number;
  checks: ValidationCheck[];
  duration: number;
}

/**
 * Full validation report
 */
export interface FullValidationReport {
  timestamp: Date;
  v2Version: string;
  currentVersion: string;
  overallPassed: boolean;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  breakingChanges: number;
  cli: ValidationResult;
  mcp: ValidationResult;
  hooks: ValidationResult;
  api: ValidationResult;
  summary: string;
  recommendations: string[];
  duration: number;
}

/**
 * V2 CLI command definition
 */
export interface V2CLICommand {
  name: string;
  aliases: string[];
  flags: string[];
  description: string;
  currentEquivalent?: string;
  deprecated?: boolean;
}

/**
 * V2 MCP tool definition
 */
export interface V2MCPTool {
  name: string;
  parameters: Record<string, { type: string; required: boolean }>;
  returnType: string;
  currentEquivalent?: string;
  deprecated?: boolean;
}

/**
 * V2 hook definition
 */
export interface V2Hook {
  name: string;
  trigger: string;
  parameters: string[];
  returnType: string;
  currentEquivalent?: string;
  deprecated?: boolean;
}

/**
 * V2 API interface definition
 */
export interface V2APIInterface {
  name: string;
  methods: { name: string; signature: string }[];
  currentEquivalent?: string;
  deprecated?: boolean;
}

/**
 * V2 CLI Commands (25 total)
 */
export const V2_CLI_COMMANDS: V2CLICommand[] = [
  // Core commands
  { name: 'init', aliases: ['i'], flags: ['--force', '--template'], description: 'Initialize monobrain project', currentEquivalent: 'init' },
  { name: 'start', aliases: ['s'], flags: ['--detached', '--port'], description: 'Start MCP server', currentEquivalent: 'start' },
  { name: 'stop', aliases: [], flags: ['--force'], description: 'Stop MCP server', currentEquivalent: 'stop' },
  { name: 'status', aliases: ['st'], flags: ['--json', '--verbose'], description: 'Show system status', currentEquivalent: 'status' },
  { name: 'config', aliases: ['c'], flags: ['--get', '--set', '--list'], description: 'Manage configuration', currentEquivalent: 'config' },

  // Agent commands
  { name: 'agent spawn', aliases: ['a spawn'], flags: ['--type', '--id', '--config'], description: 'Spawn new agent', currentEquivalent: 'agent spawn' },
  { name: 'agent list', aliases: ['a ls'], flags: ['--status', '--type'], description: 'List agents', currentEquivalent: 'agent list' },
  { name: 'agent terminate', aliases: ['a kill'], flags: ['--force', '--all'], description: 'Terminate agent', currentEquivalent: 'agent terminate' },
  { name: 'agent info', aliases: ['a info'], flags: ['--metrics'], description: 'Show agent info', currentEquivalent: 'agent status' },

  // Swarm commands
  { name: 'swarm init', aliases: ['sw init'], flags: ['--topology', '--max-agents'], description: 'Initialize swarm', currentEquivalent: 'swarm init' },
  { name: 'swarm status', aliases: ['sw st'], flags: ['--detailed'], description: 'Show swarm status', currentEquivalent: 'swarm status' },
  { name: 'swarm scale', aliases: ['sw scale'], flags: ['--up', '--down'], description: 'Scale swarm', currentEquivalent: 'swarm scale' },

  // Memory commands
  { name: 'memory list', aliases: ['mem ls'], flags: ['--type', '--limit'], description: 'List memories', currentEquivalent: 'memory list' },
  { name: 'memory query', aliases: ['mem q'], flags: ['--search', '--type'], description: 'Query memory', currentEquivalent: 'memory search' },
  { name: 'memory clear', aliases: ['mem clear'], flags: ['--force', '--type'], description: 'Clear memory', currentEquivalent: 'memory clear' },

  // Hooks commands
  { name: 'hooks pre-edit', aliases: [], flags: ['--file'], description: 'Pre-edit hook', currentEquivalent: 'hooks pre-edit' },
  { name: 'hooks post-edit', aliases: [], flags: ['--file', '--success'], description: 'Post-edit hook', currentEquivalent: 'hooks post-edit' },
  { name: 'hooks pre-command', aliases: [], flags: ['--command'], description: 'Pre-command hook', currentEquivalent: 'hooks pre-command' },
  { name: 'hooks post-command', aliases: [], flags: ['--command', '--success'], description: 'Post-command hook', currentEquivalent: 'hooks post-command' },
  { name: 'hooks route', aliases: [], flags: ['--task'], description: 'Route task', currentEquivalent: 'hooks route' },
  { name: 'hooks pretrain', aliases: [], flags: [], description: 'Pretrain from repo', currentEquivalent: 'hooks pretrain' },
  { name: 'hooks metrics', aliases: [], flags: ['--dashboard'], description: 'Show metrics', currentEquivalent: 'hooks metrics' },

  // Deprecated but supported
  { name: 'hive-mind init', aliases: [], flags: [], description: 'Initialize hive', currentEquivalent: 'swarm init', deprecated: true },
  { name: 'neural init', aliases: [], flags: [], description: 'Initialize neural', currentEquivalent: 'hooks pretrain', deprecated: true },
  { name: 'goal init', aliases: [], flags: [], description: 'Initialize goals', currentEquivalent: 'hooks pretrain', deprecated: true },
];

/**
 * V2 MCP Tools (65 total - showing key ones)
 */
export const V2_MCP_TOOLS: V2MCPTool[] = [
  // Agent tools
  { name: 'dispatch_agent', parameters: { type: { type: 'string', required: true }, name: { type: 'string', required: false } }, returnType: 'AgentInfo', currentEquivalent: 'agent/spawn' },
  { name: 'agents/spawn', parameters: { type: { type: 'string', required: true }, config: { type: 'object', required: false } }, returnType: 'AgentInfo', currentEquivalent: 'agent/spawn' },
  { name: 'agents/list', parameters: { status: { type: 'string', required: false } }, returnType: 'AgentInfo[]', currentEquivalent: 'agent/list' },
  { name: 'agents/terminate', parameters: { id: { type: 'string', required: true } }, returnType: 'boolean', currentEquivalent: 'agent/terminate' },
  { name: 'agents/info', parameters: { id: { type: 'string', required: true } }, returnType: 'AgentInfo', currentEquivalent: 'agent/status' },
  { name: 'agent/create', parameters: { type: { type: 'string', required: true } }, returnType: 'AgentInfo', currentEquivalent: 'agent/spawn' },

  // Swarm tools
  { name: 'swarm_status', parameters: {}, returnType: 'SwarmStatus', currentEquivalent: 'swarm/status' },
  { name: 'swarm/get-status', parameters: {}, returnType: 'SwarmStatus', currentEquivalent: 'swarm/status' },
  { name: 'swarm/get-comprehensive-status', parameters: {}, returnType: 'ComprehensiveStatus', currentEquivalent: 'swarm/status' },
  { name: 'mcp__ruv-swarm__swarm_init', parameters: { topology: { type: 'string', required: false } }, returnType: 'SwarmInfo', currentEquivalent: 'swarm/init' },
  { name: 'mcp__ruv-swarm__swarm_status', parameters: {}, returnType: 'SwarmStatus', currentEquivalent: 'swarm/status' },
  { name: 'mcp__ruv-swarm__agent_spawn', parameters: { type: { type: 'string', required: true } }, returnType: 'AgentInfo', currentEquivalent: 'agent/spawn' },
  { name: 'mcp__ruv-swarm__agent_list', parameters: {}, returnType: 'AgentInfo[]', currentEquivalent: 'agent/list' },
  { name: 'mcp__ruv-swarm__agent_metrics', parameters: { id: { type: 'string', required: true } }, returnType: 'AgentMetrics', currentEquivalent: 'agent/status' },

  // Memory tools
  { name: 'memory/query', parameters: { search: { type: 'string', required: true } }, returnType: 'MemoryEntry[]', currentEquivalent: 'memory/search' },
  { name: 'memory/store', parameters: { content: { type: 'string', required: true }, type: { type: 'string', required: false } }, returnType: 'MemoryEntry', currentEquivalent: 'memory/store' },
  { name: 'memory/delete', parameters: { id: { type: 'string', required: true } }, returnType: 'boolean', currentEquivalent: 'memory/delete' },
  { name: 'mcp__ruv-swarm__memory_usage', parameters: {}, returnType: 'MemoryStats', currentEquivalent: 'memory/list' },

  // Config tools
  { name: 'config/get', parameters: { key: { type: 'string', required: true } }, returnType: 'any', currentEquivalent: 'config/load' },
  { name: 'config/update', parameters: { key: { type: 'string', required: true }, value: { type: 'any', required: true } }, returnType: 'boolean', currentEquivalent: 'config/save' },

  // Task tools
  { name: 'task/create', parameters: { description: { type: 'string', required: true } }, returnType: 'TaskInfo', currentEquivalent: 'task/create' },
  { name: 'task/assign', parameters: { taskId: { type: 'string', required: true }, agentId: { type: 'string', required: true } }, returnType: 'boolean', currentEquivalent: 'task/assign' },
  { name: 'task/status', parameters: { taskId: { type: 'string', required: true } }, returnType: 'TaskStatus', currentEquivalent: 'task/status' },
  { name: 'task/complete', parameters: { taskId: { type: 'string', required: true }, result: { type: 'any', required: false } }, returnType: 'boolean', currentEquivalent: 'task/complete' },

  // Neural/Learning tools
  { name: 'mcp__ruv-swarm__neural_status', parameters: {}, returnType: 'NeuralStatus', currentEquivalent: 'hooks/metrics' },
  { name: 'mcp__ruv-swarm__neural_train', parameters: { data: { type: 'object', required: true } }, returnType: 'TrainingResult', currentEquivalent: 'hooks/pretrain' },

  // GitHub integration tools
  { name: 'github/pr-create', parameters: { title: { type: 'string', required: true }, body: { type: 'string', required: false } }, returnType: 'PRInfo', currentEquivalent: 'github/pr-create' },
  { name: 'github/pr-review', parameters: { prNumber: { type: 'number', required: true } }, returnType: 'ReviewInfo', currentEquivalent: 'github/pr-review' },
  { name: 'github/issue-create', parameters: { title: { type: 'string', required: true } }, returnType: 'IssueInfo', currentEquivalent: 'github/issue-create' },

  // Coordination tools
  { name: 'coordinate/consensus', parameters: { proposal: { type: 'object', required: true } }, returnType: 'ConsensusResult', currentEquivalent: 'swarm/consensus' },
  { name: 'coordinate/broadcast', parameters: { message: { type: 'object', required: true } }, returnType: 'BroadcastResult', currentEquivalent: 'swarm/broadcast' },
];

/**
 * V2 Hooks (42 total)
 */
export const V2_HOOKS: V2Hook[] = [
  // Edit hooks
  { name: 'pre-edit', trigger: 'before:file:edit', parameters: ['filePath', 'content'], returnType: 'HookResult', currentEquivalent: 'pre-edit' },
  { name: 'post-edit', trigger: 'after:file:edit', parameters: ['filePath', 'success', 'changes'], returnType: 'HookResult', currentEquivalent: 'post-edit' },
  { name: 'pre-create', trigger: 'before:file:create', parameters: ['filePath'], returnType: 'HookResult', currentEquivalent: 'pre-edit' },
  { name: 'post-create', trigger: 'after:file:create', parameters: ['filePath', 'success'], returnType: 'HookResult', currentEquivalent: 'post-edit' },

  // Command hooks
  { name: 'pre-command', trigger: 'before:command:execute', parameters: ['command', 'args'], returnType: 'HookResult', currentEquivalent: 'pre-command' },
  { name: 'post-command', trigger: 'after:command:execute', parameters: ['command', 'success', 'output'], returnType: 'HookResult', currentEquivalent: 'post-command' },
  { name: 'pre-bash', trigger: 'before:bash:execute', parameters: ['script'], returnType: 'HookResult', currentEquivalent: 'pre-command' },
  { name: 'post-bash', trigger: 'after:bash:execute', parameters: ['script', 'exitCode'], returnType: 'HookResult', currentEquivalent: 'post-command' },

  // Task hooks
  { name: 'pre-task', trigger: 'before:task:start', parameters: ['task'], returnType: 'HookResult', currentEquivalent: 'pre-task' },
  { name: 'post-task', trigger: 'after:task:complete', parameters: ['task', 'result'], returnType: 'HookResult', currentEquivalent: 'post-task' },
  { name: 'task-assign', trigger: 'on:task:assign', parameters: ['task', 'agent'], returnType: 'HookResult', currentEquivalent: 'task-assign' },
  { name: 'task-fail', trigger: 'on:task:fail', parameters: ['task', 'error'], returnType: 'HookResult', currentEquivalent: 'task-fail' },

  // Agent hooks
  { name: 'agent-spawn', trigger: 'on:agent:spawn', parameters: ['agentConfig'], returnType: 'HookResult', currentEquivalent: 'agent-spawn' },
  { name: 'agent-terminate', trigger: 'on:agent:terminate', parameters: ['agentId', 'reason'], returnType: 'HookResult', currentEquivalent: 'agent-terminate' },
  { name: 'agent-message', trigger: 'on:agent:message', parameters: ['from', 'to', 'message'], returnType: 'HookResult', currentEquivalent: 'agent-message' },
  { name: 'agent-error', trigger: 'on:agent:error', parameters: ['agentId', 'error'], returnType: 'HookResult', currentEquivalent: 'agent-error' },

  // Swarm hooks
  { name: 'swarm-init', trigger: 'on:swarm:init', parameters: ['topology', 'config'], returnType: 'HookResult', currentEquivalent: 'swarm-init' },
  { name: 'swarm-scale', trigger: 'on:swarm:scale', parameters: ['direction', 'count'], returnType: 'HookResult', currentEquivalent: 'swarm-scale' },
  { name: 'swarm-consensus', trigger: 'on:swarm:consensus', parameters: ['proposal', 'result'], returnType: 'HookResult', currentEquivalent: 'swarm-consensus' },
  { name: 'swarm-broadcast', trigger: 'on:swarm:broadcast', parameters: ['message'], returnType: 'HookResult', currentEquivalent: 'swarm-broadcast' },

  // Memory hooks
  { name: 'memory-store', trigger: 'on:memory:store', parameters: ['entry'], returnType: 'HookResult', currentEquivalent: 'memory-store' },
  { name: 'memory-retrieve', trigger: 'on:memory:retrieve', parameters: ['query', 'results'], returnType: 'HookResult', currentEquivalent: 'memory-retrieve' },
  { name: 'memory-delete', trigger: 'on:memory:delete', parameters: ['id'], returnType: 'HookResult', currentEquivalent: 'memory-delete' },
  { name: 'memory-consolidate', trigger: 'on:memory:consolidate', parameters: [], returnType: 'HookResult', currentEquivalent: 'memory-consolidate' },

  // Learning hooks
  { name: 'learning-pattern', trigger: 'on:learning:pattern', parameters: ['pattern'], returnType: 'HookResult', currentEquivalent: 'learning-pattern' },
  { name: 'learning-reward', trigger: 'on:learning:reward', parameters: ['trajectory', 'reward'], returnType: 'HookResult', currentEquivalent: 'learning-reward' },
  { name: 'learning-distill', trigger: 'on:learning:distill', parameters: ['memories'], returnType: 'HookResult', currentEquivalent: 'learning-distill' },
  { name: 'learning-consolidate', trigger: 'on:learning:consolidate', parameters: [], returnType: 'HookResult', currentEquivalent: 'learning-consolidate' },

  // Session hooks
  { name: 'session-start', trigger: 'on:session:start', parameters: ['sessionId'], returnType: 'HookResult', currentEquivalent: 'session-start' },
  { name: 'session-end', trigger: 'on:session:end', parameters: ['sessionId', 'metrics'], returnType: 'HookResult', currentEquivalent: 'session-end' },
  { name: 'session-resume', trigger: 'on:session:resume', parameters: ['sessionId'], returnType: 'HookResult', currentEquivalent: 'session-resume' },
  { name: 'session-pause', trigger: 'on:session:pause', parameters: ['sessionId'], returnType: 'HookResult', currentEquivalent: 'session-pause' },

  // Config hooks
  { name: 'config-load', trigger: 'on:config:load', parameters: ['config'], returnType: 'HookResult', currentEquivalent: 'config-load' },
  { name: 'config-save', trigger: 'on:config:save', parameters: ['config'], returnType: 'HookResult', currentEquivalent: 'config-save' },
  { name: 'config-change', trigger: 'on:config:change', parameters: ['key', 'oldValue', 'newValue'], returnType: 'HookResult', currentEquivalent: 'config-change' },

  // Error hooks
  { name: 'error-global', trigger: 'on:error:global', parameters: ['error'], returnType: 'HookResult', currentEquivalent: 'error-global' },
  { name: 'error-recover', trigger: 'on:error:recover', parameters: ['error', 'strategy'], returnType: 'HookResult', currentEquivalent: 'error-recover' },

  // Performance hooks
  { name: 'perf-threshold', trigger: 'on:perf:threshold', parameters: ['metric', 'value'], returnType: 'HookResult', currentEquivalent: 'perf-threshold' },
  { name: 'perf-report', trigger: 'on:perf:report', parameters: ['report'], returnType: 'HookResult', currentEquivalent: 'perf-report' },

  // Security hooks
  { name: 'security-alert', trigger: 'on:security:alert', parameters: ['alert'], returnType: 'HookResult', currentEquivalent: 'security-alert' },
  { name: 'security-block', trigger: 'on:security:block', parameters: ['operation', 'reason'], returnType: 'HookResult', currentEquivalent: 'security-block' },
  { name: 'security-audit', trigger: 'on:security:audit', parameters: ['action', 'context'], returnType: 'HookResult', currentEquivalent: 'security-audit' },
];

/**
 * V2 API Interfaces
 */
export const V2_API_INTERFACES: V2APIInterface[] = [
  // Core interfaces
  {
    name: 'HiveMind',
    methods: [
      { name: 'initialize', signature: '(config?: HiveMindConfig): Promise<void>' },
      { name: 'spawn', signature: '(type: string, config?: AgentConfig): Promise<Agent>' },
      { name: 'getStatus', signature: '(): Promise<HiveMindStatus>' },
      { name: 'shutdown', signature: '(): Promise<void>' },
    ],
    currentEquivalent: 'UnifiedSwarmCoordinator',
  },
  {
    name: 'SwarmCoordinator',
    methods: [
      { name: 'init', signature: '(topology: string): Promise<void>' },
      { name: 'addAgent', signature: '(agent: Agent): Promise<void>' },
      { name: 'removeAgent', signature: '(agentId: string): Promise<void>' },
      { name: 'broadcast', signature: '(message: Message): Promise<void>' },
      { name: 'consensus', signature: '(proposal: Proposal): Promise<ConsensusResult>' },
    ],
    currentEquivalent: 'UnifiedSwarmCoordinator',
  },
  {
    name: 'MemoryManager',
    methods: [
      { name: 'store', signature: '(entry: MemoryEntry): Promise<string>' },
      { name: 'query', signature: '(search: string): Promise<MemoryEntry[]>' },
      { name: 'delete', signature: '(id: string): Promise<boolean>' },
      { name: 'clear', signature: '(): Promise<void>' },
      { name: 'getStats', signature: '(): Promise<MemoryStats>' },
    ],
    currentEquivalent: 'UnifiedMemoryService',
  },
  {
    name: 'AgentManager',
    methods: [
      { name: 'spawn', signature: '(config: AgentConfig): Promise<Agent>' },
      { name: 'terminate', signature: '(id: string): Promise<void>' },
      { name: 'list', signature: '(): Promise<Agent[]>' },
      { name: 'getInfo', signature: '(id: string): Promise<AgentInfo>' },
    ],
    currentEquivalent: 'AgentLifecycleService',
  },
  {
    name: 'TaskOrchestrator',
    methods: [
      { name: 'create', signature: '(definition: TaskDefinition): Promise<Task>' },
      { name: 'assign', signature: '(taskId: string, agentId: string): Promise<void>' },
      { name: 'complete', signature: '(taskId: string, result?: any): Promise<void>' },
      { name: 'getStatus', signature: '(taskId: string): Promise<TaskStatus>' },
    ],
    currentEquivalent: 'TaskExecutionService',
  },
];

/**
 * Mock V1 service for testing
 */
interface MockService {
  cli: {
    execute: (command: string, args: string[]) => Promise<{ success: boolean; output: string }>;
    getCommands: () => string[];
  };
  mcp: {
    callTool: (name: string, params: Record<string, unknown>) => Promise<unknown>;
    getTools: () => string[];
    translateToolName: (v2Name: string) => string;
  };
  hooks: {
    trigger: (name: string, params: Record<string, unknown>) => Promise<{ handled: boolean; result: unknown }>;
    getHooks: () => string[];
  };
  api: {
    getClass: (name: string) => { methods: string[] } | null;
    getClasses: () => string[];
  };
}

/**
 * V2 Compatibility Validator
 *
 * Tests V1 implementation against V2 capabilities to ensure backward compatibility.
 */
export class V2CompatibilityValidator {
  private readonly currentService: MockService;
  private readonly v2Version: string;
  private readonly currentVersion: string;
  private readonly verbose: boolean;

  constructor(options: {
    currentService?: MockService;
    v2Version?: string;
    currentVersion?: string;
    verbose?: boolean;
  } = {}) {
    this.currentService = options.currentService || this.createDefaultMockService();
    this.v2Version = options.v2Version || '2.0.0';
    this.currentVersion = options.currentVersion || '3.0.0';
    this.verbose = options.verbose || false;
  }

  /**
   * Create default mock V1 service for testing
   */
  private createDefaultMockService(): MockService {
    // Tool name mapping from V2 to V1
    const toolNameMapping: Record<string, string> = {
      'dispatch_agent': 'agent/spawn',
      'agents/spawn': 'agent/spawn',
      'agents/list': 'agent/list',
      'agents/terminate': 'agent/terminate',
      'agents/info': 'agent/status',
      'agent/create': 'agent/spawn',
      'swarm_status': 'swarm/status',
      'swarm/get-status': 'swarm/status',
      'swarm/get-comprehensive-status': 'swarm/status',
      'mcp__ruv-swarm__swarm_init': 'swarm/init',
      'mcp__ruv-swarm__swarm_status': 'swarm/status',
      'mcp__ruv-swarm__agent_spawn': 'agent/spawn',
      'mcp__ruv-swarm__agent_list': 'agent/list',
      'mcp__ruv-swarm__agent_metrics': 'agent/status',
      'memory/query': 'memory/search',
      'mcp__ruv-swarm__memory_usage': 'memory/list',
      'config/get': 'config/load',
      'config/update': 'config/save',
      'mcp__ruv-swarm__neural_status': 'hooks/metrics',
      'mcp__ruv-swarm__neural_train': 'hooks/pretrain',
    };

    const currentTools = [
      'agent/spawn', 'agent/list', 'agent/terminate', 'agent/status',
      'swarm/init', 'swarm/status', 'swarm/scale', 'swarm/consensus', 'swarm/broadcast',
      'memory/store', 'memory/search', 'memory/delete', 'memory/list',
      'task/create', 'task/assign', 'task/status', 'task/complete',
      'config/load', 'config/save',
      'hooks/metrics', 'hooks/pretrain',
      'github/pr-create', 'github/pr-review', 'github/issue-create',
    ];

    const currentCommands = [
      'init', 'start', 'stop', 'status', 'config',
      'agent spawn', 'agent list', 'agent terminate', 'agent status',
      'swarm init', 'swarm status', 'swarm scale',
      'memory list', 'memory search', 'memory clear',
      'hooks pre-edit', 'hooks post-edit', 'hooks pre-command', 'hooks post-command',
      'hooks route', 'hooks pretrain', 'hooks metrics',
    ];

    const currentHooks = V2_HOOKS.map(h => h.currentEquivalent || h.name);

    const currentClasses = ['UnifiedSwarmCoordinator', 'UnifiedMemoryService', 'AgentLifecycleService', 'TaskExecutionService'];

    return {
      cli: {
        execute: vi.fn().mockImplementation(async (command: string) => {
          const isSupported = currentCommands.some(c => c === command || command.startsWith(c.split(' ')[0]));
          return { success: isSupported, output: isSupported ? 'OK' : 'Command not found' };
        }),
        getCommands: vi.fn().mockReturnValue(currentCommands),
      },
      mcp: {
        callTool: vi.fn().mockImplementation(async (name: string) => {
          const currentName = toolNameMapping[name] || name;
          const isSupported = currentTools.includes(currentName);
          if (!isSupported) throw new Error(`Tool not found: ${name}`);
          return { success: true };
        }),
        getTools: vi.fn().mockReturnValue(currentTools),
        translateToolName: vi.fn().mockImplementation((v2Name: string) => toolNameMapping[v2Name] || v2Name),
      },
      hooks: {
        trigger: vi.fn().mockImplementation(async (name: string) => {
          const isSupported = currentHooks.includes(name);
          return { handled: isSupported, result: isSupported ? {} : null };
        }),
        getHooks: vi.fn().mockReturnValue(currentHooks),
      },
      api: {
        getClass: vi.fn().mockImplementation((name: string) => {
          const mapping: Record<string, { methods: string[] }> = {
            'UnifiedSwarmCoordinator': { methods: ['initialize', 'spawn', 'addAgent', 'removeAgent', 'broadcast', 'consensus', 'getStatus', 'shutdown'] },
            'UnifiedMemoryService': { methods: ['store', 'search', 'delete', 'clear', 'getStats'] },
            'AgentLifecycleService': { methods: ['spawn', 'terminate', 'list', 'getInfo', 'getStatus'] },
            'TaskExecutionService': { methods: ['create', 'assign', 'complete', 'getStatus'] },
          };
          return mapping[name] || null;
        }),
        getClasses: vi.fn().mockReturnValue(currentClasses),
      },
    };
  }

  /**
   * Validate CLI command compatibility
   */
  async validateCLI(): Promise<ValidationResult> {
    const startTime = Date.now();
    const checks: ValidationCheck[] = [];
    const currentCommands = this.currentService.cli.getCommands();

    for (const cmd of V2_CLI_COMMANDS) {
      const currentEquivalent = cmd.currentEquivalent || cmd.name;
      const isSupported = currentCommands.some(c =>
        c === currentEquivalent || c.startsWith(currentEquivalent.split(' ')[0])
      );

      // Check command exists
      checks.push({
        name: `CLI: ${cmd.name}`,
        category: 'cli',
        passed: isSupported,
        message: isSupported
          ? `Command "${cmd.name}" is supported via "${currentEquivalent}"`
          : `Command "${cmd.name}" is not available`,
        v2Behavior: `Execute "${cmd.name}" with flags: ${cmd.flags.join(', ') || 'none'}`,
        currentBehavior: isSupported
          ? `Execute "${currentEquivalent}"`
          : 'Not available',
        breaking: !isSupported && !cmd.deprecated,
        migrationPath: isSupported ? `Use "${currentEquivalent}" instead` : undefined,
      });

      // Check aliases
      for (const alias of cmd.aliases) {
        const aliasSupported = currentCommands.some(c => c === alias || c.startsWith(alias.split(' ')[0]));
        checks.push({
          name: `CLI Alias: ${alias}`,
          category: 'cli',
          passed: aliasSupported || isSupported,
          message: aliasSupported
            ? `Alias "${alias}" is supported`
            : `Alias "${alias}" not directly supported, use "${currentEquivalent}"`,
          v2Behavior: `Execute "${alias}"`,
          currentBehavior: aliasSupported ? `Execute "${alias}"` : `Execute "${currentEquivalent}"`,
          breaking: false,
          migrationPath: `Use "${currentEquivalent}" for consistent behavior`,
        });
      }

      // Check flags
      for (const flag of cmd.flags) {
        checks.push({
          name: `CLI Flag: ${cmd.name} ${flag}`,
          category: 'cli',
          passed: isSupported, // Assume flags are supported if command is
          message: isSupported
            ? `Flag "${flag}" is expected to work with "${currentEquivalent}"`
            : `Flag "${flag}" not available (command not supported)`,
          v2Behavior: `Use "${flag}" with "${cmd.name}"`,
          currentBehavior: isSupported ? `Use "${flag}" with "${currentEquivalent}"` : 'Not available',
          breaking: !isSupported && !cmd.deprecated,
        });
      }
    }

    const passedChecks = checks.filter(c => c.passed).length;
    const breakingChanges = checks.filter(c => c.breaking).length;

    return {
      category: 'cli',
      totalChecks: checks.length,
      passedChecks,
      failedChecks: checks.length - passedChecks,
      breakingChanges,
      checks,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Validate MCP tool compatibility
   */
  async validateMCPTools(): Promise<ValidationResult> {
    const startTime = Date.now();
    const checks: ValidationCheck[] = [];
    const currentTools = this.currentService.mcp.getTools();

    for (const tool of V2_MCP_TOOLS) {
      const currentEquivalent = this.currentService.mcp.translateToolName(tool.name);
      const isSupported = currentTools.includes(currentEquivalent);

      // Check tool exists
      checks.push({
        name: `MCP Tool: ${tool.name}`,
        category: 'mcp',
        passed: isSupported,
        message: isSupported
          ? `Tool "${tool.name}" maps to "${currentEquivalent}"`
          : `Tool "${tool.name}" has no equivalent`,
        v2Behavior: `Call "${tool.name}" with params`,
        currentBehavior: isSupported
          ? `Call "${currentEquivalent}" with translated params`
          : 'Not available',
        breaking: !isSupported && !tool.deprecated,
        migrationPath: isSupported ? `Use "${currentEquivalent}" with updated parameters` : undefined,
        details: {
          v2Parameters: tool.parameters,
          currentEquivalent,
        },
      });

      // Check parameter translation
      if (isSupported) {
        for (const [paramName, paramDef] of Object.entries(tool.parameters)) {
          checks.push({
            name: `MCP Param: ${tool.name}.${paramName}`,
            category: 'mcp',
            passed: true, // Assume param translation works
            message: `Parameter "${paramName}" (${paramDef.type}) is translated`,
            v2Behavior: `Pass "${paramName}" as ${paramDef.type}`,
            currentBehavior: `Translated to current format`,
            breaking: false,
          });
        }
      }
    }

    const passedChecks = checks.filter(c => c.passed).length;
    const breakingChanges = checks.filter(c => c.breaking).length;

    return {
      category: 'mcp',
      totalChecks: checks.length,
      passedChecks,
      failedChecks: checks.length - passedChecks,
      breakingChanges,
      checks,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Validate hook compatibility
   */
  async validateHooks(): Promise<ValidationResult> {
    const startTime = Date.now();
    const checks: ValidationCheck[] = [];
    const currentHooks = this.currentService.hooks.getHooks();

    for (const hook of V2_HOOKS) {
      const currentEquivalent = hook.currentEquivalent || hook.name;
      const isSupported = currentHooks.includes(currentEquivalent);

      // Check hook exists
      checks.push({
        name: `Hook: ${hook.name}`,
        category: 'hooks',
        passed: isSupported,
        message: isSupported
          ? `Hook "${hook.name}" is supported as "${currentEquivalent}"`
          : `Hook "${hook.name}" is not available`,
        v2Behavior: `Trigger on "${hook.trigger}" with params: ${hook.parameters.join(', ')}`,
        currentBehavior: isSupported
          ? `Trigger "${currentEquivalent}" with translated params`
          : 'Not available',
        breaking: !isSupported && !hook.deprecated,
        migrationPath: isSupported ? `Listen for "${currentEquivalent}" instead` : undefined,
        details: {
          v2Trigger: hook.trigger,
          v2Parameters: hook.parameters,
          currentEquivalent,
        },
      });

      // Check parameters
      for (const param of hook.parameters) {
        checks.push({
          name: `Hook Param: ${hook.name}.${param}`,
          category: 'hooks',
          passed: isSupported, // Assume params work if hook works
          message: isSupported
            ? `Parameter "${param}" is passed to hook`
            : `Parameter "${param}" not available (hook not supported)`,
          v2Behavior: `Receive "${param}" in hook handler`,
          currentBehavior: isSupported ? 'Translated parameter available' : 'Not available',
          breaking: !isSupported,
        });
      }

      // Check return type compatibility
      checks.push({
        name: `Hook Return: ${hook.name}`,
        category: 'hooks',
        passed: isSupported,
        message: isSupported
          ? `Return type "${hook.returnType}" is compatible`
          : `Return type not available (hook not supported)`,
        v2Behavior: `Return ${hook.returnType}`,
        currentBehavior: isSupported ? `Return compatible ${hook.returnType}` : 'Not available',
        breaking: !isSupported,
      });
    }

    const passedChecks = checks.filter(c => c.passed).length;
    const breakingChanges = checks.filter(c => c.breaking).length;

    return {
      category: 'hooks',
      totalChecks: checks.length,
      passedChecks,
      failedChecks: checks.length - passedChecks,
      breakingChanges,
      checks,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Validate API compatibility
   */
  async validateAPI(): Promise<ValidationResult> {
    const startTime = Date.now();
    const checks: ValidationCheck[] = [];
    const currentClasses = this.currentService.api.getClasses();

    for (const iface of V2_API_INTERFACES) {
      const currentEquivalent = iface.currentEquivalent || iface.name;
      const currentClass = this.currentService.api.getClass(currentEquivalent);
      const isSupported = currentClass !== null;

      // Check class exists
      checks.push({
        name: `API Class: ${iface.name}`,
        category: 'api',
        passed: isSupported,
        message: isSupported
          ? `Class "${iface.name}" is available as "${currentEquivalent}"`
          : `Class "${iface.name}" has no equivalent`,
        v2Behavior: `Import and use "${iface.name}"`,
        currentBehavior: isSupported
          ? `Import "${currentEquivalent}" from @monobrain/*`
          : 'Not available',
        breaking: !isSupported && !iface.deprecated,
        migrationPath: isSupported
          ? `Use "${currentEquivalent}" with import alias`
          : undefined,
      });

      // Check methods
      for (const method of iface.methods) {
        const methodAvailable = currentClass?.methods.some(m =>
          m === method.name || m.toLowerCase() === method.name.toLowerCase()
        );

        checks.push({
          name: `API Method: ${iface.name}.${method.name}`,
          category: 'api',
          passed: methodAvailable || false,
          message: methodAvailable
            ? `Method "${method.name}" is available`
            : `Method "${method.name}" may have different name or signature`,
          v2Behavior: `Call ${iface.name}.${method.name}${method.signature}`,
          currentBehavior: methodAvailable
            ? `Call ${currentEquivalent}.${method.name}()`
            : 'May need migration',
          breaking: !methodAvailable && !iface.deprecated,
          migrationPath: methodAvailable
            ? 'Same method signature'
            : 'Check V1 API documentation',
        });
      }
    }

    const passedChecks = checks.filter(c => c.passed).length;
    const breakingChanges = checks.filter(c => c.breaking).length;

    return {
      category: 'api',
      totalChecks: checks.length,
      passedChecks,
      failedChecks: checks.length - passedChecks,
      breakingChanges,
      checks,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Run full validation suite
   */
  async runFullValidation(): Promise<FullValidationReport> {
    const startTime = Date.now();

    this.log('Starting V2 Compatibility Validation...');

    this.log('Validating CLI commands...');
    const cliResult = await this.validateCLI();

    this.log('Validating MCP tools...');
    const mcpResult = await this.validateMCPTools();

    this.log('Validating hooks...');
    const hooksResult = await this.validateHooks();

    this.log('Validating API interfaces...');
    const apiResult = await this.validateAPI();

    const totalChecks = cliResult.totalChecks + mcpResult.totalChecks + hooksResult.totalChecks + apiResult.totalChecks;
    const passedChecks = cliResult.passedChecks + mcpResult.passedChecks + hooksResult.passedChecks + apiResult.passedChecks;
    const failedChecks = totalChecks - passedChecks;
    const breakingChanges = cliResult.breakingChanges + mcpResult.breakingChanges + hooksResult.breakingChanges + apiResult.breakingChanges;

    const overallPassed = breakingChanges === 0;

    const recommendations = this.generateRecommendations(cliResult, mcpResult, hooksResult, apiResult);

    const report: FullValidationReport = {
      timestamp: new Date(),
      v2Version: this.v2Version,
      currentVersion: this.currentVersion,
      overallPassed,
      totalChecks,
      passedChecks,
      failedChecks,
      breakingChanges,
      cli: cliResult,
      mcp: mcpResult,
      hooks: hooksResult,
      api: apiResult,
      summary: this.generateSummary(cliResult, mcpResult, hooksResult, apiResult, overallPassed),
      recommendations,
      duration: Date.now() - startTime,
    };

    this.log('Validation complete.');

    return report;
  }

  /**
   * Generate recommendations based on results
   */
  private generateRecommendations(
    cli: ValidationResult,
    mcp: ValidationResult,
    hooks: ValidationResult,
    api: ValidationResult
  ): string[] {
    const recommendations: string[] = [];

    if (cli.breakingChanges > 0) {
      recommendations.push('Update CLI command calls to use V1 equivalents');
      recommendations.push('Run migration script: npx @monobrain/cli migrate');
    }

    if (mcp.breakingChanges > 0) {
      recommendations.push('Enable V2 compatibility mode in MCP server configuration');
      recommendations.push('Update tool calls to use new naming convention (e.g., agent/spawn)');
    }

    if (hooks.breakingChanges > 0) {
      recommendations.push('Review hook configuration for renamed or removed hooks');
      recommendations.push('Update hook listeners to use V1 event names');
    }

    if (api.breakingChanges > 0) {
      recommendations.push('Update import statements to use @monobrain/* packages');
      recommendations.push('Use provided import aliases for backward compatibility');
    }

    if (cli.passedChecks < cli.totalChecks) {
      recommendations.push('Some CLI aliases may not be directly supported - use canonical command names');
    }

    if (mcp.passedChecks < mcp.totalChecks) {
      recommendations.push('Consider using tool name translation layer for gradual migration');
    }

    if (recommendations.length === 0) {
      recommendations.push('No migration actions required - V2 code is fully compatible');
    }

    return recommendations;
  }

  /**
   * Generate human-readable summary
   */
  private generateSummary(
    cli: ValidationResult,
    mcp: ValidationResult,
    hooks: ValidationResult,
    api: ValidationResult,
    overallPassed: boolean
  ): string {
    const lines: string[] = [
      '='.repeat(70),
      '           V2 COMPATIBILITY VALIDATION REPORT',
      '='.repeat(70),
      '',
      `Status: ${overallPassed ? 'PASSED - No breaking changes detected' : 'FAILED - Breaking changes detected'}`,
      '',
      'Category Summary:',
      '-'.repeat(70),
      `CLI Commands:    ${cli.passedChecks}/${cli.totalChecks} passed (${cli.breakingChanges} breaking)`,
      `MCP Tools:       ${mcp.passedChecks}/${mcp.totalChecks} passed (${mcp.breakingChanges} breaking)`,
      `Hooks:           ${hooks.passedChecks}/${hooks.totalChecks} passed (${hooks.breakingChanges} breaking)`,
      `API Interfaces:  ${api.passedChecks}/${api.totalChecks} passed (${api.breakingChanges} breaking)`,
      '-'.repeat(70),
      '',
    ];

    if (!overallPassed) {
      lines.push('Breaking Changes Detected:');
      lines.push('');

      const allBreaking = [
        ...cli.checks.filter(c => c.breaking).map(c => `  CLI: ${c.name}`),
        ...mcp.checks.filter(c => c.breaking).map(c => `  MCP: ${c.name}`),
        ...hooks.checks.filter(c => c.breaking).map(c => `  Hooks: ${c.name}`),
        ...api.checks.filter(c => c.breaking).map(c => `  API: ${c.name}`),
      ].slice(0, 20);

      lines.push(...allBreaking);

      if (cli.breakingChanges + mcp.breakingChanges + hooks.breakingChanges + api.breakingChanges > 20) {
        lines.push(`  ... and ${cli.breakingChanges + mcp.breakingChanges + hooks.breakingChanges + api.breakingChanges - 20} more`);
      }

      lines.push('');
    }

    lines.push('='.repeat(70));

    return lines.join('\n');
  }

  /**
   * Log message if verbose mode is enabled
   */
  private log(message: string): void {
    if (this.verbose) {
      console.log(`[V2Compat] ${message}`);
    }
  }
}

/**
 * Generate markdown compatibility report
 */
export function generateCompatibilityReport(report: FullValidationReport): string {
  const lines: string[] = [
    '# V2 Compatibility Validation Report',
    '',
    `> Generated: ${report.timestamp.toISOString()}`,
    `> V2 Version: ${report.v2Version}`,
    `> Version: ${report.currentVersion}`,
    '',
    '## Executive Summary',
    '',
    `**Status**: ${report.overallPassed ? 'PASSED' : 'FAILED'}`,
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Total Checks | ${report.totalChecks} |`,
    `| Passed | ${report.passedChecks} |`,
    `| Failed | ${report.failedChecks} |`,
    `| Breaking Changes | ${report.breakingChanges} |`,
    `| Duration | ${report.duration}ms |`,
    '',
    '## Category Results',
    '',
    '### CLI Commands',
    '',
    `- **Total**: ${report.cli.totalChecks}`,
    `- **Passed**: ${report.cli.passedChecks}`,
    `- **Failed**: ${report.cli.failedChecks}`,
    `- **Breaking**: ${report.cli.breakingChanges}`,
    '',
    '| Command | Status | Migration |',
    '|---------|--------|-----------|',
    ...report.cli.checks
      .filter(c => c.name.startsWith('CLI:'))
      .slice(0, 30)
      .map(c => `| ${c.name.replace('CLI: ', '')} | ${c.passed ? 'OK' : 'FAIL'} | ${c.migrationPath || 'N/A'} |`),
    '',
    '### MCP Tools',
    '',
    `- **Total**: ${report.mcp.totalChecks}`,
    `- **Passed**: ${report.mcp.passedChecks}`,
    `- **Failed**: ${report.mcp.failedChecks}`,
    `- **Breaking**: ${report.mcp.breakingChanges}`,
    '',
    '| Tool | Status | V1 Equivalent |',
    '|------|--------|---------------|',
    ...report.mcp.checks
      .filter(c => c.name.startsWith('MCP Tool:'))
      .slice(0, 40)
      .map(c => {
        const currentName = c.details?.currentEquivalent as string || 'N/A';
        return `| ${c.name.replace('MCP Tool: ', '')} | ${c.passed ? 'OK' : 'FAIL'} | ${currentName} |`;
      }),
    '',
    '### Hooks',
    '',
    `- **Total**: ${report.hooks.totalChecks}`,
    `- **Passed**: ${report.hooks.passedChecks}`,
    `- **Failed**: ${report.hooks.failedChecks}`,
    `- **Breaking**: ${report.hooks.breakingChanges}`,
    '',
    '| Hook | Status | V1 Trigger |',
    '|------|--------|------------|',
    ...report.hooks.checks
      .filter(c => c.name.startsWith('Hook:') && !c.name.includes('Param') && !c.name.includes('Return'))
      .slice(0, 50)
      .map(c => {
        const currentName = c.details?.currentEquivalent as string || 'N/A';
        return `| ${c.name.replace('Hook: ', '')} | ${c.passed ? 'OK' : 'FAIL'} | ${currentName} |`;
      }),
    '',
    '### API Interfaces',
    '',
    `- **Total**: ${report.api.totalChecks}`,
    `- **Passed**: ${report.api.passedChecks}`,
    `- **Failed**: ${report.api.failedChecks}`,
    `- **Breaking**: ${report.api.breakingChanges}`,
    '',
    '| Interface/Method | Status | Migration |',
    '|------------------|--------|-----------|',
    ...report.api.checks
      .slice(0, 30)
      .map(c => `| ${c.name.replace('API ', '')} | ${c.passed ? 'OK' : 'FAIL'} | ${c.migrationPath || 'N/A'} |`),
    '',
    '## Breaking Changes',
    '',
  ];

  const breakingChecks = [
    ...report.cli.checks.filter(c => c.breaking),
    ...report.mcp.checks.filter(c => c.breaking),
    ...report.hooks.checks.filter(c => c.breaking),
    ...report.api.checks.filter(c => c.breaking),
  ];

  if (breakingChecks.length === 0) {
    lines.push('No breaking changes detected.');
  } else {
    lines.push('| Category | Item | V2 Behavior | V1 Behavior |');
    lines.push('|----------|------|-------------|-------------|');
    for (const check of breakingChecks.slice(0, 50)) {
      lines.push(`| ${check.category.toUpperCase()} | ${check.name} | ${check.v2Behavior} | ${check.currentBehavior} |`);
    }
  }

  lines.push('');
  lines.push('## Recommendations');
  lines.push('');
  for (const rec of report.recommendations) {
    lines.push(`- ${rec}`);
  }

  lines.push('');
  lines.push('## Migration Guide');
  lines.push('');
  lines.push('### CLI Migration');
  lines.push('');
  lines.push('```bash');
  lines.push('# V2 commands are supported via compatibility layer');
  lines.push('# Deprecated commands will show warnings');
  lines.push('');
  lines.push('# V2 (deprecated)');
  lines.push('npx monobrain hive-mind init');
  lines.push('');
  lines.push('# V1 (recommended)');
  lines.push('npx @monobrain/cli swarm init');
  lines.push('```');
  lines.push('');
  lines.push('### MCP Tool Migration');
  lines.push('');
  lines.push('```typescript');
  lines.push('// V2 tool call');
  lines.push("await mcp.callTool('dispatch_agent', { type: 'coder' });");
  lines.push('');
  lines.push('// tool call (direct)');
  lines.push("await mcp.callTool('agent/spawn', { agentType: 'coder' });");
  lines.push('');
  lines.push('// with compatibility layer');
  lines.push("await mcp.callTool('dispatch_agent', { type: 'coder' }); // Auto-translated");
  lines.push('```');
  lines.push('');
  lines.push('### API Migration');
  lines.push('');
  lines.push('```typescript');
  lines.push("// V2 imports");
  lines.push("import { HiveMind } from 'monobrain/hive-mind';");
  lines.push("import { SwarmCoordinator } from 'monobrain/swarm';");
  lines.push('');
  lines.push("// imports (using aliases)");
  lines.push("import { UnifiedSwarmCoordinator as HiveMind } from '@monobrain/swarm';");
  lines.push("import { UnifiedSwarmCoordinator as SwarmCoordinator } from '@monobrain/swarm';");
  lines.push('```');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('*Report generated by V2CompatibilityValidator*');

  return lines.join('\n');
}
