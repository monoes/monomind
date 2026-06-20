/**
 * Cross-reference unreachable files with duplicated files.
 * Files that are BOTH dead code AND structurally duplicated are
 * the highest-confidence safe-delete candidates.
 *
 * @param db - monograph database
 */
export function crossReferenceDuplicatesAndDeadCode(db) {
    // ── Step 1: Find dead (unreachable) file nodes ────────────────────────────
    const deadRows = db.prepare(`
    SELECT id, name, file_path
    FROM nodes
    WHERE label = 'File'
      AND json_extract(properties, '$.reachabilityRole') = 'unreachable'
  `).all();
    const deadIds = new Set(deadRows.map(r => r.id));
    const deadById = new Map(deadRows.map(r => [r.id, r]));
    // ── Step 2: Find duplicated file nodes ───────────────────────────────────
    // Primary: nodes connected by STRUCTURALLY_SIMILAR edges
    let duplicateIds = new Set();
    try {
        const simRows = db.prepare(`
      SELECT source_id, target_id
      FROM edges
      WHERE relation = 'STRUCTURALLY_SIMILAR'
    `).all();
        for (const row of simRows) {
            duplicateIds.add(row.source_id);
            duplicateIds.add(row.target_id);
        }
    }
    catch {
        // relation may not exist in this graph
    }
    // Fallback: files with the same basename in multiple directories
    if (duplicateIds.size === 0) {
        const allFiles = db.prepare(`
      SELECT id, file_path
      FROM nodes
      WHERE label = 'File' AND file_path IS NOT NULL
    `).all();
        const byBasename = new Map();
        for (const { id, file_path } of allFiles) {
            const lastSlash = Math.max(file_path.lastIndexOf('/'), file_path.lastIndexOf('\\'));
            const base = lastSlash === -1 ? file_path : file_path.slice(lastSlash + 1);
            if (!byBasename.has(base))
                byBasename.set(base, []);
            byBasename.get(base).push(id);
        }
        for (const ids of byBasename.values()) {
            if (ids.length > 1) {
                for (const id of ids)
                    duplicateIds.add(id);
            }
        }
    }
    // ── Step 3: Cross-reference ──────────────────────────────────────────────
    const crossIds = [];
    for (const id of deadIds) {
        if (duplicateIds.has(id))
            crossIds.push(id);
    }
    // ── Step 4: Build findings ───────────────────────────────────────────────
    const findings = crossIds.map(id => {
        const node = deadById.get(id);
        return {
            crossRefType: 'dead+duplicate',
            nodeIds: [id],
            description: `File "${node.name}" is both unreachable (dead code) and structurally duplicated — highest-confidence safe-delete candidate.`,
            title: 'Unreachable duplicate file',
            severity: 'warning',
            nodeId: id,
            nodeName: node.name,
            filePath: node.file_path,
            actions: [
                {
                    type: 'delete',
                    file: node.file_path ?? undefined,
                    description: 'Safe to remove — file is both unreachable and duplicated',
                    confidence: 'high',
                },
            ],
        };
    });
    return {
        findings,
        deadCount: deadIds.size,
        duplicateCount: duplicateIds.size,
        crossCount: crossIds.length,
    };
}
/**
 * Format a CrossReferenceReport as structured text for LLM consumption.
 */
export function formatCrossReferenceReport(report) {
    const lines = [
        `Cross-reference analysis: dead code × structural duplicates`,
        `  Dead (unreachable) file nodes : ${report.deadCount}`,
        `  Duplicated file nodes         : ${report.duplicateCount}`,
        `  Both dead AND duplicated      : ${report.crossCount}  (highest-confidence safe-delete candidates)`,
    ];
    if (report.crossCount === 0) {
        lines.push('  No cross-referenced candidates found.');
        return lines.join('\n');
    }
    lines.push('');
    lines.push('Safe-delete candidates:');
    for (const f of report.findings) {
        const loc = f.filePath ? `  ${f.filePath}` : `  (no path) ${f.nodeName}`;
        lines.push(loc);
        lines.push(`    ${f.description}`);
    }
    return lines.join('\n');
}
//# sourceMappingURL=cross-reference.js.map