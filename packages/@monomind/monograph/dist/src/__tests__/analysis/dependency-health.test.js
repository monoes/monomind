import { describe, it, expect } from 'vitest';
import { dependencyHealth, } from '../../analysis/dependency-health.js';
describe('dependencyHealth', () => {
    it('returns score 1 for a perfectly healthy small graph', () => {
        const input = {
            nodes: ['a', 'b', 'c'],
            edges: [
                { sourceId: 'a', targetId: 'b' },
                { sourceId: 'b', targetId: 'c' },
            ],
            cycleCount: 0,
            deadNodeCount: 0,
        };
        const result = dependencyHealth(input);
        expect(result.score).toBeGreaterThan(0.8);
    });
    it('penalizes cycles', () => {
        const baseline = {
            nodes: ['a', 'b', 'c'],
            edges: [
                { sourceId: 'a', targetId: 'b' },
                { sourceId: 'b', targetId: 'c' },
            ],
            cycleCount: 0,
            deadNodeCount: 0,
        };
        const withCycle = {
            ...baseline,
            edges: [
                ...baseline.edges,
                { sourceId: 'c', targetId: 'a' },
            ],
            cycleCount: 1,
        };
        expect(dependencyHealth(withCycle).score).toBeLessThan(dependencyHealth(baseline).score);
    });
    it('penalizes dead code', () => {
        const baseline = {
            nodes: ['a', 'b', 'c'],
            edges: [{ sourceId: 'a', targetId: 'b' }],
            cycleCount: 0,
            deadNodeCount: 0,
        };
        const withDead = { ...baseline, deadNodeCount: 2 };
        expect(dependencyHealth(withDead).score).toBeLessThan(dependencyHealth(baseline).score);
    });
    it('penalizes high fan-in concentration (god nodes)', () => {
        // One node targeted by all others → god node
        const nodes = ['a', 'b', 'c', 'd', 'e', 'hub'];
        const edges = nodes.slice(0, 5).map(n => ({ sourceId: n, targetId: 'hub' }));
        const input = {
            nodes,
            edges,
            cycleCount: 0,
            deadNodeCount: 0,
        };
        const result = dependencyHealth(input);
        expect(result.score).toBeLessThan(1);
        expect(result.details.godNodeConcentration).toBeGreaterThan(0);
    });
    it('returns score in [0, 1] range', () => {
        const input = {
            nodes: ['a', 'b'],
            edges: [{ sourceId: 'a', targetId: 'b' }, { sourceId: 'b', targetId: 'a' }],
            cycleCount: 1,
            deadNodeCount: 1,
        };
        const result = dependencyHealth(input);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
    });
    it('exposes details breakdown', () => {
        const input = {
            nodes: ['a', 'b', 'c'],
            edges: [{ sourceId: 'a', targetId: 'b' }],
            cycleCount: 0,
            deadNodeCount: 1,
        };
        const { details } = dependencyHealth(input);
        expect(typeof details.cyclePenalty).toBe('number');
        expect(typeof details.deadCodeRatio).toBe('number');
        expect(typeof details.fanSkew).toBe('number');
        expect(typeof details.godNodeConcentration).toBe('number');
    });
    it('handles empty graph without throwing', () => {
        const input = {
            nodes: [],
            edges: [],
            cycleCount: 0,
            deadNodeCount: 0,
        };
        expect(() => dependencyHealth(input)).not.toThrow();
        expect(dependencyHealth(input).score).toBe(1);
    });
});
//# sourceMappingURL=dependency-health.test.js.map