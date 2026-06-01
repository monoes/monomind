import { describe, it, expect } from 'vitest';
import { splitOversizedCommunity } from '../../../pipeline/phases/communities.js';

describe('splitOversizedCommunity', () => {
  it('splits a community with 30 members into smaller groups', () => {
    const members = Array.from({ length: 30 }, (_, i) => `node${i}`);
    const result = splitOversizedCommunity(members, 10);
    expect(result.length).toBeGreaterThan(1);
    expect(result.every(g => g.length <= 10)).toBe(true);
  });

  it('does not split a small community', () => {
    const members = ['a', 'b', 'c'];
    const result = splitOversizedCommunity(members, 10);
    expect(result).toHaveLength(1);
  });

  it('preserves all member IDs', () => {
    const members = Array.from({ length: 25 }, (_, i) => `n${i}`);
    const result = splitOversizedCommunity(members, 10);
    const allNodes = result.flat();
    expect(allNodes.sort()).toEqual([...members].sort());
  });

  it('respects maxGroupSize', () => {
    const members = Array.from({ length: 50 }, (_, i) => `n${i}`);
    const result = splitOversizedCommunity(members, 15);
    expect(result.every(g => g.length <= 15)).toBe(true);
  });
});
