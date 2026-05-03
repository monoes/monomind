// Serialize grouped health/duplication results and baseline-delta summaries to JSON.

export interface HealthActionOptions {
  includeRecommendedActions: boolean;
  includePerFileFindings: boolean;
}

export const DEFAULT_HEALTH_ACTION_OPTIONS: HealthActionOptions = {
  includeRecommendedActions: true,
  includePerFileFindings: true,
};

export interface GroupedHealthResult {
  owner: string;
  fileCount: number;
  averageScore: number;
  findings: unknown[];
}

export interface GroupedDuplicationResult {
  owner: string;
  duplicatedLines: number;
  instances: number;
  filePaths: string[];
}

export interface BaselineDelta {
  metric: string;
  baseline: number;
  current: number;
  delta: number;
  deltaSign: '+' | '-' | '=';
}

export function buildGroupedHealthJson(
  groups: GroupedHealthResult[],
  opts: HealthActionOptions = DEFAULT_HEALTH_ACTION_OPTIONS,
): string {
  const payload = groups.map(g => ({
    owner: g.owner,
    fileCount: g.fileCount,
    averageScore: g.averageScore,
    ...(opts.includePerFileFindings ? { findings: g.findings } : {}),
    ...(opts.includeRecommendedActions ? { recommendedAction: g.averageScore < 50 ? 'refactor' : 'monitor' } : {}),
  }));
  return JSON.stringify(payload, null, 2);
}

export function buildGroupedDuplicationJson(groups: GroupedDuplicationResult[]): string {
  return JSON.stringify(groups, null, 2);
}

export function buildBaselineDeltasJson(
  current: Record<string, number>,
  baseline: Record<string, number>,
): string {
  const deltas: BaselineDelta[] = Object.keys({ ...current, ...baseline }).map(metric => {
    const b = baseline[metric] ?? 0;
    const c = current[metric] ?? 0;
    const delta = c - b;
    return {
      metric,
      baseline: b,
      current: c,
      delta,
      deltaSign: delta > 0 ? '+' : delta < 0 ? '-' : '=',
    };
  });
  return JSON.stringify({ deltas, summary: { improved: deltas.filter(d => d.delta < 0).length, regressed: deltas.filter(d => d.delta > 0).length, unchanged: deltas.filter(d => d.delta === 0).length } }, null, 2);
}
