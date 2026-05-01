import { describe, it, expect } from 'vitest';
import { EvidenceWeights, typeBindingWeightAtDepth } from '../../scope-resolution/evidence-weights.js';

describe('EvidenceWeights', () => {
  it('local weight is highest origin weight', () => {
    expect(EvidenceWeights.local).toBeGreaterThan(EvidenceWeights.import);
    expect(EvidenceWeights.local).toBeGreaterThan(EvidenceWeights.wildcard);
  });

  it('import weight is higher than wildcard weight', () => {
    expect(EvidenceWeights.import).toBeGreaterThan(EvidenceWeights.wildcard);
  });

  it('arity-incompatible is negative', () => {
    expect(EvidenceWeights.arityMatchIncompatible).toBeLessThan(0);
  });

  it('unlinkedImportMultiplier is less than 1', () => {
    expect(EvidenceWeights.unlinkedImportMultiplier).toBeGreaterThan(0);
    expect(EvidenceWeights.unlinkedImportMultiplier).toBeLessThan(1);
  });

  it('scopeChainPerDepth is negative', () => {
    expect(EvidenceWeights.scopeChainPerDepth).toBeLessThan(0);
  });

  it('has typeBindingByMroDepth as a non-empty array', () => {
    expect(EvidenceWeights.typeBindingByMroDepth.length).toBeGreaterThan(0);
  });
});

describe('typeBindingWeightAtDepth', () => {
  it('returns first element at depth 0', () => {
    expect(typeBindingWeightAtDepth(0)).toBe(EvidenceWeights.typeBindingByMroDepth[0]);
  });

  it('returns last element for depth beyond table length', () => {
    const last = EvidenceWeights.typeBindingByMroDepth[EvidenceWeights.typeBindingByMroDepth.length - 1];
    expect(typeBindingWeightAtDepth(100)).toBe(last);
  });

  it('returns first element for negative depth', () => {
    expect(typeBindingWeightAtDepth(-1)).toBe(EvidenceWeights.typeBindingByMroDepth[0]);
  });

  it('decays with depth — depth 1 < depth 0', () => {
    expect(typeBindingWeightAtDepth(1)).toBeLessThan(typeBindingWeightAtDepth(0));
  });
});
