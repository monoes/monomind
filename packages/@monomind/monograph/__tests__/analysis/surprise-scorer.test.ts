import { describe, it, expect } from 'vitest';
import { computeSurpriseScore, scoreNodes } from '../../src/analysis/surprise-scorer.js';
import type { ScoredNode } from '../../src/analysis/surprise-scorer.js';

function makeNode(overrides: Partial<ScoredNode> = {}): ScoredNode {
  return {
    id: 'node-1',
    degree: 5,
    avgDegree: 5,
    crossCommunityEdges: 0,
    totalEdges: 10,
    stalenessScore: 0,
    ...overrides,
  };
}

describe('computeSurpriseScore', () => {
  it('average node with no anomalies scores near 0', () => {
    const node = makeNode({
      degree: 5,
      avgDegree: 5,
      crossCommunityEdges: 0,
      totalEdges: 10,
      stalenessScore: 0,
    });
    const score = computeSurpriseScore(node);
    expect(score).toBeCloseTo(0, 5);
  });

  it('hub node with very high degree scores high on degree anomaly', () => {
    const node = makeNode({
      degree: 100,
      avgDegree: 5,
      crossCommunityEdges: 0,
      totalEdges: 100,
      stalenessScore: 0,
    });
    const score = computeSurpriseScore(node);
    // degreeAnomaly = clamp(|100-5|/(5+1), 0, 1) = clamp(15.83, 0, 1) = 1
    // score = 0.4 * 1 + 0.4 * 0 + 0.2 * 0 = 0.4
    expect(score).toBeCloseTo(0.4, 5);
  });

  it('node with all cross-community edges scores high on that factor', () => {
    const node = makeNode({
      degree: 5,
      avgDegree: 5,
      crossCommunityEdges: 10,
      totalEdges: 10,
      stalenessScore: 0,
    });
    const score = computeSurpriseScore(node);
    // crossCommunityRatio = 10/10 = 1
    // score = 0.4 * 0 + 0.4 * 1 + 0.2 * 0 = 0.4
    expect(score).toBeCloseTo(0.4, 5);
  });

  it('stale node scores higher than fresh node with same degree', () => {
    const base = { degree: 5, avgDegree: 5, crossCommunityEdges: 0, totalEdges: 10 };
    const freshScore = computeSurpriseScore(makeNode({ ...base, stalenessScore: 0 }));
    const staleScore = computeSurpriseScore(makeNode({ ...base, stalenessScore: 1 }));
    expect(staleScore).toBeGreaterThan(freshScore);
    // staleScore should be 0.2 (0.4*0 + 0.4*0 + 0.2*1)
    expect(staleScore).toBeCloseTo(0.2, 5);
  });

  it('fully anomalous node (high degree + all cross-community + fully stale) scores 1', () => {
    const node = makeNode({
      degree: 1000,
      avgDegree: 5,
      crossCommunityEdges: 10,
      totalEdges: 10,
      stalenessScore: 1,
    });
    const score = computeSurpriseScore(node);
    // degreeAnomaly clamped to 1, crossCommunityRatio = 1, staleness = 1
    // score = 0.4*1 + 0.4*1 + 0.2*1 = 1.0
    expect(score).toBeCloseTo(1.0, 5);
  });

  it('returns 0 cross-community ratio when totalEdges is 0', () => {
    const node = makeNode({
      degree: 0,
      avgDegree: 5,
      crossCommunityEdges: 0,
      totalEdges: 0,
      stalenessScore: 0,
    });
    // Should not throw, cross-community factor should be 0
    const score = computeSurpriseScore(node);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('respects custom weights', () => {
    const node = makeNode({
      degree: 1000,
      avgDegree: 5,
      crossCommunityEdges: 0,
      totalEdges: 10,
      stalenessScore: 0,
    });
    // Only degree weight active, set to 1.0
    const score = computeSurpriseScore(node, {
      degreeWeight: 1.0,
      crossCommunityWeight: 0,
      stalenessWeight: 0,
    });
    expect(score).toBeCloseTo(1.0, 5);
  });
});

describe('scoreNodes', () => {
  it('returns nodes sorted by surprise score descending', () => {
    const nodes: ScoredNode[] = [
      makeNode({ id: 'low', degree: 5, avgDegree: 5, crossCommunityEdges: 0, totalEdges: 10, stalenessScore: 0 }),
      makeNode({ id: 'high', degree: 100, avgDegree: 5, crossCommunityEdges: 10, totalEdges: 10, stalenessScore: 1 }),
      makeNode({ id: 'mid', degree: 5, avgDegree: 5, crossCommunityEdges: 5, totalEdges: 10, stalenessScore: 0.5 }),
    ];

    const scored = scoreNodes(nodes);
    expect(scored[0].id).toBe('high');
    expect(scored[scored.length - 1].id).toBe('low');
  });

  it('attaches surpriseScore to each node', () => {
    const nodes = [makeNode({ id: 'a' }), makeNode({ id: 'b' })];
    const scored = scoreNodes(nodes);
    expect(scored).toHaveLength(2);
    for (const node of scored) {
      expect(typeof node.surpriseScore).toBe('number');
      expect(node.surpriseScore).toBeGreaterThanOrEqual(0);
      expect(node.surpriseScore).toBeLessThanOrEqual(1);
    }
  });

  it('preserves all original node properties', () => {
    const node = makeNode({ id: 'test-node', communityId: 'community-A' });
    const [scored] = scoreNodes([node]);
    expect(scored.id).toBe('test-node');
    expect(scored.communityId).toBe('community-A');
  });

  it('default weights sum to 1.0 (0.4 + 0.4 + 0.2)', () => {
    const degreeWeight = 0.4;
    const crossCommunityWeight = 0.4;
    const stalenessWeight = 0.2;
    expect(degreeWeight + crossCommunityWeight + stalenessWeight).toBeCloseTo(1.0, 10);
  });

  it('returns empty array for empty input', () => {
    expect(scoreNodes([])).toEqual([]);
  });
});
