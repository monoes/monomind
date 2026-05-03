import type { MonographDb } from '../storage/db.js';

export interface DuplicateExportGroup {
  exportName: string;
  locations: Array<{ nodeId: string; filePath: string | null; label: string }>;
  count: number;
}

export interface DuplicateExportsResult {
  groups: DuplicateExportGroup[];
  totalDuplicates: number;
  affectedFiles: number;
}

interface ExportedRow {
  id: string;
  name: string;
  file_path: string | null;
  label: string;
}

/** Generic names that are too common to be meaningful duplicates. */
const GENERIC_NAMES = new Set(['default', 'index', 'module']);

export function detectDuplicateExports(db: MonographDb): DuplicateExportsResult {
  const rows = db.prepare(
    `SELECT id, name, file_path, label
     FROM nodes
     WHERE is_exported = 1
       AND label IN ('Function','Class','Method','Interface','Const','TypeAlias','Enum','Variable')`
  ).all() as ExportedRow[];

  // Group by normalized name
  const groups = new Map<string, Array<{ nodeId: string; filePath: string | null; label: string }>>();

  for (const row of rows) {
    const normalized = row.name.toLowerCase().trim();
    if (GENERIC_NAMES.has(normalized)) continue;

    let list = groups.get(normalized);
    if (!list) {
      list = [];
      groups.set(normalized, list);
    }
    list.push({ nodeId: row.id, filePath: row.file_path, label: row.label });
  }

  // Filter to duplicates only (count > 1)
  const duplicateGroups: DuplicateExportGroup[] = [];
  const affectedFileSet = new Set<string>();

  for (const [name, locations] of groups) {
    if (locations.length <= 1) continue;

    duplicateGroups.push({
      exportName: name,
      locations,
      count: locations.length,
    });

    for (const loc of locations) {
      if (loc.filePath) affectedFileSet.add(loc.filePath);
    }
  }

  // Sort by count descending
  duplicateGroups.sort((a, b) => b.count - a.count);

  return {
    groups: duplicateGroups,
    totalDuplicates: duplicateGroups.length,
    affectedFiles: affectedFileSet.size,
  };
}
