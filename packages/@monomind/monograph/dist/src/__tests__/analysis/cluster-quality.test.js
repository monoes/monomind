import { describe, it, expect } from 'vitest';
import { silhouetteScore, modularityScore } from '../../analysis/cluster-quality.js';
describe('silhouetteScore', () => {
    it('returns 0 for a single node', () => {
        const memberships = new Map([['a', 0]]);
        const edges = [];
        expect(silhouetteScore(memberships, edges)).toBeCloseTo(0);
    });
    it('returns 1 for two perfectly separated communities with no cross edges', () => {
        // Community 0: a-b-c fully connected, Community 1: d-e-f fully connected
        const memberships = new Map([
            ['a', 0], ['b', 0], ['c', 0],
            ['d', 1], ['e', 1], ['f', 1],
        ]);
        const edges = [
            { sourceId: 'a', targetId: 'b' },
            { sourceId: 'b', targetId: 'c' },
            { sourceId: 'a', targetId: 'c' },
            { sourceId: 'd', targetId: 'e' },
            { sourceId: 'e', targetId: 'f' },
            { sourceId: 'd', targetId: 'f' },
        ];
        const score = silhouetteScore(memberships, edges);
        expect(score).toBeGreaterThan(0.5);
    });
    it('returns negative score for misassigned nodes (cross edges dominate)', () => {
        // Node 'a' is in community 0 but only connected to community 1 nodes
        const memberships = new Map([
            ['a', 0],
            ['b', 1], ['c', 1], ['d', 1],
        ]);
        const edges = [
            { sourceId: 'a', targetId: 'b' },
            { sourceId: 'a', targetId: 'c' },
            { sourceId: 'a', targetId: 'd' },
            { sourceId: 'b', targetId: 'c' },
            { sourceId: 'c', targetId: 'd' },
        ];
        const score = silhouetteScore(memberships, edges);
        // 'a' is isolated in its community, so its silhouette is negative
        expect(score).toBeLessThan(0.5);
    });
    it('handles nodes with no edges gracefully', () => {
        const memberships = new Map([['x', 0], ['y', 1]]);
        const edges = [];
        const score = silhouetteScore(memberships, edges);
        expect(typeof score).toBe('number');
        expect(isNaN(score)).toBe(false);
    });
});
describe('modularityScore', () => {
    it('returns 0 for empty graph', () => {
        const memberships = new Map();
        const edges = [];
        expect(modularityScore(memberships, edges)).toBeCloseTo(0);
    });
    it('returns positive value for well-structured communities', () => {
        // Two dense clusters with few cross edges
        const memberships = new Map([
            ['a', 0], ['b', 0], ['c', 0],
            ['d', 1], ['e', 1], ['f', 1],
        ]);
        const edges = [
            { sourceId: 'a', targetId: 'b' },
            { sourceId: 'b', targetId: 'c' },
            { sourceId: 'a', targetId: 'c' },
            { sourceId: 'd', targetId: 'e' },
            { sourceId: 'e', targetId: 'f' },
            { sourceId: 'd', targetId: 'f' },
            { sourceId: 'c', targetId: 'd' }, // one bridge edge
        ];
        const q = modularityScore(memberships, edges);
        expect(q).toBeGreaterThan(0);
    });
    it('returns close to 0 or negative for random partition', () => {
        // All edges cross community boundaries
        const memberships = new Map([
            ['a', 0], ['b', 1], ['c', 0], ['d', 1],
        ]);
        const edges = [
            { sourceId: 'a', targetId: 'b' },
            { sourceId: 'b', targetId: 'c' },
            { sourceId: 'c', targetId: 'd' },
            { sourceId: 'd', targetId: 'a' },
        ];
        const q = modularityScore(memberships, edges);
        expect(q).toBeLessThan(0.3);
    });
    it('handles single-community graph', () => {
        const memberships = new Map([['a', 0], ['b', 0], ['c', 0]]);
        const edges = [
            { sourceId: 'a', targetId: 'b' },
            { sourceId: 'b', targetId: 'c' },
        ];
        const q = modularityScore(memberships, edges);
        expect(typeof q).toBe('number');
    });
});
//# sourceMappingURL=cluster-quality.test.js.map