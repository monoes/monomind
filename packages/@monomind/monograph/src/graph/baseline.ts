import type Database from 'better-sqlite3';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface BaselineFinding {
  /** Stable identifier: e.g. "file:src/foo.ts:export:bar" or "community:12:orphan" */
  key: string;
  type: 'unreachable_export' | 'isolated_node' | 'ambiguous_edge' | 'bridge_node' | 'surprise' | 'god_node' | 'other';
  nodeId: string;
  nodeName: string;
  filePath: string | null;
  savedAt: string; // ISO timestamp
}

export interface BaselineData {
  version: 1;
  savedAt: string;
  projectPath: string;
  findings: BaselineFinding[];
}

export interface ComparedFinding extends BaselineFinding {
  introduced: boolean; // true = new in this run, not in baseline
}

/**
 * Save the current set of findings as a baseline JSON file.
 * @param baselinePath - path to write (e.g. .monomind/baseline.json)
 * @param findings - current findings to persist
 * @param projectPath - repo path for identification
 */
export function saveBaseline(
  baselinePath: string,
  findings: BaselineFinding[],
  projectPath: string,
): void {
  const data: BaselineData = {
    version: 1,
    savedAt: new Date().toISOString(),
    projectPath,
    findings,
  };
  writeFileSync(baselinePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Load an existing baseline file.
 */
export function loadBaseline(baselinePath: string): BaselineData | null {
  if (!existsSync(baselinePath)) return null;
  try {
    return JSON.parse(readFileSync(baselinePath, 'utf-8')) as BaselineData;
  } catch {
    return null;
  }
}

/**
 * Compare a list of current findings against a baseline.
 * Returns each finding annotated with introduced:true/false.
 */
export function compareWithBaseline(
  currentFindings: BaselineFinding[],
  baseline: BaselineData | null,
): ComparedFinding[] {
  if (!baseline) {
    // No baseline — all findings are "introduced"
    return currentFindings.map(f => ({ ...f, introduced: true }));
  }
  const baselineKeys = new Set(baseline.findings.map(f => f.key));
  return currentFindings.map(f => ({
    ...f,
    introduced: !baselineKeys.has(f.key),
  }));
}

/**
 * Extract findings from the database to build a baseline.
 * Collects: isolated nodes (no edges), nodes with only INFERRED edges,
 * god nodes (degree > 50).
 */
export function extractFindingsFromDb(
  db: Database.Database,
  projectPath: string,
): BaselineFinding[] {
  const findings: BaselineFinding[] = [];

  // Isolated nodes (no incoming or outgoing edges)
  const isolated = db.prepare(`
    SELECT n.id, n.name, n.file_path, n.label
    FROM nodes n
    WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.source_id = n.id OR e.target_id = n.id)
    AND n.label IN ('Function', 'Class', 'Method', 'Interface', 'Variable', 'Module', 'File')
    LIMIT 500
  `).all() as { id: string; name: string; file_path: string | null; label: string }[];

  for (const n of isolated) {
    findings.push({
      key: `isolated:${n.file_path ?? n.id}:${n.name}`,
      type: 'isolated_node',
      nodeId: n.id,
      nodeName: n.name,
      filePath: n.file_path,
      savedAt: new Date().toISOString(),
    });
  }

  // God nodes (degree > 50)
  const gods = db.prepare(`
    SELECT n.id, n.name, n.file_path,
           COUNT(DISTINCT e1.id) + COUNT(DISTINCT e2.id) as degree
    FROM nodes n
    LEFT JOIN edges e1 ON e1.source_id = n.id
    LEFT JOIN edges e2 ON e2.target_id = n.id
    GROUP BY n.id
    HAVING degree > 50
    ORDER BY degree DESC
    LIMIT 100
  `).all() as { id: string; name: string; file_path: string | null; degree: number }[];

  for (const n of gods) {
    findings.push({
      key: `god_node:${n.file_path ?? n.id}:${n.name}`,
      type: 'god_node',
      nodeId: n.id,
      nodeName: n.name,
      filePath: n.file_path,
      savedAt: new Date().toISOString(),
    });
  }

  return findings;
}

/** Default baseline path relative to a project directory */
export function defaultBaselinePath(projectDir: string): string {
  return join(projectDir, '.monomind', 'baseline.json');
}
