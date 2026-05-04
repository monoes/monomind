export type TrendDirection = 'improving' | 'declining' | 'stable';

export function trendArrow(d: TrendDirection): string {
  return d === 'improving' ? '↑' : d === 'declining' ? '↓' : '→';
}

export function trendColor(d: TrendDirection): string {
  return d === 'improving' ? '\x1b[32m' : d === 'declining' ? '\x1b[31m' : '\x1b[33m';
}

export interface TrendCount {
  value: number;
  total: number;
}

export interface TrendMetric {
  name: string;
  label: string;
  previous: number;
  current: number;
  delta: number;
  direction: TrendDirection;
  unit: string;
  previousCount?: TrendCount;
  currentCount?: TrendCount;
}

export interface TrendPoint {
  timestamp: string;
  gitSha?: string;
  score?: number;
  grade?: string;
  coverageModel?: string;
  snapshotSchemaVersion?: number;
}

export interface HealthTrend {
  comparedTo: TrendPoint;
  metrics: TrendMetric[];
  snapshotsLoaded: number;
  overallDirection: TrendDirection;
}

export function computeOverallDirection(metrics: TrendMetric[]): TrendDirection {
  if (metrics.length === 0) return 'stable';
  const improving = metrics.filter(m => m.direction === 'improving').length;
  const declining = metrics.filter(m => m.direction === 'declining').length;
  if (improving > declining) return 'improving';
  if (declining > improving) return 'declining';
  return 'stable';
}

export function formatTrendMetric(m: TrendMetric): string {
  const sign = m.delta >= 0 ? '+' : '';
  const arrow = trendArrow(m.direction);
  return `${m.label}: ${m.previous}${m.unit} → ${m.current}${m.unit} (${sign}${m.delta.toFixed(1)}${m.unit}) ${arrow}`;
}
