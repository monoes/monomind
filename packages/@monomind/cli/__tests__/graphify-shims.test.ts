import { vi } from 'vitest';

const createMockHandler = (name: string) => vi.fn().mockResolvedValue({ content: [{ type: 'text', text: `Mock result for ${name}` }] });

vi.mock('../src/mcp-tools/monograph-tools.js', () => ({
  monographTools: [
    { name: 'monograph_build', inputSchema: {}, description: 'mock build', handler: createMockHandler('build') },
    { name: 'monograph_query', inputSchema: {}, description: 'mock query', handler: createMockHandler('query') },
    { name: 'monograph_god_nodes', inputSchema: {}, description: 'mock god_nodes', handler: createMockHandler('god_nodes') },
    { name: 'monograph_get_node', inputSchema: {}, description: 'mock get_node', handler: createMockHandler('get_node') },
    { name: 'monograph_shortest_path', inputSchema: {}, description: 'mock shortest_path', handler: createMockHandler('shortest_path') },
    { name: 'monograph_community', inputSchema: {}, description: 'mock community', handler: createMockHandler('community') },
    { name: 'monograph_stats', inputSchema: {}, description: 'mock stats', handler: createMockHandler('stats') },
    { name: 'monograph_surprises', inputSchema: {}, description: 'mock surprises', handler: createMockHandler('surprises') },
    { name: 'monograph_suggest', inputSchema: {}, description: 'mock suggest', handler: createMockHandler('suggest') },
    { name: 'monograph_visualize', inputSchema: {}, description: 'mock visualize', handler: createMockHandler('visualize') },
    { name: 'monograph_watch', inputSchema: {}, description: 'mock watch', handler: createMockHandler('watch') },
    { name: 'monograph_watch_stop', inputSchema: {}, description: 'mock watch_stop', handler: createMockHandler('watch_stop') },
    { name: 'monograph_report', inputSchema: {}, description: 'mock report', handler: createMockHandler('report') },
    { name: 'monograph_health', inputSchema: {}, description: 'mock health', handler: createMockHandler('health') },
  ],
}));

describe('graphify shim — monograph_health bug fix', () => {
  it('does not throw ReferenceError for files.length', async () => {
    const { graphifyTools } = await import('../src/mcp-tools/graphify-tools.js');
    const healthShim = graphifyTools.find(t => t.name === 'graphify_health');
    expect(healthShim).toBeDefined();
    await expect(healthShim!.handler({}, {})).resolves.toBeDefined();
  });
});

describe('graphify shim — monograph_suggest task relevance', () => {
  it('passes task parameter through to monograph_suggest', async () => {
    const { monographTools } = await import('../src/mcp-tools/monograph-tools.js');
    const suggestTool = monographTools.find(t => t.name === 'monograph_suggest');
    const { graphifyTools } = await import('../src/mcp-tools/graphify-tools.js');
    const graphifySuggest = graphifyTools.find(t => t.name === 'graphify_suggest');
    await graphifySuggest!.handler({ prompt: 'authentication' }, {});
    expect(suggestTool!.handler).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'authentication' }), expect.anything()
    );
  });
});
