export type ChurnTrend = 'accelerating' | 'stable' | 'cooling';

const ACCELERATING_RATIO = 1.5;
const COOLING_RATIO = 0.67;

export function computeChurnTrend(timestampsEpochSec: number[]): ChurnTrend {
  if (timestampsEpochSec.length < 2) return 'stable';
  // Single pass: compute min, max, and partition counts simultaneously (O(N) vs O(4N) before)
  let minTs = timestampsEpochSec[0];
  let maxTs = timestampsEpochSec[0];
  for (let i = 1; i < timestampsEpochSec.length; i++) {
    const ts = timestampsEpochSec[i];
    if (ts < minTs) minTs = ts;
    if (ts > maxTs) maxTs = ts;
  }
  if (maxTs === minTs) return 'stable';
  const midpoint = minTs + (maxTs - minTs) / 2;
  let recent = 0, older = 0;
  for (const ts of timestampsEpochSec) {
    if (ts > midpoint) recent++; else older++;
  }
  if (older < 1) return 'stable';
  const ratio = recent / older;
  if (ratio > ACCELERATING_RATIO) return 'accelerating';
  if (ratio < COOLING_RATIO) return 'cooling';
  return 'stable';
}

export function churnTrendLabel(trend: ChurnTrend): string {
  return trend === 'accelerating' ? '↑ accelerating' : trend === 'cooling' ? '↓ cooling' : '→ stable';
}

export function churnTrendFromFileSeries(fileTimestamps: number[][]): ChurnTrend {
  // Avoid allocating an intermediate flat array — inline the min/max/count logic
  if (fileTimestamps.length === 0) return 'stable';
  let minTs = Infinity, maxTs = -Infinity, total = 0;
  for (const series of fileTimestamps) {
    for (const ts of series) {
      if (ts < minTs) minTs = ts;
      if (ts > maxTs) maxTs = ts;
      total++;
    }
  }
  if (total < 2 || maxTs === minTs) return 'stable';
  const midpoint = minTs + (maxTs - minTs) / 2;
  let recent = 0, older = 0;
  for (const series of fileTimestamps) {
    for (const ts of series) {
      if (ts > midpoint) recent++; else older++;
    }
  }
  if (older < 1) return 'stable';
  const ratio = recent / older;
  if (ratio > ACCELERATING_RATIO) return 'accelerating';
  if (ratio < COOLING_RATIO) return 'cooling';
  return 'stable';
}
