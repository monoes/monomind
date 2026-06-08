/**
 * Returns the graph schema: node label distribution, edge relation distribution,
 * and total counts. Useful for understanding what's in the index at a glance.
 */
export function getSchemaResource(db) {
    const labelRows = db
        .prepare(`SELECT label, COUNT(*) AS count FROM nodes GROUP BY label ORDER BY count DESC`)
        .all();
    const relationRows = db
        .prepare(`SELECT relation, COUNT(*) AS count FROM edges GROUP BY relation ORDER BY count DESC`)
        .all();
    const totalNodes = labelRows.reduce((sum, r) => sum + r.count, 0);
    const totalEdges = relationRows.reduce((sum, r) => sum + r.count, 0);
    return {
        nodeLabels: labelRows.map((r) => ({ label: r.label, count: r.count })),
        edgeRelations: relationRows.map((r) => ({ relation: r.relation, count: r.count })),
        totalNodes,
        totalEdges,
    };
}
//# sourceMappingURL=schema-resource.js.map