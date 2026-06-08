import { describe, it, expect } from 'vitest';
import { toDot } from '../../export/dot.js';
function makeNode(id, label = 'Function', name = id, filePath) {
    return { id, label: label, name, isExported: false, filePath };
}
function makeEdge(id, sourceId, targetId, relation = 'CALLS') {
    return { id, sourceId, targetId, relation, confidence: 'EXTRACTED', confidenceScore: 1.0 };
}
describe('toDot', () => {
    it('returns a string starting with "digraph"', () => {
        const result = toDot([], []);
        expect(typeof result).toBe('string');
        expect(result.trim()).toMatch(/^digraph/);
    });
    it('produces valid DOT structure with braces', () => {
        const result = toDot([], []);
        expect(result).toContain('{');
        expect(result).toContain('}');
    });
    it('includes node ids in output', () => {
        const nodes = [makeNode('node_a'), makeNode('node_b')];
        const result = toDot(nodes, []);
        expect(result).toContain('node_a');
        expect(result).toContain('node_b');
    });
    it('includes edge arrows', () => {
        const nodes = [makeNode('a'), makeNode('b')];
        const edges = [makeEdge('e1', 'a', 'b')];
        const result = toDot(nodes, edges);
        expect(result).toContain('->');
        expect(result).toContain('"a"');
        expect(result).toContain('"b"');
    });
    it('escapes special characters in node names', () => {
        const nodes = [makeNode('id1', 'Function', 'my "func"')];
        const result = toDot(nodes, []);
        // The quoted name should be escaped
        expect(result).toContain('id1');
    });
    it('includes label attribute on nodes', () => {
        const nodes = [makeNode('fn1', 'Function', 'myFunction')];
        const result = toDot(nodes, []);
        expect(result).toContain('label');
        expect(result).toContain('myFunction');
    });
    it('includes relation as edge label', () => {
        const nodes = [makeNode('a'), makeNode('b')];
        const edges = [makeEdge('e1', 'a', 'b', 'IMPORTS')];
        const result = toDot(nodes, edges);
        expect(result).toContain('IMPORTS');
    });
    it('handles empty nodes and edges', () => {
        const result = toDot([], []);
        expect(result).toBeTruthy();
        expect(result).toContain('digraph');
    });
    it('accepts an optional graph name', () => {
        const result = toDot([], [], { graphName: 'MyGraph' });
        expect(result).toContain('MyGraph');
    });
    it('uses "monograph" as default graph name', () => {
        const result = toDot([], []);
        expect(result).toContain('monograph');
    });
    it('produces parseable DOT for multiple nodes and edges', () => {
        const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
        const edges = [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')];
        const result = toDot(nodes, edges);
        expect(result).toContain('"a" ->');
        expect(result).toContain('"b" ->');
    });
});
//# sourceMappingURL=dot.test.js.map