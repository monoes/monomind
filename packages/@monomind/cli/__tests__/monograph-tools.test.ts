import { vi } from 'vitest';

vi.mock('@monomind/monograph', () => ({
  ftsSearch: vi.fn().mockReturnValue([{ id: 'n1', name: 'Foo', label: 'Class', normLabel: 'foo', filePath: 'src/foo.ts', rank: 1.0 }]),
  countNodes: vi.fn().mockReturnValue(100),
  countEdges: vi.fn().mockReturnValue(200),
  openDb: vi.fn().mockReturnValue({
    prepare: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]), get: vi.fn().mockReturnValue(null) }),
    close: vi.fn(),
  }),
  closeDb: vi.fn(),
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
