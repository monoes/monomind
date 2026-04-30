import type Database from 'better-sqlite3';

export interface FtsResult {
  id: string;
  name: string;
  normLabel: string;
  filePath: string | null;
  label: string;
  rank: number;
}

export function ftsSearch(
  db: Database.Database,
  query: string,
  limit: number,
  label?: string,
): FtsResult[] {
  // Clean and sanitize the query for FTS5
  const safeQuery = query.replace(/['"*]/g, ' ').trim();
  if (!safeQuery) return [];

  // Add wildcard for prefix matching
  const ftsPrefixQuery = safeQuery.split(/\s+/).map((term) => term + '*').join(' ');

  let sql = `
    SELECT n.id, n.name, n.norm_label, n.file_path, n.label,
           nodes_fts.rank
    FROM nodes_fts
    JOIN nodes n ON n.rowid = nodes_fts.rowid
    WHERE nodes_fts MATCH ?
  `;
  const params: unknown[] = [ftsPrefixQuery];
  if (label) {
    sql += ' AND n.label = ?';
    params.push(label);
  }
  sql += ' ORDER BY nodes_fts.rank LIMIT ?';
  params.push(limit);

  const rows = db.prepare(sql).all(...(params as [string, ...unknown[]])) as Record<
    string,
    unknown
  >[];
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    normLabel: r.norm_label as string,
    filePath: (r.file_path as string | null) ?? null,
    label: r.label as string,
    rank: r.rank as number,
  }));
}
