export type ChurnTrend = 'accelerating' | 'stable' | 'cooling';

const ACCELERATING_RATIO = 1.5;
const COOLING_RATIO = 0.67;

export function computeChurnTrend(timestampsEpochSec: number[]): ChurnTrend {
  if (timestampsEpochSec.length < 2) return 'stable';
  const minTs = Math.min(...timestampsEpochSec);
  const maxTs = Math.max(...timestampsEpochSec);
  if (maxTs === minTs) return 'stable';
  const midpoint = minTs + (maxTs - minTs) / 2;
  const recent = timestampsEpochSec.filter(ts => ts > midpoint).length;
  const older  = timestampsEpochSec.filter(ts => ts <= midpoint).length;
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
  const all = fileTimestamps.flat();
  return computeChurnTrend(all);
}
