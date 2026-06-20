export function detectPrivateTypeLeaks(db) {
    const rows = db.prepare(`
    SELECT e.source_id, e.target_id,
           n1.name as src_name, n1.file_path as src_path, n1.start_line as src_line,
           n2.name as tgt_name, n2.file_path as tgt_path, n2.start_line as tgt_line
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
            exportStartLine: row.src_line ?? null,
            leakedTypeNodeId: row.target_id,
            leakedTypeName: row.tgt_name,
            leakedTypeFilePath: row.tgt_path,
            leakedTypeStartLine: row.tgt_line ?? null,
            reason: `Exported symbol ${row.src_name} references non-exported ${row.tgt_name} from another community`,
        });
    }
    return {
        leaks,
        totalLeaks: leaks.length,
        affectedExports: affectedExportIds.size,
    };
}
/** Format PrivateTypeLeaksResult as structured text with file:line hints for LLM navigation. */
export function formatPrivateTypeLeaks(result) {
    if (result.totalLeaks === 0) {
        return 'Private type leaks: none detected.';
    }
    const lines = [
        `Private type leaks: ${result.totalLeaks} leak(s) across ${result.affectedExports} exported symbol(s).`,
        '',
    ];
    // Group leaks by exporting file for compact display
    const byFile = new Map();
    for (const leak of result.leaks) {
        const key = leak.exportFilePath ?? '(unknown)';
        let group = byFile.get(key);
        if (!group) {
            group = [];
            byFile.set(key, group);
        }
        group.push(leak);
    }
    for (const [filePath, fileLeaks] of byFile) {
        lines.push(`File: ${filePath}`);
        for (const leak of fileLeaks) {
            const exportRef = leak.exportStartLine != null
                ? `${filePath}:${leak.exportStartLine}`
                : filePath;
            const leakRef = leak.leakedTypeFilePath
                ? leak.leakedTypeStartLine != null
                    ? `${leak.leakedTypeFilePath}:${leak.leakedTypeStartLine}`
                    : leak.leakedTypeFilePath
                : '(unknown)';
            lines.push(`  ${leak.exportName} (${exportRef}) → leaks ${leak.leakedTypeName} (${leakRef})`);
        }
        lines.push('');
    }
    lines.push(`Fix: make leaked types public, move them to a shared module, or restructure community boundaries.`);
    return lines.join('\n').trimEnd();
}
//# sourceMappingURL=private-type-leaks.js.map