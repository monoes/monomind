/**
 * Detect dead code: nodes that have in-degree 0 AND are not marked as exported.
 *
 * In a module dependency graph, a node with in-degree 0 is never imported by
 * any other module. If it is also not explicitly exported (i.e., not an entry-point),
 * it is considered dead code — unreachable and unused.
 *
 * @param db - The MonographDb instance
 * @returns Array of node ids that are considered dead code.
 */
export function detectDeadCode(db) {
    const nodeRows = db.prepare('SELECT id, is_exported FROM nodes').all();
    if (nodeRows.length === 0)
        return [];
    // Count in-degrees
    const inDegree = new Map();
    for (const { id } of nodeRows) {
        inDegree.set(id, 0);
    }
    const edgeRows = db.prepare('SELECT target_id FROM edges WHERE source_id != target_id').all();
    for (const { target_id } of edgeRows) {
        if (inDegree.has(target_id)) {
            inDegree.set(target_id, (inDegree.get(target_id) ?? 0) + 1);
        }
    }
    const dead = [];
    for (const { id, is_exported } of nodeRows) {
        if ((inDegree.get(id) ?? 0) === 0 && is_exported !== 1) {
            dead.push(id);
        }
    }
    return dead;
}
//# sourceMappingURL=dead-code.js.map