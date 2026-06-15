import { readFileSync, statSync } from 'fs';
import type Database from 'better-sqlite3';
import type { MonographNode } from '../types.js';

// ── Row → MonographNode mapper ─────────────────────────────────────────────────

function rowToNode(row: Record<string, unknown>): MonographNode {
  return {
    id: row.id as string,
    label: row.label as MonographNode['label'],
    name: row.name as string,
    normLabel: row.norm_label as string,
    filePath: row.file_path as string | undefined,
    startLine: row.start_line as number | undefined,
    endLine: row.end_line as number | undefined,
    communityId: row.community_id as number | undefined,
    isExported: (row.is_exported as number) === 1,
    language: row.language as string | undefined,
    properties: row.properties ? JSON.parse(row.properties as string) : undefined,
  };
}

// ── Output type ────────────────────────────────────────────────────────────────

export interface MonographRenameResult {
  symbol: MonographNode | null;
  referencingFiles: string[];
  changes: Array<{ file: string; line: number; before: string; after: string }>;
  error?: string;
}

// ── Implementation ─────────────────────────────────────────────────────────────

export function getMonographRename(
  db: Database.Database,
  input: { oldName: string; newName: string; filePath?: string; dryRun?: boolean },
): MonographRenameResult {
  // Find the canonical node
  let nodeRow: Record<string, unknown> | undefined;
  if (input.filePath) {
    nodeRow = db
      .prepare('SELECT * FROM nodes WHERE name = ? AND file_path = ? LIMIT 1')
      .get(input.oldName, input.filePath) as Record<string, unknown> | undefined;
  } else {
    nodeRow = db
      .prepare('SELECT * FROM nodes WHERE name = ? LIMIT 1')
      .get(input.oldName) as Record<string, unknown> | undefined;
  }

  if (!nodeRow) {
    return { symbol: null, referencingFiles: [], changes: [] };
  }

  const symbol = rowToNode(nodeRow);
  const nodeId = symbol.id;

  // Find all nodes with CALLS or IMPORTS edges pointing to this node
  const referencingRows = db
    .prepare(
      `SELECT DISTINCT n.id, n.file_path, n.start_line FROM nodes n
       JOIN edges e ON n.id = e.source_id
       WHERE e.target_id = ? AND e.relation IN ('CALLS', 'IMPORTS')
       AND n.file_path IS NOT NULL`,
    )
    .all(nodeId) as Array<{ id: string; file_path: string; start_line: number | null }>;

  const referencingFiles = [...new Set(referencingRows.map(r => r.file_path))];

  // Build changes list by reading source files
  const changes: Array<{ file: string; line: number; before: string; after: string }> = [];
  // Two separate regexes: testRe has no `g` flag (safe for repeated test()), replaceRe has `g`
  const testRe = new RegExp(`\\b${escapeRegExp(input.oldName)}\\b`);
  const replaceRe = new RegExp(`\\b${escapeRegExp(input.oldName)}\\b`, 'g');
  const MAX_FILE_BYTES = 1_048_576; // 1 MiB guard

  // File line cache to avoid re-reading the same file multiple times
  const fileLineCache = new Map<string, string[]>();

  const getLines = (filePath: string): string[] => {
    if (fileLineCache.has(filePath)) return fileLineCache.get(filePath)!;
    try {
      const st = statSync(filePath);
      if (st.size > MAX_FILE_BYTES) { fileLineCache.set(filePath, []); return []; }
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      fileLineCache.set(filePath, lines);
      return lines;
    } catch {
      fileLineCache.set(filePath, []);
      return [];
    }
  };

  for (const row of referencingRows) {
    if (!row.file_path || row.start_line == null) continue;

    const lines = getLines(row.file_path);
    const lineIdx = row.start_line - 1; // convert 1-based to 0-based
    if (lineIdx < 0 || lineIdx >= lines.length) continue;

    const originalLine = lines[lineIdx];
    if (!testRe.test(originalLine)) continue;

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

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
