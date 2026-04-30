import { describe, it, expect } from 'vitest';
import Graph from 'graphology';
import { leiden } from '../../../src/pipeline/phases/leiden.js';

function makeClusteredGraph(): Graph {
  const graph = new Graph({ type: 'undirected' });
  // Cluster A: a-b-c tightly connected
  graph.addNode('a');
  graph.addNode('b');
  graph.addNode('c');
  graph.addEdge('a', 'b');
  graph.addEdge('b', 'c');
  graph.addEdge('a', 'c');
  // Cluster B: x-y-z tightly connected
  graph.addNode('x');
  graph.addNode('y');
  graph.addNode('z');
  graph.addEdge('x', 'y');
  graph.addEdge('y', 'z');
  graph.addEdge('x', 'z');
  // Weak bridge between clusters
  graph.addEdge('c', 'x');
  return graph;
}

describe('leiden', () => {
  it('produces deterministic results on repeated calls', () => {
    const graph = makeClusteredGraph();
    const result1 = leiden(graph, { seed: 42 });
    const result2 = leiden(graph, { seed: 42 });
    expect(result1).toEqual(result2);
  });

  it('returns a community assignment for every node', () => {
    const graph = makeClusteredGraph();
    const result = leiden(graph);
    const nodes = graph.nodes();
    expect(Object.keys(result).length).toBe(nodes.length);
    for (const node of nodes) {
      expect(result[node]).toBeDefined();
    }
  });

  it('returns at least 1 community for a two-node graph', () => {
    const graph = new Graph({ type: 'undirected' });
    graph.addNode('a');
    graph.addNode('b');
    graph.addEdge('a', 'b');
    const result = leiden(graph);
    const communityIds = new Set(Object.values(result));
    expect(communityIds.size).toBeGreaterThanOrEqual(1);
    expect(Object.keys(result).length).toBe(2);
  });

  it('handles an empty graph without crashing', () => {
    const graph = new Graph({ type: 'undirected' });
    expect(() => leiden(graph)).not.toThrow();
    expect(leiden(graph)).toEqual({});
  });

  it('works with directed graphs (as louvain-based)', () => {
    const graph = new Graph({ type: 'directed' });
    graph.addNode('a');
    graph.addNode('b');
    graph.addNode('c');
    graph.addEdge('a', 'b');
    graph.addEdge('b', 'c');
    graph.addEdge('c', 'a');
    const result = leiden(graph);
    expect(Object.keys(result).length).toBe(3);
  });
});
