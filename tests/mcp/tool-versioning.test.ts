/**
 * Tests for Tool Versioning (Task 31).
 *
 * Uses vitest globals (describe, it, expect, vi, beforeEach).
 * Run: npx vitest run tests/mcp/tool-versioning.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  VersionedMCPTool,
  ToolVersionEntry,
} from '../../packages/@monobrain/shared/src/types/tool-version.js';

// ---------- Mock fs so no real I/O occurs ----------

vi.mock('fs', () => ({
  appendFileSync: vi.fn(),
  readFileSync: vi.fn(() => ''),
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import * as fs from 'fs';
import { ToolRegistry } from '../../packages/@monobrain/cli/src/mcp/tool-registry.js';
import { DeprecationInjector } from '../../packages/@monobrain/cli/src/mcp/deprecation-injector.js';

// ---------- Helpers ----------

function makeTool(overrides: Partial<VersionedMCPTool> = {}): VersionedMCPTool {
  return {
    toolName: 'memory_search',
    version: '1.0.0',
    deprecated: false,
    addedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------- ToolRegistry ----------

describe('ToolRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  describe('register()', () => {
    it('stores a tool and makes it retrievable via getVersion()', () => {
      const reg = new ToolRegistry('/tmp/test-versions.jsonl');
      const tool = makeTool();
      reg.register(tool);

      const result = reg.getVersion('memory_search');
      expect(result).not.toBeNull();
      expect(result!.toolName).toBe('memory_search');
      expect(result!.version).toBe('1.0.0');
    });

    it('appends a JSONL entry to disk on register', () => {
      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      const reg = new ToolRegistry('/tmp/test-versions.jsonl');
      reg.register(makeTool());

      expect(fs.appendFileSync).toHaveBeenCalled();
      const written = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      expect(written).toContain('"memory_search"');
      expect(written).toContain('"_type":"tool"');
      expect(written).toContain('"_type":"history"');
    });

    it('records an "added" history entry for new tools', () => {
      const reg = new ToolRegistry('/tmp/test-versions.jsonl');
      reg.register(makeTool());

      const history = reg.getHistory('memory_search');
      expect(history).toHaveLength(1);
      expect(history[0].changeType).toBe('added');
    });

    it('records an "updated" history entry when re-registering', () => {
      const reg = new ToolRegistry('/tmp/test-versions.jsonl');
      reg.register(makeTool());
      reg.register(makeTool({ version: '1.1.0' }));

      const history = reg.getHistory('memory_search');
      expect(history).toHaveLength(2);
      expect(history[0].changeType).toBe('added');
      expect(history[1].changeType).toBe('updated');
    });
  });

  describe('getVersion()', () => {
    it('returns null for unknown tools', () => {
      const reg = new ToolRegistry('/tmp/test-versions.jsonl');
      expect(reg.getVersion('nonexistent_tool')).toBeNull();
    });

    it('returns the latest registered version', () => {
      const reg = new ToolRegistry('/tmp/test-versions.jsonl');
      reg.register(makeTool({ version: '1.0.0' }));
      reg.register(makeTool({ version: '2.0.0' }));

      const result = reg.getVersion('memory_search');
      expect(result!.version).toBe('2.0.0');
    });
  });

  describe('deprecate()', () => {
    it('marks a tool as deprecated with message and successor', () => {
      const reg = new ToolRegistry('/tmp/test-versions.jsonl');
      reg.register(makeTool());
      reg.deprecate('memory_search', 'Use v2 API', 'memory_search_v2');

      const tool = reg.getVersion('memory_search');
      expect(tool!.deprecated).toBe(true);
      expect(tool!.deprecationMessage).toBe('Use v2 API');
      expect(tool!.successor).toBe('memory_search_v2');
      expect(tool!.deprecatedAt).toBeTruthy();
    });

    it('records a "deprecated" history entry', () => {
      const reg = new ToolRegistry('/tmp/test-versions.jsonl');
      reg.register(makeTool());
      reg.deprecate('memory_search', 'Obsolete');

      const history = reg.getHistory('memory_search');
      const deprecatedEntry = history.find((e) => e.changeType === 'deprecated');
      expect(deprecatedEntry).toBeDefined();
      expect(deprecatedEntry!.description).toBe('Obsolete');
    });

    it('throws when deprecating an unregistered tool', () => {
      const reg = new ToolRegistry('/tmp/test-versions.jsonl');
      expect(() => reg.deprecate('ghost', 'Gone')).toThrow(
        'Tool "ghost" not found in registry',
      );
    });
  });

  describe('listDeprecated()', () => {
    it('returns only deprecated tools', () => {
      const reg = new ToolRegistry('/tmp/test-versions.jsonl');
      reg.register(makeTool({ toolName: 'tool_a' }));
      reg.register(makeTool({ toolName: 'tool_b' }));
      reg.register(makeTool({ toolName: 'tool_c' }));

      reg.deprecate('tool_a', 'Old');
      reg.deprecate('tool_c', 'Replaced');

      const deprecated = reg.listDeprecated();
      expect(deprecated).toHaveLength(2);
      const names = deprecated.map((t) => t.toolName).sort();
      expect(names).toEqual(['tool_a', 'tool_c']);
    });

    it('returns empty array when nothing is deprecated', () => {
      const reg = new ToolRegistry('/tmp/test-versions.jsonl');
      reg.register(makeTool());
      expect(reg.listDeprecated()).toEqual([]);
    });
  });

  describe('getImpactedAgents()', () => {
    it('returns agent slugs that reference the tool', () => {
      // Mock filesystem to simulate agent markdown files
      (fs.readdirSync as ReturnType<typeof vi.fn>).mockImplementation((dir: string) => {
        if (dir === '/agents') return ['coder.md', 'tester.md'];
        return [];
      });
      (fs.statSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => ({
        isDirectory: () => false,
        isFile: () => path.endsWith('.md'),
      }));
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
        if (path.includes('coder.md')) {
          return 'tools:\n  - memory_search\n  - swarm_init';
        }
        if (path.includes('tester.md')) {
          return 'tools:\n  - test_runner';
        }
        return '';
      });

      const reg = new ToolRegistry('/tmp/test-versions.jsonl');
      reg.register(makeTool());

      const impacted = reg.getImpactedAgents('memory_search', '/agents');
      expect(impacted).toEqual(['coder']);
    });

    it('returns empty array when no agents reference the tool', () => {
      (fs.readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const reg = new ToolRegistry('/tmp/test-versions.jsonl');
      reg.register(makeTool());

      const impacted = reg.getImpactedAgents('memory_search', '/no-agents');
      expect(impacted).toEqual([]);
    });
  });

  describe('getHistory()', () => {
    it('returns full history when no toolName given', () => {
      const reg = new ToolRegistry('/tmp/test-versions.jsonl');
      reg.register(makeTool({ toolName: 'a' }));
      reg.register(makeTool({ toolName: 'b' }));

      const history = reg.getHistory();
      expect(history).toHaveLength(2);
    });

    it('filters history by tool name', () => {
      const reg = new ToolRegistry('/tmp/test-versions.jsonl');
      reg.register(makeTool({ toolName: 'a' }));
      reg.register(makeTool({ toolName: 'b' }));

      expect(reg.getHistory('a')).toHaveLength(1);
      expect(reg.getHistory('a')[0].toolName).toBe('a');
    });
  });

  describe('loadFromDisk()', () => {
    it('restores tools and history from JSONL on construction', () => {
      const toolLine = JSON.stringify({
        _type: 'tool',
        toolName: 'restored_tool',
        version: '3.0.0',
        deprecated: false,
        addedAt: '2026-01-01T00:00:00.000Z',
      });
      const histLine = JSON.stringify({
        _type: 'history',
        toolName: 'restored_tool',
        version: '3.0.0',
        changeType: 'added',
        changedAt: '2026-01-01T00:00:00.000Z',
      });

      (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(
        toolLine + '\n' + histLine + '\n',
      );

      const reg = new ToolRegistry('/tmp/test-versions.jsonl');
      const tool = reg.getVersion('restored_tool');
      expect(tool).not.toBeNull();
      expect(tool!.version).toBe('3.0.0');

      const history = reg.getHistory('restored_tool');
      expect(history).toHaveLength(1);
    });
  });
});

// ---------- DeprecationInjector ----------

describe('DeprecationInjector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it('does NOT modify response when tool is not deprecated', () => {
    const reg = new ToolRegistry('/tmp/test-versions.jsonl');
    reg.register(makeTool({ deprecated: false }));

    const injector = new DeprecationInjector(reg);
    const response = { result: 'ok' };
    const result = injector.inject(response, 'memory_search');

    expect(result).toEqual({ result: 'ok' });
    expect(result).not.toHaveProperty('_deprecation');
  });

  it('does NOT modify response when tool is unknown', () => {
    const reg = new ToolRegistry('/tmp/test-versions.jsonl');
    const injector = new DeprecationInjector(reg);
    const response = { data: 42 };
    const result = injector.inject(response, 'unknown_tool');

    expect(result).toEqual({ data: 42 });
  });

  it('adds _deprecation warning when tool is deprecated', () => {
    const reg = new ToolRegistry('/tmp/test-versions.jsonl');
    reg.register(makeTool());
    reg.deprecate('memory_search', 'Use v2 API', 'memory_search_v2');

    const injector = new DeprecationInjector(reg);
    const response = { result: 'ok' };
    const result = injector.inject(response, 'memory_search');

    expect(result).toHaveProperty('_deprecation');
    expect(result._deprecation).toBeDefined();

    const dep = result._deprecation as Record<string, unknown>;
    expect(dep.deprecated).toBe(true);
    expect(dep.successor).toBe('memory_search_v2');
    expect(dep.warning).toContain('[DEPRECATED]');
    expect(dep.warning).toContain('memory_search');
    expect(dep.warning).toContain('Use v2 API');
    expect(dep.warning).toContain('memory_search_v2');
  });

  it('formats warning correctly with message and successor', () => {
    const reg = new ToolRegistry('/tmp/test-versions.jsonl');
    reg.register(makeTool());
    reg.deprecate('memory_search', 'Replaced by v2', 'memory_search_v2');

    const injector = new DeprecationInjector(reg);
    const result = injector.inject({}, 'memory_search');
    const dep = result._deprecation as Record<string, unknown>;

    expect(dep.warning).toBe(
      '[DEPRECATED] Tool "memory_search" is deprecated. Replaced by v2. Use "memory_search_v2" instead.',
    );
  });

  it('formats warning without successor when none provided', () => {
    const reg = new ToolRegistry('/tmp/test-versions.jsonl');
    reg.register(makeTool());
    reg.deprecate('memory_search', 'No longer supported');

    const injector = new DeprecationInjector(reg);
    const result = injector.inject({}, 'memory_search');
    const dep = result._deprecation as Record<string, unknown>;

    expect(dep.warning).toBe(
      '[DEPRECATED] Tool "memory_search" is deprecated. No longer supported.',
    );
    expect(dep.successor).toBeNull();
  });

  it('preserves original response fields alongside deprecation info', () => {
    const reg = new ToolRegistry('/tmp/test-versions.jsonl');
    reg.register(makeTool());
    reg.deprecate('memory_search', 'Old');

    const injector = new DeprecationInjector(reg);
    const original = { data: [1, 2, 3], status: 'success', nested: { a: 1 } };
    const result = injector.inject(original, 'memory_search');

    expect(result.data).toEqual([1, 2, 3]);
    expect(result.status).toBe('success');
    expect(result.nested).toEqual({ a: 1 });
    expect(result._deprecation).toBeDefined();
  });
});
