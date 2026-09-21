/**
 * Turning raw browser instrument output into a verdict.
 *
 * Pure functions only — no CDP, no session, no I/O — so the judgement calls
 * (what counts as a poor LCP, which function is actually hot) can be read and
 * tested on their own. Used by the tools in `browser-profile-tools.ts`.
 */

// ---------------------------------------------------------------------------
// Vitals grading
// ---------------------------------------------------------------------------

/** Core Web Vitals thresholds: [good below, poor at or above, unit]. */
const VITAL_BUDGETS: Record<string, [number, number, string]> = {
  lcp: [2500, 4000, 'ms'],
  fcp: [1800, 3000, 'ms'],
  cls: [0.1, 0.25, ''],
  inp: [200, 500, 'ms'],
  ttfb: [800, 1800, 'ms'],
};

const VITAL_LABELS: Record<string, string> = {
  lcp: 'LCP',
  fcp: 'FCP',
  cls: 'CLS',
  inp: 'INP',
  ttfb: 'TTFB',
};

export function gradeVitals(vitals: Record<string, number | undefined>): {
  assessment: Record<string, string>;
  worst: string[];
} {
  const assessment: Record<string, string> = {};
  const worst: Array<{ line: string; rank: number }> = [];
  for (const [key, [good, poor, unit]] of Object.entries(VITAL_BUDGETS)) {
    const value = vitals[key];
    if (typeof value !== 'number') continue;
    const grade = value < good ? 'good' : value < poor ? 'needs-improvement' : 'poor';
    assessment[key] = grade;
    if (grade === 'good') continue;
    const shown = unit === 'ms' ? `${Math.round(value)}ms` : value.toFixed(4);
    // Poor before needs-improvement; within a grade, the biggest overshoot first.
    worst.push({
      line: `${VITAL_LABELS[key]} ${shown} — ${grade} (good is under ${good}${unit})`,
      rank: (grade === 'poor' ? 0 : 1000) + good / Math.max(value, 0.0001),
    });
  }
  worst.sort((a, b) => a.rank - b.rank);
  return { assessment, worst: worst.map((w) => w.line) };
}

// ---------------------------------------------------------------------------
// CPU profile summary
// ---------------------------------------------------------------------------

interface CpuProfileNode {
  id: number;
  callFrame: { functionName?: string; url?: string; lineNumber?: number };
  hitCount?: number;
}

export interface TopFunction {
  functionName: string;
  url?: string;
  line?: number;
  selfMs: number;
  selfPercent: number;
}

/**
 * Self time per function from a V8 .cpuprofile. Sampling profiles record a hit
 * count per node; self time is that share of the wall-clock window.
 */
export function summarizeCpuProfile(
  profile: { nodes?: CpuProfileNode[]; startTime?: number; endTime?: number },
  top: number,
): { durationMs: number; totalSamples: number; topFunctions: TopFunction[] } {
  const nodes = profile.nodes ?? [];
  const durationMs = Math.max(
    0,
    Math.round(((profile.endTime ?? 0) - (profile.startTime ?? 0)) / 1000),
  );
  const totalSamples = nodes.reduce((sum, n) => sum + (n.hitCount ?? 0), 0);
  if (totalSamples === 0) return { durationMs, totalSamples, topFunctions: [] };

  const byFrame = new Map<string, TopFunction>();
  for (const node of nodes) {
    const hits = node.hitCount ?? 0;
    if (hits === 0) continue;
    const frame = node.callFrame ?? {};
    const name =
      frame.functionName && frame.functionName.length > 0 ? frame.functionName : '(anonymous)';
    const key = `${name}|${frame.url ?? ''}|${frame.lineNumber ?? -1}`;
    const share = hits / totalSamples;
    const existing = byFrame.get(key);
    if (existing) {
      existing.selfMs += share * durationMs;
      existing.selfPercent += share * 100;
    } else {
      byFrame.set(key, {
        functionName: name,
        url: frame.url || undefined,
        line:
          frame.lineNumber !== undefined && frame.lineNumber >= 0 ? frame.lineNumber : undefined,
        selfMs: share * durationMs,
        selfPercent: share * 100,
      });
    }
  }

  const topFunctions = [...byFrame.values()]
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, top)
    .map((f) => ({
      ...f,
      selfMs: Math.round(f.selfMs * 10) / 10,
      selfPercent: Math.round(f.selfPercent * 10) / 10,
    }));
  return { durationMs, totalSamples, topFunctions };
}
