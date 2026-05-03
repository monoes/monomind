import type Database from 'better-sqlite3';

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
  const fanInRows = db.prepare(
    'SELECT target_id, COUNT(*) as c FROM edges GROUP BY target_id'
  ).all() as { target_id: string; c: number }[];

  const fanOutRows = db.prepare(
    'SELECT source_id, COUNT(*) as c FROM edges GROUP BY source_id'
  ).all() as { source_id: string; c: number }[];

  const totalFiles = (db.prepare(
    "SELECT COUNT(*) as n FROM nodes WHERE label = 'File'"
  ).get() as { n: number }).n;

  const fanInValues = fanInRows.map(r => r.c).sort((a, b) => a - b);
  const fanOutValues = fanOutRows.map(r => r.c).sort((a, b) => a - b);

  const p95FanIn = percentile(fanInValues, 95);
  const couplingHighCount = fanInValues.filter(v => v > p95FanIn).length;
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
  const nodeCount = (db.prepare('SELECT COUNT(*) as n FROM nodes').get() as { n: number }).n;
  const edgeCount = (db.prepare('SELECT COUNT(*) as n FROM edges').get() as { n: number }).n;
  const communityCount = (db.prepare(
    "SELECT COUNT(DISTINCT community_id) as n FROM nodes WHERE community_id IS NOT NULL"
  ).get() as { n: number }).n;
  const fileCount = (db.prepare(
    "SELECT COUNT(*) as n FROM nodes WHERE label = 'File'"
  ).get() as { n: number }).n;

  const couplingProfile = computeCouplingProfile(db);

  return {
    nodeCount,
    edgeCount,
    communityCount,
    fileCount,
    couplingProfile,
  };
}
