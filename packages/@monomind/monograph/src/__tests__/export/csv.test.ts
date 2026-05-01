import { describe, it, expect } from 'vitest';
import { toCsv } from '../../export/csv.js';
import type { MonographNode, MonographEdge } from '../../types.js';

const node: MonographNode = {
  id: 'n1', label: 'Function', name: 'doStuff',
  normLabel: 'function', filePath: '/a.ts',
  startLine: 1, endLine: 5, isExported: true,
};
const edge: MonographEdge = {
  id: 'e1', sourceId: 'n1', targetId: 'n2',
  relation: 'CALLS', confidence: 'EXTRACTED', confidenceScore: 0.9,
};

describe('toCsv', () => {
  it('emits node CSV header and row', () => {
    const { nodes } = toCsv([node], []);
    expect(nodes).toContain('id,label,name,filePath,isExported,startLine,endLine');
    expect(nodes).toContain('n1,Function,doStuff,/a.ts,true,1,5');
  });

  it('emits edge CSV header and row', () => {
    const { edges } = toCsv([node], [edge]);
    expect(edges).toContain('id,sourceId,targetId,relation,confidence,confidenceScore');
    expect(edges).toContain('e1,n1,n2,CALLS,EXTRACTED,0.9');
  });

  it('escapes commas in names', () => {
    const n = { ...node, name: 'foo,bar' };
    const { nodes } = toCsv([n], []);
    expect(nodes).toContain('"foo,bar"');
  });

  it('returns two separate CSV strings', () => {
    const result = toCsv([node], [edge]);
    expect(typeof result.nodes).toBe('string');
    expect(typeof result.edges).toBe('string');
  });
});
