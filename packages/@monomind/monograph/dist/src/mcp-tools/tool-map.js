// ── Implementation ─────────────────────────────────────────────────────────────
export function getToolMap(db, options) {
    const toolFilter = options?.tool ?? null;
    const rows = db
        .prepare(`SELECT t.id, t.name, t.properties, t.file_path,
              h.name as handler_name, h.file_path as handler_file, h.start_line as handler_line
       FROM nodes t
       LEFT JOIN edges e ON e.source_id = t.id AND e.relation = 'HANDLES_TOOL'
       LEFT JOIN nodes h ON h.id = e.target_id
       WHERE t.label = 'Tool'
       AND (? IS NULL OR t.name LIKE '%' || ? || '%')
       ORDER BY t.name
       LIMIT 100`)
        .all(toolFilter, toolFilter);
    return rows.map((row) => {
        let description = null;
        if (row.properties) {
            try {
                const props = JSON.parse(row.properties);
                description = typeof props['description'] === 'string' ? props['description'] : null;
            }
            catch {
                // ignore malformed JSON
            }
        }
        return {
            id: row.id,
            name: row.name,
            description,
            filePath: row.file_path ?? null,
            handlerName: row.handler_name ?? null,
            handlerFile: row.handler_file ?? null,
            handlerLine: row.handler_line ?? null,
        };
    });
}
//# sourceMappingURL=tool-map.js.map