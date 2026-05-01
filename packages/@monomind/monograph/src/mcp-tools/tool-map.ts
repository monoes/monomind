import type Database from 'better-sqlite3';

// ── Output types ───────────────────────────────────────────────────────────────

export interface ToolEntry {
  id: string;
  name: string;
  description: string | null;
  filePath: string | null;
  handlerName: string | null;
  handlerFile: string | null;
  handlerLine: number | null;
}

// ── Implementation ─────────────────────────────────────────────────────────────

export function getToolMap(
  db: Database.Database,
  options?: { tool?: string },
): ToolEntry[] {
  const toolFilter = options?.tool ?? null;

  const rows = db
    .prepare(
      `SELECT t.id, t.name, t.properties, t.file_path,
              h.name as handler_name, h.file_path as handler_file, h.start_line as handler_line
       FROM nodes t
       LEFT JOIN edges e ON e.source_id = t.id AND e.relation = 'HANDLES_TOOL'
       LEFT JOIN nodes h ON h.id = e.target_id
       WHERE t.label = 'Tool'
       AND (? IS NULL OR t.name LIKE '%' || ? || '%')
       ORDER BY t.name
       LIMIT 100`,
    )
    .all(toolFilter, toolFilter) as Array<{
    id: string;
    name: string;
    properties: string | null;
    file_path: string | null;
    handler_name: string | null;
    handler_file: string | null;
    handler_line: number | null;
  }>;

  return rows.map((row) => {
    let description: string | null = null;
    if (row.properties) {
      try {
        const props = JSON.parse(row.properties) as Record<string, unknown>;
        description = typeof props['description'] === 'string' ? props['description'] : null;
      } catch {
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
