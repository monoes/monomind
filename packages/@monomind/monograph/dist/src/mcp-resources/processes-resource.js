/**
 * Returns all Process nodes with their steps (via STEP_IN_PROCESS edges).
 * Process nodes are defined by label='Process' in the monograph schema.
 * Steps are nodes connected via outgoing STEP_IN_PROCESS edges (limit 50 per process).
 */
export function getProcessesResource(db) {
    const processRows = db
        .prepare(`SELECT id, name, file_path FROM nodes WHERE label = 'Process' ORDER BY name`)
        .all();
    const stepQuery = db.prepare(`SELECT n.name, n.label, n.file_path, n.start_line
     FROM edges e
     JOIN nodes n ON n.id = e.target_id
     WHERE e.source_id = ? AND e.relation = 'STEP_IN_PROCESS'
     LIMIT 50`);
    const processes = processRows.map((p) => {
        const stepRows = stepQuery.all(p.id);
        const steps = stepRows.map((s) => ({
            name: s.name,
            label: s.label,
            filePath: s.file_path,
            startLine: s.start_line,
        }));
        return {
            id: p.id,
            name: p.name,
            filePath: p.file_path,
            stepCount: steps.length,
            steps,
        };
    });
    return { processes };
}
//# sourceMappingURL=processes-resource.js.map