import { describe, it, expect } from 'vitest';
import { makeEvidence, mergeEvidence } from '../../../src/pipeline/phases/evidence.js';

describe('makeEvidence', () => {
  it('creates an evidence entry', () => {
    const e = makeEvidence('import', 0.9, 'direct import');
    expect(e.kind).toBe('import');
    expect(e.weight).toBe(0.9);
    expect(e.note).toBe('direct import');
  });

  it('clamps weight to 0-1', () => {
    expect(makeEvidence('x', 2.0).weight).toBe(1.0);
    expect(makeEvidence('x', -0.5).weight).toBe(0.0);
  });

  it('omits note when not provided', () => {
    const e = makeEvidence('call', 0.5);
    expect(e.note).toBeUndefined();
  });
});

describe('mergeEvidence', () => {
  it('appends to existing evidence', () => {
    const existing = [makeEvidence('a', 0.5)];
    const merged = mergeEvidence(existing, makeEvidence('b', 0.8));
    expect(merged).toHaveLength(2);
    expect(merged[1].kind).toBe('b');
  });

  it('handles undefined existing', () => {
    const merged = mergeEvidence(undefined, makeEvidence('c', 0.3));
    expect(merged).toHaveLength(1);
  });

  it('does not mutate the original array', () => {
    const existing = [makeEvidence('a', 0.5)];
    mergeEvidence(existing, makeEvidence('b', 0.8));
    expect(existing).toHaveLength(1);
  });
});
