import { vi } from 'vitest';

vi.mock('@monoes/monograph', () => ({
  ftsSearch: vi.fn().mockReturnValue([{ id: 'n1', name: 'Foo', label: 'Class', normLabel: 'foo', filePath: 'src/foo.ts', rank: 1.0 }]),
  countNodes: vi.fn().mockReturnValue(100),
  countEdges: vi.fn().mockReturnValue(200),
  openDb: vi.fn().mockReturnValue({
    prepare: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]), get: vi.fn().mockReturnValue(null) }),
    close: vi.fn(),
  }),
  closeDb: vi.fn(),
  SYMBOL_NODE_LABELS: new Set([
    'Function', 'Class', 'Method', 'Interface', 'Variable', 'Struct', 'Enum',
    'Macro', 'Typedef', 'Union', 'Namespace', 'Trait', 'Impl', 'TypeAlias',
    'Const', 'Static', 'Property', 'Record', 'Delegate', 'Annotation',
    'Constructor', 'Template', 'Module',
  ]),
}));

describe('monograph tools are importable', () => {
  it('monographTools array is defined', async () => {
    const { monographTools } = await import('../src/mcp-tools/monograph-tools.js');
    expect(Array.isArray(monographTools)).toBe(true);
    expect(monographTools.length).toBeGreaterThan(10);
  });

  it('each tool has name, description, inputSchema, handler', async () => {
    const { monographTools } = await import('../src/mcp-tools/monograph-tools.js');
    for (const tool of monographTools) {
      expect(tool.name).toMatch(/^monograph_/);
      expect(typeof tool.description).toBe('string');
      expect(tool.inputSchema).toBeDefined();
      expect(typeof tool.handler).toBe('function');
    }
  });
});

describe('preferSymbolHits (issue #38: doc mentions outranking real code targets)', () => {
  const SYMBOL_LABELS = new Set(['Function', 'Class', 'Method']);

  it('filters out doc/concept hits when at least one code-symbol hit is present', async () => {
    const { preferSymbolHits } = await import('../src/mcp-tools/monograph-tools.js');
    const hits = [
      { id: 'doc1', label: 'Document', name: 'GRAPH_REPORT.md chunk mentioning FAST_RETRY_MAX' },
      { id: 'fn1', label: 'Function', name: 'spawnAgent' },
      { id: 'concept1', label: 'Concept', name: 'retry' },
    ];
    const result = preferSymbolHits(hits, SYMBOL_LABELS);
    expect(result).toEqual([{ id: 'fn1', label: 'Function', name: 'spawnAgent' }]);
  });

  it('falls back to the full hit list when there are no code-symbol hits at all', async () => {
    const { preferSymbolHits } = await import('../src/mcp-tools/monograph-tools.js');
    const hits = [
      { id: 'doc1', label: 'Document', name: 'doc chunk' },
      { id: 'concept1', label: 'Concept', name: 'concept' },
    ];
    const result = preferSymbolHits(hits, SYMBOL_LABELS);
    expect(result).toEqual(hits);
  });

  it('keeps only symbol hits, preserving their relative order, when mixed', async () => {
    const { preferSymbolHits } = await import('../src/mcp-tools/monograph-tools.js');
    const hits = [
      { id: 'cls1', label: 'Class', name: 'AgentSpawner' },
      { id: 'doc1', label: 'Document', name: 'doc chunk' },
      { id: 'meth1', label: 'Method', name: 'retry' },
    ];
    const result = preferSymbolHits(hits, SYMBOL_LABELS);
    expect(result.map(h => h.id)).toEqual(['cls1', 'meth1']);
  });
});
