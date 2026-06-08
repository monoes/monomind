import { describe, it, expect } from 'vitest';
import { toGraphml } from '../../export/graphml.js';
const nodeWithCommunity = {
    id: 'n1', label: 'Function', name: 'doStuff',
    normLabel: 'function', filePath: '/a.ts',
    isExported: true, communityId: 42,
};
const nodeWithoutCommunity = {
    id: 'n2', label: 'Class', name: 'Foo',
    normLabel: 'class', filePath: '/b.ts',
    isExported: false,
};
const edge = {
    id: 'e1', sourceId: 'n1', targetId: 'n2',
    relation: 'CALLS', confidence: 'EXTRACTED', confidenceScore: 1.0,
};
describe('toGraphml', () => {
    it('includes community key declaration in header', () => {
        const out = toGraphml([nodeWithCommunity], []);
        expect(out).toContain('<key id="community"');
        expect(out).toContain('attr.name="community"');
        expect(out).toContain('attr.type="int"');
    });
    it('includes community data element for node with communityId', () => {
        const out = toGraphml([nodeWithCommunity], []);
        expect(out).toContain('<data key="community">42</data>');
    });
    it('omits community data element when communityId is absent', () => {
        const out = toGraphml([nodeWithoutCommunity], []);
        // Should not have a community data tag for this node
        const nodeSection = out.split('<node id="n2">')[1]?.split('</node>')[0] ?? '';
        expect(nodeSection).not.toContain('<data key="community">');
    });
    it('produces valid graphml with edges', () => {
        const out = toGraphml([nodeWithCommunity, nodeWithoutCommunity], [edge]);
        expect(out).toContain('<?xml version="1.0"');
        expect(out).toContain('<graphml');
        expect(out).toContain('<edge id="e1"');
        expect(out).toContain('<data key="relation">CALLS</data>');
    });
    it('escapes XML special characters in names', () => {
        const n = {
            id: 'n3', label: 'Function', name: 'foo<bar>&baz',
            normLabel: 'function', isExported: false,
        };
        const out = toGraphml([n], []);
        expect(out).toContain('foo&lt;bar&gt;&amp;baz');
        expect(out).not.toContain('foo<bar>');
    });
});
//# sourceMappingURL=graphml.test.js.map