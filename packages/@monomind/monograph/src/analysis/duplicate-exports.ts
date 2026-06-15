import type { MonographDb } from '../storage/db.js';

export interface DuplicateExportLocation {
  nodeId: string;
  filePath: string | null;
  startLine: number | null;
  label: string;
}

export interface DuplicateExportGroup {
  exportName: string;
  locations: DuplicateExportLocation[];
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
  start_line: number | null;
  label: string;
}

/** Generic names that are too common to be meaningful duplicates. */
const GENERIC_NAMES = new Set(['default', 'index', 'module']);

export function detectDuplicateExports(db: MonographDb): DuplicateExportsResult {
  const rows = db.prepare(
    `SELECT id, name, file_path, start_line, label
     FROM nodes
     WHERE is_exported = 1
       AND label IN ('Function','Class','Method','Interface','Const','TypeAlias','Enum','Variable')`
  ).all() as ExportedRow[];

  // Group by normalized name
  const groups = new Map<string, DuplicateExportLocation[]>();

  for (const row of rows) {
    const normalized = row.name.toLowerCase().trim();
    if (GENERIC_NAMES.has(normalized)) continue;

    let list = groups.get(normalized);
    if (!list) {
      list = [];
      groups.set(normalized, list);
    }
    list.push({ nodeId: row.id, filePath: row.file_path, startLine: row.start_line ?? null, label: row.label });
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

/** Format DuplicateExportsResult as structured text with file:line hints for LLM navigation. */
export function formatDuplicateExports(result: DuplicateExportsResult): string {
  if (result.totalDuplicates === 0) {
    return 'Duplicate exports: none detected.';
  }

  const lines: string[] = [
    `Duplicate exports: ${result.totalDuplicates} name(s) exported from multiple files (${result.affectedFiles} file(s) affected).`,
    '',
  ];

  for (const group of result.groups) {
    lines.push(`  ${group.exportName} (${group.count} locations):`);
    for (const loc of group.locations) {
      const ref = loc.filePath
        ? loc.startLine != null
          ? `${loc.filePath}:${loc.startLine}`
          : loc.filePath
        : '(unknown)';
      lines.push(`    ${loc.label}  ${ref}`);
    }
  }

  lines.push('');
  lines.push('Fix: consolidate duplicate exports into a single canonical location or rename to avoid conflicts.');
  return lines.join('\n').trimEnd();
}
