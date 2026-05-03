import type { MonographDb } from '../storage/db.js';

export interface MaintainabilityResult {
  nodeId: string;
  name: string;
  filePath: string | null;
  mi: number;          // Maintainability Index 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  halsteadVolume: number;   // proxy: node degree × log2(max(degree, 2))
  linesOfCode: number;
}

export interface MaintainabilityReport {
  results: MaintainabilityResult[];
  averageMi: number;
  lowMiCount: number;   // MI < 65
  criticalCount: number; // MI < 25
}

function gradeFromMi(mi: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (mi > 85) return 'A';
  if (mi > 65) return 'B';
  if (mi > 50) return 'C';
  if (mi > 25) return 'D';
  return 'F';
}

export function computeMaintainabilityIndex(db: MonographDb): MaintainabilityReport {
  // Fetch all Function and Method Symbol nodes
  const nodes = db.prepare(`
    SELECT id, name, file_path, start_line, end_line, properties
    FROM nodes
    WHERE label IN ('Function', 'Method', 'Symbol')
      AND start_line IS NOT NULL
      AND end_line IS NOT NULL
  `).all() as {
    id: string;
    name: string;
    file_path: string | null;
    start_line: number;
    end_line: number;
    properties: string | null;
  }[];

  if (nodes.length === 0) {
    return { results: [], averageMi: 100, lowMiCount: 0, criticalCount: 0 };
  }

  const results: MaintainabilityResult[] = [];

  for (const node of nodes) {
    const loc = Math.max(1, node.end_line - node.start_line + 1);

    // Count in/out degree from edges table
    const inDegreeRow = db.prepare(
      'SELECT COUNT(*) as c FROM edges WHERE target_id = ?'
    ).get(node.id) as { c: number };
    const outDegreeRow = db.prepare(
      'SELECT COUNT(*) as c FROM edges WHERE source_id = ?'
    ).get(node.id) as { c: number };

    const degree = inDegreeRow.c + outDegreeRow.c;
    const hvProxy = degree * Math.log2(Math.max(degree, 2));

    // Maintainability Index formula
    const rawMi = 171 - 5.2 * Math.log(hvProxy + 1) - 0.23 * (loc / 10) - 16.2 * Math.log(Math.max(1, loc));
    const mi = Math.max(0, Math.min(100, rawMi));

    const grade = gradeFromMi(mi);

    // Store maintainabilityIndex back on the node's properties
    const props = node.properties ? JSON.parse(node.properties) : {};
    props.maintainabilityIndex = mi;
    db.prepare('UPDATE nodes SET properties = ? WHERE id = ?').run(
      JSON.stringify(props),
      node.id
    );

    results.push({
      nodeId: node.id,
      name: node.name,
      filePath: node.file_path,
      mi: Math.round(mi * 100) / 100,
      grade,
      halsteadVolume: Math.round(hvProxy * 100) / 100,
      linesOfCode: loc,
    });
  }

  // Sort by MI ascending (worst first)
  results.sort((a, b) => a.mi - b.mi);

  const averageMi = results.length > 0
    ? results.reduce((sum, r) => sum + r.mi, 0) / results.length
    : 100;

  const lowMiCount = results.filter(r => r.mi < 65).length;
  const criticalCount = results.filter(r => r.mi < 25).length;

  return {
    results,
    averageMi: Math.round(averageMi * 100) / 100,
    lowMiCount,
    criticalCount,
  };
}
