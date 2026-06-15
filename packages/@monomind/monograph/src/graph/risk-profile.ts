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
  // Push paramCount extraction to SQL with json_extract to avoid per-row JSON.parse
  const rows = db.prepare(`
    SELECT
      start_line,
      end_line,
      CAST(json_extract(properties, '$.paramCount') AS INTEGER) AS param_count
    FROM nodes
    WHERE label IN ('Function', 'Method')
      AND start_line IS NOT NULL
      AND end_line IS NOT NULL
  `).all() as { start_line: number; end_line: number; param_count: number | null }[];

  // ── Single-pass: compute LOC, assign to bins, accumulate risk summary ─────
  const locBinCounts = new Array<number>(LOC_BINS.length).fill(0);
  const paramBinCounts = new Array<number>(PARAM_BINS.length).fill(0);
  const sortedLocs: number[] = [];
  let largeFunction = 0;
  let longParamList = 0;
  let highRisk = 0;

  for (const row of rows) {
    const loc = row.end_line - row.start_line + 1;
    if (loc < 1) continue;

    sortedLocs.push(loc);

    // Assign to LOC bin in O(bins) rather than O(N×bins) via filter
    for (let i = 0; i < LOC_BINS.length; i++) {
      const bin = LOC_BINS[i];
      if (loc >= bin.min && loc <= bin.max) {
        locBinCounts[i]++;
        break;
      }
    }

    const pc = row.param_count ?? 0;
    for (let i = 0; i < PARAM_BINS.length; i++) {
      const bin = PARAM_BINS[i];
      if (pc >= bin.min && pc <= bin.max) {
        paramBinCounts[i]++;
        break;
      }
    }

    const large = loc > 100;
    const longParam = pc > 5;
    if (large) largeFunction++;
    if (longParam) longParamList++;
    if (large && longParam) highRisk++;
  }

  const total = sortedLocs.length;

  // ── Build bin result arrays ───────────────────────────────────────────────
  const functionSizeDistribution: SizeBin[] = LOC_BINS.map((bin, i) => ({
    label: bin.label,
    min: bin.min,
    max: bin.max === Infinity ? 999999 : bin.max,
    count: locBinCounts[i],
    percentage: total > 0 ? Math.round((locBinCounts[i] / total) * 1000) / 10 : 0,
  }));

  const paramCountDistribution: SizeBin[] = PARAM_BINS.map((bin, i) => ({
    label: bin.label,
    min: bin.min,
    max: bin.max === Infinity ? 999999 : bin.max,
    count: paramBinCounts[i],
    percentage: total > 0 ? Math.round((paramBinCounts[i] / total) * 1000) / 10 : 0,
  }));

  // ── Percentiles ────────────────────────────────────────────────────────────
  sortedLocs.sort((a, b) => a - b);
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

/**
 * Format a RiskProfileReport as structured text with distribution tables for LLM navigation.
 *
 * @param report - RiskProfileReport from computeRiskProfile()
 * @returns structured text suitable for LLM consumption
 */
export function formatRiskProfile(report: RiskProfileReport): string {
  const { functionSizeDistribution, paramCountDistribution, riskSummary, p50loc, p90loc, p95loc } = report;

  const total = functionSizeDistribution.reduce((s, b) => s + b.count, 0);
  if (total === 0) {
    return 'risk_profile: no Function/Method nodes with line info found\n';
  }

  const lines: string[] = [
    `risk_profile: ${total} functions analysed`,
    `  p50_loc: ${p50loc}  p90_loc: ${p90loc}  p95_loc: ${p95loc}`,
    `  large_functions(loc>100): ${riskSummary.largeFunction}  long_param_list(params>5): ${riskSummary.longParamList}  high_risk(both): ${riskSummary.highRisk}`,
    '',
    'function_size_distribution:',
  ];

  for (const bin of functionSizeDistribution) {
    const bar = '#'.repeat(Math.round(bin.percentage / 5)); // 1 char per 5%
    lines.push(`  ${bin.label.padEnd(15)}  ${String(bin.count).padStart(5)}  (${String(bin.percentage).padStart(5)}%)  ${bar}`);
  }

  lines.push('');
  lines.push('param_count_distribution:');
  for (const bin of paramCountDistribution) {
    const bar = '#'.repeat(Math.round(bin.percentage / 5));
    lines.push(`  ${bin.label.padEnd(15)}  ${String(bin.count).padStart(5)}  (${String(bin.percentage).padStart(5)}%)  ${bar}`);
  }

  if (riskSummary.highRisk > 0) {
    lines.push('');
    lines.push(`high_risk_note: ${riskSummary.highRisk} function(s) have both loc>100 AND params>5 — prime refactor candidates`);
  }

  return lines.join('\n');
}
