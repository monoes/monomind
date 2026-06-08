export function detectPrivateTypeLeaks(db) {
    const rows = db.prepare(`
    SELECT e.source_id, e.target_id, n1.name as src_name, n1.file_path as src_path,
           n2.name as tgt_name, n2.file_path as tgt_path
    FROM edges e
    JOIN nodes n1 ON n1.id = e.source_id
    JOIN nodes n2 ON n2.id = e.target_id
    WHERE e.relation IN ('IMPORTS', 'REFERENCES')
      AND n1.is_exported = 1
      AND n2.is_exported = 0
      AND n1.community_id != n2.community_id
      AND n1.community_id IS NOT NULL
      AND n2.community_id IS NOT NULL
    LIMIT 200
  `).all();
    // Deduplicate by (source_id, target_id) pair
    const seen = new Set();
    const leaks = [];
    const affectedExportIds = new Set();
    for (const row of rows) {
        const key = `${row.source_id}:${row.target_id}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        affectedExportIds.add(row.source_id);
        leaks.push({
            exportNodeId: row.source_id,
            exportName: row.src_name,
            exportFilePath: row.src_path,
            leakedTypeNodeId: row.target_id,
            leakedTypeName: row.tgt_name,
            leakedTypeFilePath: row.tgt_path,
            reason: `Exported symbol ${row.src_name} references non-exported ${row.tgt_name} from another community`,
        });
    }
    return {
        leaks,
        totalLeaks: leaks.length,
        affectedExports: affectedExportIds.size,
    };
}
//# sourceMappingURL=private-type-leaks.js.map