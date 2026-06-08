import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { suggestPhase } from '../../../pipeline/phases/suggest.js';
function makeCtx(db) {
    return { repoPath: '/tmp', db, graph: {}, options: { ignore: [], codeOnly: false }, onProgress: () => { } };
}
function makeDeps(edges, nodes, memberships = new Map()) {
    return new Map([
        ['parse', { allEdges: edges, symbolNodes: nodes, parseErrors: [], fileContents: new Map() }],
        ['cross-file', { resolvedEdges: [], importGraph: new Map() }],
        ['communities', { memberships }],
        ['mro', { mroEdges: [] }],
        ['god-nodes', { godNodes: [] }],
        ['surprises', { surprises: [] }],
    ]);
}
describe('suggestPhase question types', () => {
    it('generates no_signal question for AMBIGUOUS edges with no evidence', async () => {
        const db = new Database(':memory:');
        const edges = [{ id: 'e1', sourceId: 'n1', targetId: 'n2', relation: 'CALLS', confidence: 'AMBIGUOUS', confidenceScore: 0.1 }];
        const nodes = [
            { id: 'n1', label: 'Function', name: 'doA', isExported: true, normLabel: 'function' },
            { id: 'n2', label: 'Function', name: 'doB', isExported: true, normLabel: 'function' },
        ];
        const result = await suggestPhase.execute(makeCtx(db), makeDeps(edges, nodes));
        const types = result.questions.map((q) => q.type);
        expect(types).toContain('no_signal');
    });
    it('generates thin_community question for community with fewer than 3 members', async () => {
        const db = new Database(':memory:');
        const edges = [];
        const nodes = [
            { id: 'n1', label: 'Function', name: 'a', isExported: true, normLabel: 'function' },
            { id: 'n2', label: 'Function', name: 'b', isExported: true, normLabel: 'function' },
        ];
        const memberships = new Map([['n1', 5], ['n2', 5]]);
        const result = await suggestPhase.execute(makeCtx(db), makeDeps(edges, nodes, memberships));
        const types = result.questions.map((q) => q.type);
        expect(types).toContain('thin_community');
    });
});
//# sourceMappingURL=suggest-questions.test.js.map