import type Database from 'better-sqlite3';

// Per-DB prepared statement cache to avoid re-parsing SQL on repeated calls
const stmtCache = new WeakMap<Database.Database, Map<string, Database.Statement>>();

function stmt(db: Database.Database, sql: string): Database.Statement {
  let dbCache = stmtCache.get(db);
  if (!dbCache) { dbCache = new Map(); stmtCache.set(db, dbCache); }
  let s = dbCache.get(sql);
  if (!s) { s = db.prepare(sql); dbCache.set(sql, s); }
  return s;
}

/** Binary search: returns index of first element > value in a sorted ascending array. */
function upperBound(sorted: number[], value: number): number {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export type RiskBin = 'low' | 'medium' | 'high' | 'critical';

export interface RiskProfile {
  low: number;
  medium: number;
  high: number;
  critical: number;
  lowPct: number;
  mediumPct: number;
  highPct: number;
  criticalPct: number;
}

export interface CouplingProfile {
  p50FanIn: number;
  p75FanIn: number;
  p90FanIn: number;
  p95FanIn: number;
  couplingHighPct: number;
  fanInProfile: RiskProfile;
  fanOutProfile: RiskProfile;
  totalFiles: number;
}

export interface GraphStatsSummary {
  nodeCount: number;
  edgeCount: number;
  communityCount: number;
  fileCount: number;
  couplingProfile: CouplingProfile;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function buildRiskProfile(values: number[]): RiskProfile {
  const total = values.length;
  let low = 0, medium = 0, high = 0, critical = 0;
  for (const v of values) {
    if (v < 5) low++;
    else if (v <= 15) medium++;
    else if (v <= 30) high++;
    else critical++;
  }
  const pct = (n: number) => total > 0 ? Math.round((n / total) * 100) : 0;
  return {
    low,
    medium,
    high,
    critical,
    lowPct: pct(low),
    mediumPct: pct(medium),
    highPct: pct(high),
    criticalPct: pct(critical),
  };
}

/**
 * Compute full coupling profile from SQLite.
 */
export function computeCouplingProfile(db: Database.Database): CouplingProfile {
  const fanInRows = stmt(db, 'SELECT target_id, COUNT(*) as c FROM edges GROUP BY target_id')
    .all() as { target_id: string; c: number }[];

  const fanOutRows = stmt(db, 'SELECT source_id, COUNT(*) as c FROM edges GROUP BY source_id')
    .all() as { source_id: string; c: number }[];

  const totalFiles = (stmt(db, "SELECT COUNT(*) as n FROM nodes WHERE label = 'File'")
    .get() as { n: number }).n;

  const fanInValues = fanInRows.map(r => r.c).sort((a, b) => a - b);
  const fanOutValues = fanOutRows.map(r => r.c).sort((a, b) => a - b);

  const p95FanIn = percentile(fanInValues, 95);
  // Use binary search instead of O(N) filter to count elements above p95 threshold
  const couplingHighCount = fanInValues.length - upperBound(fanInValues, p95FanIn);
  const couplingHighPct = fanInValues.length > 0
    ? Math.round((couplingHighCount / fanInValues.length) * 100)
    : 0;

  return {
    p50FanIn: percentile(fanInValues, 50),
    p75FanIn: percentile(fanInValues, 75),
    p90FanIn: percentile(fanInValues, 90),
    p95FanIn,
    couplingHighPct,
    fanInProfile: buildRiskProfile(fanInValues),
    fanOutProfile: buildRiskProfile(fanOutValues),
    totalFiles,
  };
}

/**
 * Quick stats summary (extends existing stats from monograph_stats MCP tool).
 */
export function computeGraphStats(db: Database.Database): GraphStatsSummary {
  const nodeCount = (stmt(db, 'SELECT COUNT(*) as n FROM nodes').get() as { n: number }).n;
  const edgeCount = (stmt(db, 'SELECT COUNT(*) as n FROM edges').get() as { n: number }).n;
  const communityCount = (stmt(db,
    "SELECT COUNT(DISTINCT community_id) as n FROM nodes WHERE community_id IS NOT NULL"
  ).get() as { n: number }).n;
  const fileCount = (stmt(db, "SELECT COUNT(*) as n FROM nodes WHERE label = 'File'")
    .get() as { n: number }).n;

  const couplingProfile = computeCouplingProfile(db);

  return {
    nodeCount,
    edgeCount,
    communityCount,
    fileCount,
    couplingProfile,
  };
}

/** Format a GraphStatsSummary as structured text for LLM consumption. */
export function formatGraphStats(s: GraphStatsSummary): string {
  const cp = s.couplingProfile;
  const lines: string[] = [
    `Graph Stats`,
    `  Nodes: ${s.nodeCount}  Edges: ${s.edgeCount}  Communities: ${s.communityCount}  Files: ${s.fileCount}`,
    `Coupling Profile (${cp.totalFiles} files)`,
    `  Fan-in p50/p75/p90/p95: ${cp.p50FanIn}/${cp.p75FanIn}/${cp.p90FanIn}/${cp.p95FanIn}`,
    `  High-coupling (>p95): ${cp.couplingHighPct}%`,
    `Fan-in Risk: low=${cp.fanInProfile.low}(${cp.fanInProfile.lowPct}%) med=${cp.fanInProfile.medium}(${cp.fanInProfile.mediumPct}%) high=${cp.fanInProfile.high}(${cp.fanInProfile.highPct}%) crit=${cp.fanInProfile.critical}(${cp.fanInProfile.criticalPct}%)`,
    `Fan-out Risk: low=${cp.fanOutProfile.low}(${cp.fanOutProfile.lowPct}%) med=${cp.fanOutProfile.medium}(${cp.fanOutProfile.mediumPct}%) high=${cp.fanOutProfile.high}(${cp.fanOutProfile.highPct}%) crit=${cp.fanOutProfile.critical}(${cp.fanOutProfile.criticalPct}%)`,
  ];
  return lines.join('\n');
}
