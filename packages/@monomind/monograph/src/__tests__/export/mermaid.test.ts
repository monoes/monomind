import { describe, it, expect } from 'vitest';
import { toMermaid } from '../../export/mermaid.js';
import type { MonographNode, MonographEdge } from '../../types.js';

const fn: MonographNode = {
  id: 'fn_alpha', label: 'Function', name: 'alpha',
  normLabel: 'function', filePath: '/src/a.ts',
  isExported: true,
};
const cls: MonographNode = {
  id: 'cls_beta', label: 'Class', name: 'Beta',
  normLabel: 'class', filePath: '/src/b.ts',
  isExported: false,
};
const edge: MonographEdge = {
  id: 'e1', sourceId: 'fn_alpha', targetId: 'cls_beta',
  relation: 'CALLS', confidence: 'EXTRACTED', confidenceScore: 1.0,
};

describe('toMermaid', () => {
  it('starts with "graph" declaration', () => {
    const out = toMermaid([fn], []);
    expect(out).toMatch(/^graph\s+(TD|LR|RL|BT)/);
  });

  it('includes all node ids', () => {
    const out = toMermaid([fn, cls], [edge]);
    expect(out).toContain('fn_alpha');
    expect(out).toContain('cls_beta');
  });

  it('includes an edge arrow between connected nodes', () => {
    const out = toMermaid([fn, cls], [edge]);
    // Arrow may include a label: fn_alpha -->|CALLS| cls_beta
    expect(out).toMatch(/fn_alpha\s*-->(\|[^|]+\|)?\s*cls_beta/);
  });

  it('includes edge label with relation', () => {
    const out = toMermaid([fn, cls], [edge]);
    expect(out).toContain('CALLS');
  });

  it('includes node type/label in the diagram', () => {
    const out = toMermaid([fn], []);
    expect(out).toContain('Function');
  });

  it('returns empty graph declaration for empty inputs', () => {
    const out = toMermaid([], []);
    expect(out).toMatch(/^graph\s+(TD|LR|RL|BT)/);
    expect(out).not.toContain('-->');
  });

  it('caps nodes at 200 to avoid huge diagrams', () => {
    const nodes: MonographNode[] = Array.from({ length: 300 }, (_, i) => ({
      id: `n${i}`, label: 'Function', name: `fn${i}`,
      normLabel: 'function', isExported: false,
    }));
    const out = toMermaid(nodes, []);
    // Should only contain up to 200 node definitions
    const matches = out.match(/\bn\d+\b/g) ?? [];
    const uniqueIds = new Set(matches);
    expect(uniqueIds.size).toBeLessThanOrEqual(200);
  });

  it('sanitizes special characters in node names', () => {
    const n: MonographNode = {
      id: 'n_special', label: 'Function', name: 'foo<bar>"baz"',
      normLabel: 'function', isExported: false,
    };
    const out = toMermaid([n], []);
    expect(out).not.toContain('<bar>');
    expect(out).not.toContain('"baz"');
  });

  it('includes community groupings as subgraphs when nodes have communityId', () => {
    const a: MonographNode = { ...fn, communityId: 1 };
    const b: MonographNode = { ...cls, communityId: 2 };
    const out = toMermaid([a, b], []);
    expect(out).toContain('subgraph');
  });

  it('uses dashed arrows for non-EXTRACTED edges', () => {
    const inferredEdge: MonographEdge = { ...edge, id: 'e2', confidence: 'INFERRED' };
    const out = toMermaid([fn, cls], [inferredEdge]);
    // Dashed arrow syntax: -..-> or -.->
    expect(out).toMatch(/fn_alpha\s*-\.+->(\|[^|]+\|)?\s*cls_beta/);
  });
});
