import type Database from 'better-sqlite3';

export interface UnlinkedReference {
  sourceId: string;
  sourceName: string;
  sourceFilePath: string | null;
  sourceLabel: string;
  targetName: string;   // the symbol that was mentioned
  mentionContext: string | null; // snippet of where it was mentioned (from properties.summary)
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Find nodes that mention a target symbol by name in their metadata
 * (summary, file_path, norm_label) but have no explicit edge to any node
 * with that name. These are "mentioned but not linked" — latent coupling.
 *
 * @param db - open monograph database
 * @param targetName - symbol name to search for (e.g. "UserService")
 * @param options.limit - max results (default 50)
 * @param options.excludeSourceId - skip this node id (avoid self-match)
 */
export function findUnlinkedReferences(
  db: Database.Database,
  targetName: string,
  options: { limit?: number; excludeSourceId?: string } = {},
): UnlinkedReference[] {
  const limit = options.limit ?? 50;
  const excludeSourceId = options.excludeSourceId ?? '';
  const pattern = `%${targetName}%`;

  // Step 1: Find all node IDs that already have an explicit edge to any node
  // whose name matches targetName — these are "already linked" and excluded.
  const linkedRows = db.prepare(`
    SELECT DISTINCT e.source_id FROM edges e
    JOIN nodes n ON n.id = e.target_id
    WHERE n.name = ?
  `).all(targetName) as { source_id: string }[];

  const linkedIds = new Set(linkedRows.map(r => r.source_id));

  // Step 2: Find nodes that mention targetName in name, norm_label, or
  // properties JSON — but are NOT in the linked set and not self.
  const rows = db.prepare(`
    SELECT n.id, n.name, n.file_path, n.label, n.properties
    FROM nodes n
    WHERE (
      n.name LIKE ? OR
      n.norm_label LIKE ? OR
      (n.properties IS NOT NULL AND n.properties LIKE ?)
    )
    AND n.name != ?
    LIMIT ?
  `).all(pattern, pattern, pattern, targetName, limit * 4) as Array<{
    id: string;
    name: string;
    file_path: string | null;
    label: string;
    properties: string | null;
  }>;

  const results: UnlinkedReference[] = [];

  for (const row of rows) {
    // Skip nodes that already have an explicit edge to the target
    if (linkedIds.has(row.id)) continue;
    // Skip the excluded node (e.g. the target node itself)
    if (excludeSourceId && row.id === excludeSourceId) continue;

    // Determine confidence and extract mention context
    let confidence: 'high' | 'medium' | 'low';
    let mentionContext: string | null = null;

    if (row.name.includes(targetName)) {
      // Target name appears in the symbol's own name
      confidence = 'high';
    } else if (row.file_path !== null && row.file_path.includes(targetName)) {
      // Appears in the file path
      confidence = 'medium';
    } else {
      // Only in properties.summary
      confidence = 'low';
    }

    // Extract a 100-char context window from properties.summary if available
    if (row.properties !== null) {
      try {
        const props = JSON.parse(row.properties) as Record<string, unknown>;
        const summary = typeof props['summary'] === 'string' ? props['summary'] : null;
        if (summary !== null && summary.includes(targetName)) {
          const idx = summary.indexOf(targetName);
          const start = Math.max(0, idx - 50);
          const end = Math.min(summary.length, idx + targetName.length + 50);
          mentionContext = summary.slice(start, end);
          // Refine confidence: if we previously set 'low' due to no name/path match,
          // and properties match confirms it, keep 'low'. Otherwise stay as-is.
        }
      } catch {
        // Malformed JSON — skip
      }
    }

    results.push({
      sourceId: row.id,
      sourceName: row.name,
      sourceFilePath: row.file_path,
      sourceLabel: row.label,
      targetName,
      mentionContext,
      confidence,
    });

    if (results.length >= limit) break;
  }

  return results;
}
