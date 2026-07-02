/**
 * CLI Commands Tests
 * Tests for agent, swarm, memory, and config commands
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { agentCommand } from '../src/commands/agent.js';
import { swarmCommand } from '../src/commands/swarm.js';
import { memoryCommand } from '../src/commands/memory.js';
import { configCommand } from '../src/commands/config.js';
import { configManager } from '../src/services/config-file-manager.js';
import type { CommandContext } from '../src/types.js';

// Mock memory-initializer (store/retrieve/delete/search/list commands use direct imports, not MCP)
vi.mock('../src/memory/memory-initializer.js', () => ({
  storeEntry: vi.fn(async (options: Record<string, unknown>) => ({
    success: true,
    id: 'mock-id-' + options.key,
    embedding: { dimensions: 384, model: 'mock' }
  })),
  getEntry: vi.fn(async (options: Record<string, unknown>) => ({
    success: true,
    found: true,
    entry: {
      id: 'mock-id-' + options.key,
      key: options.key,
      namespace: options.namespace ?? 'default',
      content: 'mock-value-for-' + options.key,
      accessCount: 5,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      hasEmbedding: false,
      tags: []
    }
  })),
  deleteEntry: vi.fn(async (options: Record<string, unknown>) => ({
    success: true,
    deleted: true,
    key: options.key,
    namespace: options.namespace ?? 'default',
    remainingEntries: 41
  })),
  searchEntries: vi.fn(async (options: Record<string, unknown>) => ({
    success: true,
    results: [
      { id: '1', key: 'result-1', content: 'auth pattern 1', score: 0.95, namespace: 'default' },
      { id: '2', key: 'result-2', content: 'auth pattern 2', score: 0.85, namespace: 'default' }
    ],
    searchTime: 0.5
  })),
  listEntries: vi.fn(async (options: Record<string, unknown>) => ({
    success: true,
    entries: [
      { id: '1', key: 'entry-1', namespace: 'default', size: 100, accessCount: 10, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z', hasEmbedding: false },
      { id: '2', key: 'entry-2', namespace: 'default', size: 200, accessCount: 5, createdAt: '2024-01-01T00:01:00Z', updatedAt: '2024-01-01T00:01:00Z', hasEmbedding: true }
    ],
    total: 2
  })),
  getHNSWIndex: vi.fn(async () => null),
  getHNSWStatus: vi.fn(() => ({ entryCount: 0, dimensions: 384 }))
}));

// Mock MCP client
vi.mock('../src/mcp-client.js', () => ({
  callMCPTool: vi.fn(async (toolName: string, input: Record<string, unknown>) => {
    // Mock responses for different tools (names must match production callMCPTool() calls)
    if (toolName === 'agent_spawn') {
      return {
        agentId: input.id || 'mock-agent-123',
        agentType: input.agentType,
        status: 'active',
        createdAt: new Date().toISOString()
      };
    }

    if (toolName === 'agent_list') {
      return {
        agents: [
          { id: 'agent-1', agentType: 'coder', status: 'active', createdAt: '2024-01-01T00:00:00Z' },
          { id: 'agent-2', agentType: 'tester', status: 'idle', createdAt: '2024-01-01T00:01:00Z' }
        ],
        total: 2
      };
    }

    if (toolName === 'agent_status') {
      return {
        id: input.agentId,
        agentType: 'coder',
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
        lastActivityAt: new Date().toISOString(),
        metrics: {
          tasksCompleted: 10,
          tasksInProgress: 2,
          tasksFailed: 1,
          averageExecutionTime: 1500,
          uptime: 3600000
        }
      };
    }

    if (toolName === 'agent_terminate') {
      return {
        agentId: input.agentId,
        terminated: true,
        terminatedAt: new Date().toISOString()
      };
    }

    if (toolName === 'swarm_init') {
      return {
        swarmId: 'swarm-mock-123',
        topology: input.topology,
        initializedAt: new Date().toISOString(),
        config: {
          topology: input.topology,
          maxAgents: input.maxAgents || 15,
          currentAgents: 0,
          autoScaling: true
        }
      };
    }

    if (toolName === 'memory_stats') {
      // Return raw MCP format that the command expects and transforms
      return {
        totalEntries: 42,
        totalSize: '1.2 MB',
        version: '3.0.0-alpha',
        backend: 'hybrid',
        location: './data/memory',
        oldestEntry: '2024-01-01T00:00:00Z',
        newestEntry: '2024-01-07T00:00:00Z'
      };
    }

    return {};
  }),
  MCPClientError: class MCPClientError extends Error {
    constructor(message: string, public toolName: string, public cause?: Error) {
      super(message);
      this.name = 'MCPClientError';
    }
  }
}));

// Mock output
vi.mock('../src/output.js', () => ({
  output: {
    writeln: vi.fn(),
    printInfo: vi.fn(),
    printSuccess: vi.fn(),
    printError: vi.fn(),
    printWarning: vi.fn(),
    printTable: vi.fn(),
    printJson: vi.fn(),
    printList: vi.fn(),
    printBox: vi.fn(),
    createSpinner: vi.fn(() => ({
      start: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
      stop: vi.fn()
    })),
    highlight: (str: string) => str,
    bold: (str: string) => str,
    dim: (str: string) => str,
    success: (str: string) => str,
    error: (str: string) => str,
    warning: (str: string) => str,
    info: (str: string) => str,
    progressBar: () => '[=====>    ]',
    setColorEnabled: vi.fn()
  }
}));

// Mock prompts (always return default values for non-interactive tests)
vi.mock('../src/prompt.js', () => ({
  select: vi.fn(async (opts) => opts.default || opts.options[0]?.value),
  confirm: vi.fn(async (opts) => opts.default ?? false),
  input: vi.fn(async (opts) => opts.default || 'test-input'),
  multiSelect: vi.fn(async (opts) => opts.default || [])
}));

describe('Agent Commands', () => {
  let ctx: CommandContext;

  beforeEach(() => {
    ctx = {
      args: [],
      flags: { _: [] },
      cwd: '/test',
      interactive: false
    };
  });

  describe('agent spawn', () => {
    it('should spawn agent with type flag', async () => {
      const spawnCmd = agentCommand.subcommands?.find(c => c.name === 'spawn');
      expect(spawnCmd).toBeDefined();

      ctx.flags = { type: 'coder', _: [] };
      const result = await spawnCmd!.action!(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('agentId');
      expect(result.data).toHaveProperty('agentType', 'coder');
    });

    it('should spawn agent with custom name', async () => {
      const spawnCmd = agentCommand.subcommands?.find(c => c.name === 'spawn');

      ctx.flags = { type: 'tester', name: 'my-tester', _: [] };
      const result = await spawnCmd!.action!(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('agentId', 'my-tester');
    });

    it('should fail without agent type in non-interactive mode', async () => {
      const spawnCmd = agentCommand.subcommands?.find(c => c.name === 'spawn');

      ctx.flags = { _: [] };
      const result = await spawnCmd!.action!(ctx);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('should pass provider and model options', async () => {
      const spawnCmd = agentCommand.subcommands?.find(c => c.name === 'spawn');

      ctx.flags = {
        type: 'coder',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        _: []
      };
      const result = await spawnCmd!.action!(ctx);

      expect(result.success).toBe(true);
    });

    it('should handle task option', async () => {
      const spawnCmd = agentCommand.subcommands?.find(c => c.name === 'spawn');

      ctx.flags = {
        type: 'researcher',
        task: 'Research React patterns',
        _: []
      };
      const result = await spawnCmd!.action!(ctx);

      expect(result.success).toBe(true);
    });
  });

  describe('agent list', () => {
    it('should list all agents', async () => {
      const listCmd = agentCommand.subcommands?.find(c => c.name === 'list');
      expect(listCmd).toBeDefined();

      const result = await listCmd!.action!(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('agents');
      expect(result.data).toHaveProperty('total', 2);
    });

    it('should filter by agent type', async () => {
      const listCmd = agentCommand.subcommands?.find(c => c.name === 'list');

      ctx.flags = { type: 'coder', _: [] };
      const result = await listCmd!.action!(ctx);

      expect(result.success).toBe(true);
    });

    it('should filter by status', async () => {
      const listCmd = agentCommand.subcommands?.find(c => c.name === 'list');

      ctx.flags = { status: 'active', _: [] };
      const result = await listCmd!.action!(ctx);

      expect(result.success).toBe(true);
    });

    it('should include inactive agents with --all flag', async () => {
      const listCmd = agentCommand.subcommands?.find(c => c.name === 'list');

      ctx.flags = { all: true, _: [] };
      const result = await listCmd!.action!(ctx);

      expect(result.success).toBe(true);
    });
  });

  describe('agent status', () => {
    it('should show agent status', async () => {
      const statusCmd = agentCommand.subcommands?.find(c => c.name === 'status');
      expect(statusCmd).toBeDefined();

      ctx.args = ['agent-123'];
      const result = await statusCmd!.action!(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('id');
      expect(result.data).toHaveProperty('status');
      expect(result.data).toHaveProperty('metrics');
    });

    it('should fail without agent ID', async () => {
      const statusCmd = agentCommand.subcommands?.find(c => c.name === 'status');

      ctx.args = [];
      ctx.interactive = false;
      const result = await statusCmd!.action!(ctx);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });
  });

  describe('agent stop', () => {
    it('should stop agent', async () => {
      const stopCmd = agentCommand.subcommands?.find(c => c.name === 'stop');
      expect(stopCmd).toBeDefined();

      ctx.args = ['agent-123'];
      ctx.flags = { force: true, _: [] };
      const result = await stopCmd!.action!(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('agentId', 'agent-123');
      expect(result.data).toHaveProperty('terminated', true);
    });

    it('should fail without agent ID', async () => {
      const stopCmd = agentCommand.subcommands?.find(c => c.name === 'stop');

      ctx.args = [];
      const result = await stopCmd!.action!(ctx);

      expect(result.success).toBe(false);
    });
  });

  describe('agent metrics', () => {
    it('should show agent metrics', async () => {
      const metricsCmd = agentCommand.subcommands?.find(c => c.name === 'metrics');
      expect(metricsCmd).toBeDefined();

      const result = await metricsCmd!.action!(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('summary');
      expect(result.data).toHaveProperty('performance');
    });

    it('should accept period option', async () => {
      const metricsCmd = agentCommand.subcommands?.find(c => c.name === 'metrics');

      ctx.flags = { period: '7d', _: [] };
      const result = await metricsCmd!.action!(ctx);

      expect(result.success).toBe(true);
    });
  });
});

describe('Swarm Commands', () => {
  let ctx: CommandContext;

  beforeEach(() => {
    ctx = {
      args: [],
      flags: { _: [] },
      cwd: '/test',
      interactive: false
    };
  });

  describe('swarm init', () => {
    it('should initialize swarm with default topology', async () => {
      const initCmd = swarmCommand.subcommands?.find(c => c.name === 'init');
      expect(initCmd).toBeDefined();

      const result = await initCmd!.action!(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('swarmId');
      expect(result.data).toHaveProperty('topology');
    });

    it('should initialize swarm with custom topology', async () => {
      const initCmd = swarmCommand.subcommands?.find(c => c.name === 'init');

      ctx.flags = { topology: 'mesh', _: [] };
      const result = await initCmd!.action!(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('topology', 'mesh');
    });

    it('should enable V1 mode', async () => {
      const initCmd = swarmCommand.subcommands?.find(c => c.name === 'init');

      ctx.flags = { v1Mode: true, _: [] };
      const result = await initCmd!.action!(ctx);

      expect(result.success).toBe(true);
    });

    it('should set max agents', async () => {
      const initCmd = swarmCommand.subcommands?.find(c => c.name === 'init');

      ctx.flags = { 'max-agents': 20, _: [] };
      const result = await initCmd!.action!(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.config).toHaveProperty('maxAgents', 20);
    });
  });

  describe('swarm start', () => {
    it('should start swarm with objective', async () => {
      const startCmd = swarmCommand.subcommands?.find(c => c.name === 'start');
      expect(startCmd).toBeDefined();

      ctx.flags = { objective: 'Build REST API', _: [] };
      const result = await startCmd!.action!(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('objective', 'Build REST API');
    });

    it('should fail without objective', async () => {
      const startCmd = swarmCommand.subcommands?.find(c => c.name === 'start');

      const result = await startCmd!.action!(ctx);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('should accept strategy option', async () => {
      const startCmd = swarmCommand.subcommands?.find(c => c.name === 'start');

      ctx.flags = { objective: 'Test project', strategy: 'testing', _: [] };
      const result = await startCmd!.action!(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('strategy', 'testing');
    });
  });

  describe('swarm status', () => {
    it('should show swarm status', async () => {
      const statusCmd = swarmCommand.subcommands?.find(c => c.name === 'status');
      expect(statusCmd).toBeDefined();

      const result = await statusCmd!.action!(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('agents');
      expect(result.data).toHaveProperty('tasks');
      expect(result.data).toHaveProperty('metrics');
    });
  });

  describe('swarm stop', () => {
    it('should stop swarm', async () => {
      const stopCmd = swarmCommand.subcommands?.find(c => c.name === 'stop');
      expect(stopCmd).toBeDefined();

      ctx.args = ['swarm-123'];
      ctx.flags = { force: true, _: [] };
      const result = await stopCmd!.action!(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('swarmId', 'swarm-123');
      expect(result.data).toHaveProperty('stopped', true);
    });

    it('should fail without swarm ID', async () => {
      const stopCmd = swarmCommand.subcommands?.find(c => c.name === 'stop');

      const result = await stopCmd!.action!(ctx);

      expect(result.success).toBe(false);
    });
  });

  describe('swarm scale', () => {
    it.skip('should scale swarm', async () => { // Skip: swarm_scale MCP tool not available in lean build
      const scaleCmd = swarmCommand.subcommands?.find(c => c.name === 'scale');
      expect(scaleCmd).toBeDefined();

      ctx.args = ['swarm-123'];
      ctx.flags = { agents: 20, _: [] };
      const result = await scaleCmd!.action!(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('agents', 20);
    });

    it('should fail without target agent count', async () => {
      const scaleCmd = swarmCommand.subcommands?.find(c => c.name === 'scale');

      ctx.args = ['swarm-123'];
      const result = await scaleCmd!.action!(ctx);

      expect(result.success).toBe(false);
    });
  });

  describe('swarm coordinate', () => {
    it('should show V1 coordination structure', async () => {
      const coordinateCmd = swarmCommand.subcommands?.find(c => c.name === 'coordinate');
      expect(coordinateCmd).toBeDefined();

      const result = await coordinateCmd!.action!(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('agents');
      expect(result.data?.agents).toHaveLength(15);
    });
  });
});

describe('Memory Commands', () => {
  let ctx: CommandContext;

  beforeEach(() => {
    ctx = {
      args: [],
      flags: { _: [] },
      cwd: '/test',
      interactive: false
    };
  });

  describe('memory store', () => {
    it('should store data', async () => {
      const storeCmd = memoryCommand.subcommands?.find(c => c.name === 'store');
      expect(storeCmd).toBeDefined();

      ctx.flags = { key: 'test-key', value: 'test-value', _: [] };
      const result = await storeCmd!.action!(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('key', 'test-key');
    });

    it('should fail without key', async () => {
      const storeCmd = memoryCommand.subcommands?.find(c => c.name === 'store');

      ctx.flags = { value: 'test-value', _: [] };
      const result = await storeCmd!.action!(ctx);

      expect(result.success).toBe(false);
    });
  });

  describe('memory retrieve', () => {
    it('should retrieve data', async () => {
      const retrieveCmd = memoryCommand.subcommands?.find(c => c.name === 'retrieve');
      expect(retrieveCmd).toBeDefined();

      ctx.args = ['test-key'];
      const result = await retrieveCmd!.action!(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('key', 'test-key');
    });
  });

  describe('memory search', () => {
    it('should search memory', async () => {
      const searchCmd = memoryCommand.subcommands?.find(c => c.name === 'search');
      expect(searchCmd).toBeDefined();

      ctx.flags = { query: 'authentication', _: [] };
      const result = await searchCmd!.action!(ctx);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('should fail without query', async () => {
      const searchCmd = memoryCommand.subcommands?.find(c => c.name === 'search');

      const result = await searchCmd!.action!(ctx);

      expect(result.success).toBe(false);
    });
  });

  describe('memory list', () => {
    it('should list memory entries', async () => {
      const listCmd = memoryCommand.subcommands?.find(c => c.name === 'list');
      expect(listCmd).toBeDefined();

      const result = await listCmd!.action!(ctx);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
    });
  });

  describe('memory delete', () => {
    it('should delete entry', async () => {
      const deleteCmd = memoryCommand.subcommands?.find(c => c.name === 'delete');
      expect(deleteCmd).toBeDefined();

      ctx.args = ['test-key'];
      ctx.flags = { force: true, _: [] };
      const result = await deleteCmd!.action!(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('deleted', true);
    });
  });

  describe('memory stats', () => {
    it('should show memory statistics', async () => {
      const statsCmd = memoryCommand.subcommands?.find(c => c.name === 'stats');
      expect(statsCmd).toBeDefined();

      const result = await statsCmd!.action!(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('entries');
      expect(result.data).toHaveProperty('storage');
      expect(result.data).toHaveProperty('backend');
      expect(result.data).toHaveProperty('version');
    });
  });

  describe('memory configure', () => {
    let tmpCwd: string;

    beforeEach(() => {
      // configManager.set() writes to <cwd>/.monomind/config.json — needs a real writable dir
      tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-configure-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpCwd, { recursive: true, force: true });
      // configManager is a module-level singleton that caches configPath/config
      // internally — reset it so later tests don't inherit this tmpdir's real path.
      (configManager as unknown as { configPath: string | null; config: unknown | null }).configPath = null;
      (configManager as unknown as { configPath: string | null; config: unknown | null }).config = null;
    });

    it('should configure memory backend', async () => {
      const configureCmd = memoryCommand.subcommands?.find(c => c.name === 'configure');
      expect(configureCmd).toBeDefined();

      ctx.cwd = tmpCwd;
      ctx.flags = { backend: 'lancedb', _: [] };
      const result = await configureCmd!.action!(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('backend', 'lancedb');
    });
  });
});

describe('Config Commands', () => {
  let ctx: CommandContext;

  beforeEach(() => {
    ctx = {
      args: [],
      flags: { _: [] },
      cwd: '/test',
      interactive: false
    };
  });

  describe('config init', () => {
    it('should initialize configuration', async () => {
      const initCmd = configCommand.subcommands?.find(c => c.name === 'init');
      expect(initCmd).toBeDefined();

      const result = await initCmd!.action!(ctx);

      // #1425: config init is not yet implemented
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('should initialize with V1 mode', async () => {
      const initCmd = configCommand.subcommands?.find(c => c.name === 'init');

      ctx.flags = { v1: true, _: [] };
      const result = await initCmd!.action!(ctx);

      // #1425: config init is not yet implemented
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });
  });

  describe('config get', () => {
    it('should get configuration value', async () => {
      const getCmd = configCommand.subcommands?.find(c => c.name === 'get');
      expect(getCmd).toBeDefined();

      ctx.args = ['swarm.topology'];
      const result = await getCmd!.action!(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('key');
      expect(result.data).toHaveProperty('value');
    });

    it('should show all config when no key provided', async () => {
      const getCmd = configCommand.subcommands?.find(c => c.name === 'get');

      const result = await getCmd!.action!(ctx);

      expect(result.success).toBe(true);
    });
  });

  describe('config set', () => {
    it('should set configuration value', async () => {
      const setCmd = configCommand.subcommands?.find(c => c.name === 'set');
      expect(setCmd).toBeDefined();

      ctx.flags = { key: 'swarm.maxAgents', value: '20', _: [] };
      const result = await setCmd!.action!(ctx);

      // #1425: config set is not yet implemented
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('should fail without key and value', async () => {
      const setCmd = configCommand.subcommands?.find(c => c.name === 'set');

      const result = await setCmd!.action!(ctx);

      expect(result.success).toBe(false);
    });
  });

  describe('config providers', () => {
    it('should list providers', async () => {
      const providersCmd = configCommand.subcommands?.find(c => c.name === 'providers');
      expect(providersCmd).toBeDefined();

      const result = await providersCmd!.action!(ctx);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
    });
  });

  describe('config reset', () => {
    it('should reset configuration', async () => {
      const resetCmd = configCommand.subcommands?.find(c => c.name === 'reset');
      expect(resetCmd).toBeDefined();

      ctx.flags = { force: true, _: [] };
      const result = await resetCmd!.action!(ctx);

      // #1425: config reset is not yet implemented
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });
  });

  describe('config export', () => {
    it('should export configuration', async () => {
      const exportCmd = configCommand.subcommands?.find(c => c.name === 'export');
      expect(exportCmd).toBeDefined();

      const result = await exportCmd!.action!(ctx);

      // #1425: config export is not yet implemented
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });
  });

  describe('config import', () => {
    it('should import configuration', async () => {
      const importCmd = configCommand.subcommands?.find(c => c.name === 'import');
      expect(importCmd).toBeDefined();

      ctx.flags = { file: './config.json', _: [] };
      const result = await importCmd!.action!(ctx);

      // #1425: config import is not yet implemented
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('should fail without file path', async () => {
      const importCmd = configCommand.subcommands?.find(c => c.name === 'import');

      const result = await importCmd!.action!(ctx);

      expect(result.success).toBe(false);
    });
  });
});
