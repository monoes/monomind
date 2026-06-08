import { describe, it, expect } from 'vitest';
import { toGexf } from '../../export/gexf.js';
function makeNode(id, label = 'Function', name = id) {
    return { id, label: label, name, isExported: false };
}
function makeEdge(id, sourceId, targetId, relation = 'CALLS') {
    return { id, sourceId, targetId, relation, confidence: 'EXTRACTED', confidenceScore: 1.0 };
}
describe('toGexf', () => {
    it('returns a string', () => {
        expect(typeof toGexf([], [])).toBe('string');
    });
    it('starts with XML declaration', () => {
        const result = toGexf([], []);
        expect(result).toMatch(/^<\?xml/);
    });
    it('contains gexf root element', () => {
        const result = toGexf([], []);
        expect(result).toContain('<gexf');
        expect(result).toContain('</gexf>');
    });
    it('contains graph element', () => {
        const result = toGexf([], []);
        expect(result).toContain('<graph');
        expect(result).toContain('</graph>');
    });
    it('includes nodes section', () => {
        const nodes = [makeNode('a'), makeNode('b')];
        const result = toGexf(nodes, []);
        expect(result).toContain('<nodes>');
        expect(result).toContain('</nodes>');
        expect(result).toContain('"a"');
        expect(result).toContain('"b"');
    });
    it('includes edges section', () => {
        const nodes = [makeNode('a'), makeNode('b')];
        const edges = [makeEdge('e1', 'a', 'b')];
        const result = toGexf(nodes, edges);
        expect(result).toContain('<edges>');
        expect(result).toContain('</edges>');
        expect(result).toContain('e1');
    });
    it('includes node label attribute', () => {
        const nodes = [makeNode('fn1', 'Function', 'myFunc')];
        const result = toGexf(nodes, []);
        expect(result).toContain('myFunc');
    });
    it('includes edge source and target', () => {
        const nodes = [makeNode('a'), makeNode('b')];
        const edges = [makeEdge('e1', 'a', 'b')];
        const result = toGexf(nodes, edges);
        expect(result).toContain('source="a"');
        expect(result).toContain('target="b"');
    });
    it('handles empty nodes and edges gracefully', () => {
        const result = toGexf([], []);
        expect(result).toBeTruthy();
        expect(result).toContain('<nodes');
        expect(result).toContain('<edges');
    });
    it('marks graph as directed', () => {
        const result = toGexf([], []);
        expect(result).toContain('directed');
    });
});
//# sourceMappingURL=gexf.test.js.map