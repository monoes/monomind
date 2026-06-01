import { describe, it, expect } from 'vitest';
import { computeCohesion } from '../../../pipeline/phases/communities.js';

describe('computeCohesion', () => {
  it('returns 1.0 for fully connected community', () => {
    // 3 nodes, 3 edges (fully connected: 3 possible edges)
    const memberships = new Map([['a', 0], ['b', 0], ['c', 0]]);
    const edges = [
      { sourceId: 'a', targetId: 'b' },
      { sourceId: 'b', targetId: 'c' },
      { sourceId: 'a', targetId: 'c' },
    ];
    const score = computeCohesion(0, memberships, edges);
    expect(score).toBeCloseTo(1.0);
  });

  it('returns 0 for community with no internal edges', () => {
    const memberships = new Map([['a', 0], ['b', 0], ['c', 1], ['d', 1]]);
    const edges = [
      { sourceId: 'a', targetId: 'c' }, // cross-community
    ];
    const score = computeCohesion(0, memberships, edges);
    expect(score).toBe(0);
  });

  it('returns value between 0 and 1 for partial connectivity', () => {
    const memberships = new Map([['a', 0], ['b', 0], ['c', 0], ['d', 0]]);
    const edges = [
      { sourceId: 'a', targetId: 'b' },
      { sourceId: 'c', targetId: 'd' },
      // 2 out of 12 possible edges (directed: 4*(4-1)=12)
    ];
    const score = computeCohesion(0, memberships, edges);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('returns 1 for single-node community', () => {
    const memberships = new Map([['a', 0]]);
    const score = computeCohesion(0, memberships, []);
    expect(score).toBe(1);
  });
});
