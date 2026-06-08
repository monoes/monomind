import { synthesizeWildcardImports } from './wildcard-synthesis.js';
export const wildcardSynthesisPhase = {
    name: 'wildcard-synthesis',
    deps: ['parse', 'cross-file'],
    async execute(ctx, deps) {
        const { symbolNodes: allNodes, allEdges, fileContents } = deps.get('parse');
        const { resolvedEdges } = deps.get('cross-file');
        const allKnownEdges = [...allEdges, ...resolvedEdges];
        const allKnownNodes = allNodes;
        let synthesizedCount = 0;
        const fileNodeIndex = new Map();
        for (const node of allKnownNodes) {
            if (node.filePath)
                fileNodeIndex.set(node.filePath, node.id);
        }
        const stmt = ctx.db.prepare(`
      INSERT OR IGNORE INTO edges (id, source_id, target_id, relation, confidence, confidence_score)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
        for (const [filePath, source] of fileContents) {
            const fileNodeId = fileNodeIndex.get(filePath) ?? `file:${filePath}`;
            const { synthesizedEdges } = synthesizeWildcardImports(fileNodeId, source, allKnownNodes, allKnownEdges);
            for (const edge of synthesizedEdges) {
                stmt.run(edge.id, edge.sourceId, edge.targetId, edge.relation, edge.confidence, edge.confidenceScore);
                synthesizedCount++;
            }
        }
        return { synthesizedCount };
    },
};
//# sourceMappingURL=wildcard-phase.js.map