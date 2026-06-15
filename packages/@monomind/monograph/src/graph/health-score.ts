import type Database from 'better-sqlite3';

export interface HealthScorePenalties {
  unreachableFilePct: number;   // % of file nodes unreachable
  godNodePct: number;           // % of nodes that are god nodes (degree > p95)
  circularEdgePct: number;      // % of edges that form cycles
  hotspotPct: number;           // % of files with churnScore > 0.5
  isolatedNodePct: number;      // % of nodes with degree 0
  crossCommunityEdgePct: number; // % of edges crossing community boundaries
}

export interface HealthScoreResult {
  score: number;       // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  penalties: HealthScorePenalties;
  summary: string;
}

export function letterGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

export function computeHealthScore(db: Database.Database): HealthScoreResult {
  // ── Total file nodes ──────────────────────────────────────────────────────
  const totalFilesRow = db.prepare(
    "SELECT COUNT(*) as c FROM nodes WHERE label = 'File'"
  ).get() as { c: number };
  const totalFiles = totalFilesRow.c;

  // ── Unreachable file nodes ────────────────────────────────────────────────
  const unreachableRow = db.prepare(
    "SELECT COUNT(*) as c FROM nodes WHERE label = 'File' AND properties LIKE '%\"unreachable\"%'"
  ).get() as { c: number };
  const unreachableFiles = unreachableRow.c;

  // ── Total nodes ───────────────────────────────────────────────────────────
  const totalNodesRow = db.prepare('SELECT COUNT(*) as c FROM nodes').get() as { c: number };
  const totalNodes = totalNodesRow.c;

  // ── p95 degree (god nodes) ────────────────────────────────────────────────
  const degreesRows = db.prepare(`
    SELECT source_id as node_id, COUNT(*) as deg FROM edges GROUP BY source_id
    UNION ALL
    SELECT target_id as node_id, COUNT(*) as deg FROM edges GROUP BY target_id
  `).all() as { node_id: string; deg: number }[];

  // Sum degrees per node
  const degMap = new Map<string, number>();
  for (const row of degreesRows) {
    degMap.set(row.node_id, (degMap.get(row.node_id) ?? 0) + row.deg);
  }
  const degrees = [...degMap.values()].sort((a, b) => a - b);
  const p95Index = Math.floor(degrees.length * 0.95);
  const p95Degree = degrees[p95Index] ?? 0;

  const godNodeCount = p95Degree > 0
    ? [...degMap.values()].filter(d => d > p95Degree).length
    : 0;

  // ── Circular edges (bidirectional import pairs) ───────────────────────────
  const totalEdgesRow = db.prepare('SELECT COUNT(*) as c FROM edges').get() as { c: number };
  const totalEdges = totalEdgesRow.c;

  const circularRow = db.prepare(`
    SELECT COUNT(*) as c FROM edges e1
    JOIN edges e2 ON e1.source_id = e2.target_id AND e1.target_id = e2.source_id
    WHERE e1.relation = 'IMPORTS' AND e2.relation = 'IMPORTS'
      AND e1.source_id < e1.target_id
  `).get() as { c: number };
  // Each circular pair is counted once; each pair has 2 edges contributing
  const circularEdges = circularRow.c * 2;

  // ── Hotspot files (churnScore > 0.5 in properties) ───────────────────────
  // Push the numeric filter into SQLite via json_extract() — avoids O(N) JS JSON.parse loop
  const hotspotRow = db.prepare(`
    SELECT COUNT(*) as c FROM nodes
    WHERE label = 'File'
      AND CAST(json_extract(properties, '$.churnScore') AS REAL) > 0.5
  `).get() as { c: number };
  const hotspotCount = hotspotRow.c;

  // ── Isolated nodes (degree = 0) ───────────────────────────────────────────
  const isolatedRow = db.prepare(`
    SELECT COUNT(*) as c FROM nodes n
    WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.source_id = n.id OR e.target_id = n.id)
  `).get() as { c: number };
  const isolatedNodes = isolatedRow.c;

  // ── Cross-community edges ─────────────────────────────────────────────────
  const crossCommRow = db.prepare(`
    SELECT COUNT(*) as c FROM edges e
    JOIN nodes n1 ON n1.id = e.source_id
    JOIN nodes n2 ON n2.id = e.target_id
    WHERE n1.community_id IS NOT NULL
      AND n2.community_id IS NOT NULL
      AND n1.community_id != n2.community_id
  `).get() as { c: number };
  const crossCommunityEdges = crossCommRow.c;

  // ── Compute percentages ───────────────────────────────────────────────────
  const pct = (count: number, total: number): number =>
    total > 0 ? (count / total) * 100 : 0;

  const penalties: HealthScorePenalties = {
    unreachableFilePct: pct(unreachableFiles, totalFiles),
    godNodePct: pct(godNodeCount, totalNodes),
    circularEdgePct: pct(circularEdges, totalEdges),
    hotspotPct: pct(hotspotCount, totalFiles),
    isolatedNodePct: pct(isolatedNodes, totalNodes),
    crossCommunityEdgePct: pct(crossCommunityEdges, totalEdges),
  };

  // ── Score formula ─────────────────────────────────────────────────────────
  let score = 100;
  score -= Math.min(penalties.unreachableFilePct * 0.25, 25);
  score -= Math.min(penalties.godNodePct * 0.20, 20);
  score -= Math.min(penalties.circularEdgePct * 0.20, 20);
  score -= Math.min(penalties.hotspotPct * 0.15, 15);
  score -= Math.min(penalties.isolatedNodePct * 0.10, 10);
  score -= Math.min(penalties.crossCommunityEdgePct * 0.10, 10);
  score = Math.max(0, Math.round(score * 10) / 10);

  const grade = letterGrade(score);

  const fmt = (pct: number, penalty: number) => `${pct.toFixed(1)}% (-${penalty.toFixed(1)})`;
  const summary = [
    `Grade: ${grade} (score: ${score}/100)`,
    `Penalties:`,
    `  unreachable files: ${fmt(penalties.unreachableFilePct, Math.min(penalties.unreachableFilePct * 0.25, 25))}`,
    `  god nodes: ${fmt(penalties.godNodePct, Math.min(penalties.godNodePct * 0.20, 20))}`,
    `  circular edges: ${fmt(penalties.circularEdgePct, Math.min(penalties.circularEdgePct * 0.20, 20))}`,
    `  hotspot files: ${fmt(penalties.hotspotPct, Math.min(penalties.hotspotPct * 0.15, 15))}`,
    `  isolated nodes: ${fmt(penalties.isolatedNodePct, Math.min(penalties.isolatedNodePct * 0.10, 10))}`,
    `  cross-community edges: ${fmt(penalties.crossCommunityEdgePct, Math.min(penalties.crossCommunityEdgePct * 0.10, 10))}`,
  ].join('\n');

  return { score, grade, penalties, summary };
}

/**
 * Format a HealthScoreResult as structured text for LLM navigation.
 * Provides a concise grade breakdown that an LLM can parse and act on.
 *
 * @param result - HealthScoreResult from computeHealthScore()
 * @returns structured text suitable for LLM consumption
 */
export function formatHealthScore(result: HealthScoreResult): string {
  const { score, grade, penalties } = result;

  const fmt = (val: number): string => val.toFixed(1);

  const lines: string[] = [
    `health_score: ${score}/100  grade: ${grade}`,
    '',
    'penalties:',
    `  unreachable_files:     ${fmt(penalties.unreachableFilePct)}%  (max -25)`,
    `  god_nodes:             ${fmt(penalties.godNodePct)}%  (max -20)`,
    `  circular_edges:        ${fmt(penalties.circularEdgePct)}%  (max -20)`,
    `  hotspot_files:         ${fmt(penalties.hotspotPct)}%  (max -15)`,
    `  isolated_nodes:        ${fmt(penalties.isolatedNodePct)}%  (max -10)`,
    `  cross_community_edges: ${fmt(penalties.crossCommunityEdgePct)}%  (max -10)`,
    '',
  ];

  // Actionable guidance for grades below B
  if (grade === 'F' || grade === 'D') {
    lines.push('action_required: yes');
    if (penalties.circularEdgePct > 5) lines.push('  - break circular import cycles (monograph_context for file dependencies)');
    if (penalties.godNodePct > 5) lines.push('  - split god nodes (monograph_god_nodes for candidates)');
    if (penalties.unreachableFilePct > 10) lines.push('  - investigate unreachable files (monograph_detect_changes to surface dead paths)');
  } else if (grade === 'C') {
    lines.push('action_suggested: yes');
    if (penalties.hotspotPct > 10) lines.push('  - reduce churn on hotspot files');
    if (penalties.isolatedNodePct > 10) lines.push('  - connect or remove isolated nodes');
  }

  return lines.join('\n');
}
