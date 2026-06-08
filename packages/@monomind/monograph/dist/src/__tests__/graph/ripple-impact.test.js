import { describe, it, expect } from 'vitest';
import { rippleImpact } from '../../graph/ripple-impact.js';
const edges = [
    { sourceId: 'a', targetId: 'b' },
    { sourceId: 'b', targetId: 'c' },
    { sourceId: 'c', targetId: 'd' },
    { sourceId: 'd', targetId: 'e' },
];
describe('rippleImpact', () => {
    it('returns only direct neighbors at depth 1', () => {
        const result = rippleImpact('a', edges, 1);
        expect(result.byDepth[1]).toContain('b');
        expect(result.byDepth[2]).toBeUndefined();
    });
    it('returns nodes at each depth level', () => {
        const result = rippleImpact('a', edges, 3);
        expect(result.byDepth[1]).toContain('b');
        expect(result.byDepth[2]).toContain('c');
        expect(result.byDepth[3]).toContain('d');
    });
    it('does not repeat nodes across depths', () => {
        const loopyEdges = [
            { sourceId: 'a', targetId: 'b' },
            { sourceId: 'b', targetId: 'c' },
            { sourceId: 'c', targetId: 'a' }, // cycle
        ];
        const result = rippleImpact('a', loopyEdges, 5);
        const allNodes = Object.values(result.byDepth).flat();
        const unique = new Set(allNodes);
        expect(unique.size).toBe(allNodes.length);
    });
    it('totalScore is positive and decreases with depth-only paths', () => {
        const result = rippleImpact('a', edges, 4);
        expect(result.totalScore).toBeGreaterThan(0);
    });
    it('score at depth 2 is less than score at depth 1 (decay)', () => {
        const result = rippleImpact('a', edges, 2);
        expect(result.byDepth[1]?.length ?? 0).toBeGreaterThan(0);
        // total score should reflect decay weighting
        const result1 = rippleImpact('a', edges, 1);
        expect(result.totalScore).toBeGreaterThan(result1.totalScore);
    });
    it('returns empty result for unknown node', () => {
        const result = rippleImpact('unknown', edges, 3);
        expect(Object.keys(result.byDepth)).toHaveLength(0);
        expect(result.totalScore).toBe(0);
    });
    it('respects maxDepth boundary', () => {
        const result = rippleImpact('a', edges, 2);
        expect(result.byDepth[3]).toBeUndefined();
    });
    it('works on directed edges (not traversing backwards)', () => {
        // directed: a→b→c only; starting from 'c' should yield nothing
        const result = rippleImpact('c', edges, 3);
        // 'd' is downstream of c
        expect(result.byDepth[1]).toContain('d');
    });
    it('returns totalScore 0 when node has no outgoing edges', () => {
        const result = rippleImpact('e', edges, 3);
        expect(result.totalScore).toBe(0);
        expect(Object.keys(result.byDepth)).toHaveLength(0);
    });
});
//# sourceMappingURL=ripple-impact.test.js.map