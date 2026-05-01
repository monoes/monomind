import { describe, it, expect } from 'vitest';
import { validateExtraction } from '../../src/validation/extraction-validator.js';
import type { MonographNode, MonographEdge } from '../../src/types.js';

const validNode: MonographNode = {
  id: 'n1', label: 'Function', name: 'myFn', normLabel: 'myfn',
  filePath: 'src/a.ts', startLine: 1, endLine: 5, isExported: true,
};
const validEdge: MonographEdge = {
  id: 'e1', sourceId: 'n1', targetId: 'n1',
  relation: 'CALLS', confidence: 'EXTRACTED', confidenceScore: 1.0,
};

describe('validateExtraction', () => {
  it('passes on valid nodes and edges', () => {
    const r = validateExtraction([validNode], [validEdge]);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('rejects node with missing id', () => {
    const bad = { ...validNode, id: '' };
    const r = validateExtraction([bad], []);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes('id'))).toBe(true);
  });

  it('rejects node with invalid label', () => {
    const bad = { ...validNode, label: 'Goblin' as any };
    const r = validateExtraction([bad], []);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes('label'))).toBe(true);
  });

  it('rejects edge referencing unknown node', () => {
    const badEdge = { ...validEdge, targetId: 'unknown_node' };
    const r = validateExtraction([validNode], [badEdge]);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes('targetId'))).toBe(true);
  });

  it('rejects edge with invalid confidence', () => {
    const badEdge = { ...validEdge, confidence: 'MADE_UP' as any };
    const r = validateExtraction([validNode], [badEdge]);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes('confidence'))).toBe(true);
  });
});
