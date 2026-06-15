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

  // ── Batch degree lookup: one query replaces 2×N individual queries ────────
  // Combine in-degree and out-degree via UNION ALL + GROUP BY in a single pass.
  const degreeMap = new Map<string, number>();
  for (const { node_id, deg } of db.prepare(`
    SELECT node_id, SUM(cnt) as deg FROM (
      SELECT target_id AS node_id, COUNT(*) AS cnt FROM edges GROUP BY target_id
      UNION ALL
      SELECT source_id AS node_id, COUNT(*) AS cnt FROM edges GROUP BY source_id
    ) GROUP BY node_id
  `).all() as { node_id: string; deg: number }[]) {
    degreeMap.set(node_id, deg);
  }

  const results: MaintainabilityResult[] = [];
  const propUpdates: Array<{ id: string; props: string }> = [];

  for (const node of nodes) {
    const loc = Math.max(1, node.end_line - node.start_line + 1);
    const degree = degreeMap.get(node.id) ?? 0;
    const hvProxy = degree * Math.log2(Math.max(degree, 2));

    // Maintainability Index formula
    const rawMi = 171 - 5.2 * Math.log(hvProxy + 1) - 0.23 * (loc / 10) - 16.2 * Math.log(Math.max(1, loc));
    const mi = Math.max(0, Math.min(100, rawMi));
    const grade = gradeFromMi(mi);

    // Stage property update — batched below
    const props: Record<string, unknown> = node.properties ? JSON.parse(node.properties) : {};
    props.maintainabilityIndex = mi;
    propUpdates.push({ id: node.id, props: JSON.stringify(props) });

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

  // ── Batch UPDATE all property writes in one transaction ───────────────────
  const updateStmt = db.prepare('UPDATE nodes SET properties = ? WHERE id = ?');
  db.transaction((updates: typeof propUpdates) => {
    for (const { id, props } of updates) updateStmt.run(props, id);
  })(propUpdates);

  // Sort by MI ascending (worst first)
  results.sort((a, b) => a.mi - b.mi);

  const averageMi = results.length > 0
    ? results.reduce((sum, r) => sum + r.mi, 0) / results.length
    : 100;

  return {
    results,
    averageMi: Math.round(averageMi * 100) / 100,
    lowMiCount: results.filter(r => r.mi < 65).length,
    criticalCount: results.filter(r => r.mi < 25).length,
  };
}

/**
 * Format a MaintainabilityReport as structured text with file:line hints for LLM navigation.
 *
 * @param report - MaintainabilityReport from computeMaintainabilityIndex()
 * @param topN - number of worst files to list (default 10)
 * @returns structured text suitable for LLM consumption
 */
export function formatMaintainability(report: MaintainabilityReport, topN = 10): string {
  const { results, averageMi, lowMiCount, criticalCount } = report;

  if (results.length === 0) {
    return 'maintainability: no Function/Method/Symbol nodes with line info found\n';
  }

  const lines: string[] = [
    `maintainability: ${results.length} nodes analysed`,
    `  avg_mi: ${averageMi}  low(mi<65): ${lowMiCount}  critical(mi<25): ${criticalCount}`,
    '',
  ];

  // results already sorted by MI ascending (worst first)
  const worst = results.slice(0, topN);
  if (worst.length > 0) {
    lines.push(`top_${topN}_worst_mi:`);
    for (const r of worst) {
      const loc = r.filePath ? `${r.filePath}:1` : `<unknown>:1`;
      lines.push(`  - ${r.name}  grade:${r.grade}  mi:${r.mi}`);
      lines.push(`    file: ${loc}`);
      lines.push(`    loc: ${r.linesOfCode}  halstead_vol: ${r.halsteadVolume}`);
    }
    lines.push('');
  }

  const critical = results.filter(r => r.mi < 25);
  if (critical.length > 0) {
    lines.push(`critical_nodes(mi<25): ${critical.length}`);
    for (const r of critical.slice(0, 5)) {
      const loc = r.filePath ? `${r.filePath}:1` : `<unknown>:1`;
      lines.push(`  - ${r.name}  file: ${loc}  mi:${r.mi}  grade:${r.grade}`);
    }
    if (critical.length > 5) lines.push(`  ... and ${critical.length - 5} more`);
  }

  return lines.join('\n');
}
