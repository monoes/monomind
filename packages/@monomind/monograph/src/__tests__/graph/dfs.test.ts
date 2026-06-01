import { describe, it, expect } from 'vitest';
import { dfsTraversal } from '../../graph/dfs.js';

function makeGraph(): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  adj.set('a', ['b', 'c']);
  adj.set('b', ['d']);
  adj.set('c', ['d', 'e']);
  adj.set('d', []);
  adj.set('e', []);
  return adj;
}

describe('dfsTraversal', () => {
  it('visits all reachable nodes', () => {
    const visited: string[] = [];
    dfsTraversal('a', makeGraph(), (node) => { visited.push(node.id); });
    expect(visited.sort()).toEqual(['a', 'b', 'c', 'd', 'e'].sort());
  });

  it('respects depth limit', () => {
    const visited: string[] = [];
    dfsTraversal('a', makeGraph(), (node) => { visited.push(node.id); }, { maxDepth: 1 });
    expect(visited).toContain('a');
    expect(visited).toContain('b');
    expect(visited).toContain('c');
    expect(visited).not.toContain('d');
    expect(visited).not.toContain('e');
  });

  it('provides depth info in visitor', () => {
    const depths: Record<string, number> = {};
    dfsTraversal('a', makeGraph(), (node) => { depths[node.id] = node.depth; });
    expect(depths['a']).toBe(0);
    expect(depths['b']).toBe(1);
    expect(depths['d']).toBe(2);
  });

  it('does not revisit nodes (cycle safety)', () => {
    const cyclic = new Map<string, string[]>();
    cyclic.set('a', ['b']);
    cyclic.set('b', ['c']);
    cyclic.set('c', ['a']); // cycle
    const visited: string[] = [];
    dfsTraversal('a', cyclic, (node) => { visited.push(node.id); });
    expect(visited.length).toBe(3);
    expect(new Set(visited).size).toBe(3);
  });

  it('returns empty when start node not in graph', () => {
    const visited: string[] = [];
    dfsTraversal('z', makeGraph(), (node) => { visited.push(node.id); });
    expect(visited).toEqual([]);
  });

  it('returns nodes in DFS pre-order', () => {
    const visited: string[] = [];
    dfsTraversal('a', makeGraph(), (node) => { visited.push(node.id); });
    expect(visited.indexOf('a')).toBeLessThan(visited.indexOf('b'));
    expect(visited.indexOf('b')).toBeLessThan(visited.indexOf('d'));
  });
});
