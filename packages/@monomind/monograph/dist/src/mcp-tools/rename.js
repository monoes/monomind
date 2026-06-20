import { readFileSync, statSync } from 'fs';
// ── Row → MonographNode mapper ─────────────────────────────────────────────────
function rowToNode(row) {
    return {
        id: row.id,
        label: row.label,
        name: row.name,
        normLabel: row.norm_label,
        filePath: row.file_path,
        startLine: row.start_line,
        endLine: row.end_line,
        communityId: row.community_id,
        isExported: row.is_exported === 1,
        language: row.language,
        properties: row.properties ? JSON.parse(row.properties) : undefined,
    };
}
// ── Implementation ─────────────────────────────────────────────────────────────
export function getMonographRename(db, input) {
    // Find the canonical node
    let nodeRow;
    if (input.filePath) {
        nodeRow = db
            .prepare('SELECT * FROM nodes WHERE name = ? AND file_path = ? LIMIT 1')
            .get(input.oldName, input.filePath);
    }
    else {
        nodeRow = db
            .prepare('SELECT * FROM nodes WHERE name = ? LIMIT 1')
            .get(input.oldName);
    }
    if (!nodeRow) {
        return { symbol: null, referencingFiles: [], changes: [] };
    }
    const symbol = rowToNode(nodeRow);
    const nodeId = symbol.id;
    // Find all nodes with CALLS or IMPORTS edges pointing to this node
    const referencingRows = db
        .prepare(`SELECT DISTINCT n.id, n.file_path, n.start_line FROM nodes n
       JOIN edges e ON n.id = e.source_id
       WHERE e.target_id = ? AND e.relation IN ('CALLS', 'IMPORTS')
       AND n.file_path IS NOT NULL`)
        .all(nodeId);
    const referencingFiles = [...new Set(referencingRows.map(r => r.file_path))];
    // Build changes list by reading source files
    const changes = [];
    // Two separate regexes: testRe has no `g` flag (safe for repeated test()), replaceRe has `g`
    const testRe = new RegExp(`\\b${escapeRegExp(input.oldName)}\\b`);
    const replaceRe = new RegExp(`\\b${escapeRegExp(input.oldName)}\\b`, 'g');
    const MAX_FILE_BYTES = 1_048_576; // 1 MiB guard
    // File line cache to avoid re-reading the same file multiple times
    const fileLineCache = new Map();
    const getLines = (filePath) => {
        if (fileLineCache.has(filePath))
            return fileLineCache.get(filePath);
        try {
            const st = statSync(filePath);
            if (st.size > MAX_FILE_BYTES) {
                fileLineCache.set(filePath, []);
                return [];
            }
            const content = readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');
            fileLineCache.set(filePath, lines);
            return lines;
        }
        catch {
            fileLineCache.set(filePath, []);
            return [];
        }
    };
    for (const row of referencingRows) {
        if (!row.file_path || row.start_line == null)
            continue;
        const lines = getLines(row.file_path);
        const lineIdx = row.start_line - 1; // convert 1-based to 0-based
        if (lineIdx < 0 || lineIdx >= lines.length)
            continue;
        const originalLine = lines[lineIdx];
        if (!testRe.test(originalLine))
            continue;
        const updatedLine = originalLine.replace(replaceRe, input.newName);
        changes.push({
            file: row.file_path,
            line: row.start_line,
            before: originalLine,
            after: updatedLine,
        });
    }
    return { symbol, referencingFiles, changes };
}
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
//# sourceMappingURL=rename.js.map