// Adaptive percentile thresholds derived from the actual distribution
// of file-level graph topology scores.

export interface DistributionThresholds {
  fanInP95: number;
  fanInP75: number;
  fanInP25: number;
  fanOutP95: number;
  fanOutP90: number;
}

export const THRESHOLD_FLOORS: DistributionThresholds = {
  fanInP95: 8,
  fanInP75: 4,
  fanInP25: 1,
  fanOutP95: 20,
  fanOutP90: 12,
};

function sortedPercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

export interface FileTopologyScore {
  fanIn: number;
  fanOut: number;
}

/** Compute distribution thresholds from an array of per-file topology scores. */
export function computeDistributionThresholds(
  scores: FileTopologyScore[],
): DistributionThresholds {
  if (scores.length === 0) return { ...THRESHOLD_FLOORS };

  const fanIns  = scores.map(s => s.fanIn).sort((a, b) => a - b);
  const fanOuts = scores.map(s => s.fanOut).sort((a, b) => a - b);

  return {
    fanInP95:  Math.max(THRESHOLD_FLOORS.fanInP95,  sortedPercentile(fanIns,  0.95)),
    fanInP75:  Math.max(THRESHOLD_FLOORS.fanInP75,  sortedPercentile(fanIns,  0.75)),
    fanInP25:  Math.max(THRESHOLD_FLOORS.fanInP25,  sortedPercentile(fanIns,  0.25)),
    fanOutP95: Math.max(THRESHOLD_FLOORS.fanOutP95, sortedPercentile(fanOuts, 0.95)),
    fanOutP90: Math.max(THRESHOLD_FLOORS.fanOutP90, sortedPercentile(fanOuts, 0.90)),
  };
}

export function formatDistributionThresholds(t: DistributionThresholds): string {
  return [
    `Fan-in  p25=${t.fanInP25}  p75=${t.fanInP75}  p95=${t.fanInP95}`,
    `Fan-out p90=${t.fanOutP90}  p95=${t.fanOutP95}`,
  ].join('\n');
}
