import type { MonographDb } from '../storage/db.js';

export interface SizeBin {
  label: string;    // e.g. '1-10 lines'
  min: number;
  max: number;
  count: number;
  percentage: number;
}

export interface RiskProfileReport {
  functionSizeDistribution: SizeBin[];
  paramCountDistribution: SizeBin[];
  riskSummary: {
    largeFunction: number;    // LOC > 100
    longParamList: number;    // params > 5
    highRisk: number;         // BOTH large AND long param list
  };
  p50loc: number;
  p90loc: number;
  p95loc: number;
}

interface FunctionNode {
  start_line: number | null;
  end_line: number | null;
  properties: string | null;
}

const LOC_BINS: Array<{ label: string; min: number; max: number }> = [
  { label: '1-10 lines',   min: 1,   max: 10  },
  { label: '11-25 lines',  min: 11,  max: 25  },
  { label: '26-50 lines',  min: 26,  max: 50  },
  { label: '51-100 lines', min: 51,  max: 100 },
  { label: '101-250 lines',min: 101, max: 250 },
  { label: '250+ lines',   min: 251, max: Infinity },
];

const PARAM_BINS: Array<{ label: string; min: number; max: number }> = [
  { label: '0-2 params', min: 0, max: 2 },
  { label: '3-5 params', min: 3, max: 5 },
  { label: '6-8 params', min: 6, max: 8 },
  { label: '9+ params',  min: 9, max: Infinity },
];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

export function computeRiskProfile(db: MonographDb): RiskProfileReport {
  const rows = db.prepare(`
    SELECT start_line, end_line, properties
    FROM nodes
    WHERE label IN ('Function', 'Method')
  `).all() as FunctionNode[];

  const locs: number[] = [];
  const params: number[] = [];

  for (const row of rows) {
    if (row.start_line === null || row.end_line === null) continue;
    const loc = row.end_line - row.start_line + 1;
    if (loc < 1) continue;
    locs.push(loc);

    let paramCount = 0;
    if (row.properties) {
      try {
        const props = JSON.parse(row.properties) as Record<string, unknown>;
        if (typeof props['paramCount'] === 'number') {
          paramCount = props['paramCount'];
        }
      } catch {
        // ignore malformed JSON
      }
    }
    params.push(paramCount);
  }

  const total = locs.length;

  // ── LOC distribution ───────────────────────────────────────────────────────
  const functionSizeDistribution: SizeBin[] = LOC_BINS.map(bin => {
    const count = locs.filter(l => l >= bin.min && l <= bin.max).length;
    return {
      label: bin.label,
      min: bin.min,
      max: bin.max === Infinity ? 999999 : bin.max,
      count,
      percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    };
  });

  // ── Param distribution ─────────────────────────────────────────────────────
  const paramCountDistribution: SizeBin[] = PARAM_BINS.map(bin => {
    const count = params.filter(p => p >= bin.min && p <= bin.max).length;
    return {
      label: bin.label,
      min: bin.min,
      max: bin.max === Infinity ? 999999 : bin.max,
      count,
      percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
    };
  });

  // ── Risk summary ───────────────────────────────────────────────────────────
  let largeFunction = 0;
  let longParamList = 0;
  let highRisk = 0;
  for (let i = 0; i < locs.length; i++) {
    const large = locs[i] > 100;
    const longParam = (params[i] ?? 0) > 5;
    if (large) largeFunction++;
    if (longParam) longParamList++;
    if (large && longParam) highRisk++;
  }

  // ── Percentiles ────────────────────────────────────────────────────────────
  const sortedLocs = [...locs].sort((a, b) => a - b);
  const p50loc = percentile(sortedLocs, 0.50);
  const p90loc = percentile(sortedLocs, 0.90);
  const p95loc = percentile(sortedLocs, 0.95);

  return {
    functionSizeDistribution,
    paramCountDistribution,
    riskSummary: { largeFunction, longParamList, highRisk },
    p50loc,
    p90loc,
    p95loc,
  };
}
