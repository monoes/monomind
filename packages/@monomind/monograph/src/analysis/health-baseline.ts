export interface HealthFileCounts {
  complexityModerate: number;
  complexityHigh: number;
  complexityCritical: number;
  crapModerate: number;
  crapHigh: number;
  crapCritical: number;
}

export interface HealthBaselineData {
  counts: Map<string, HealthFileCounts>;
}

export interface HealthFinding {
  filePath: string;
  kind: 'complexity_moderate' | 'complexity_high' | 'complexity_critical' | 'crap_moderate' | 'crap_high' | 'crap_critical';
  functionName?: string;
  line?: number;
}

function toRelativePath(filePath: string, root: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const rootNorm = root.replace(/\\/g, '/').replace(/\/$/, '') + '/';
  return normalized.startsWith(rootNorm) ? normalized.slice(rootNorm.length) : normalized;
}

function buildCountsFromFindings(findings: HealthFinding[], root: string): Map<string, HealthFileCounts> {
  const map = new Map<string, HealthFileCounts>();
  const zero = (): HealthFileCounts => ({
    complexityModerate: 0, complexityHigh: 0, complexityCritical: 0,
    crapModerate: 0, crapHigh: 0, crapCritical: 0,
  });
  for (const f of findings) {
    const key = toRelativePath(f.filePath, root);
    const counts = map.get(key) ?? zero();
    const fieldMap: Record<string, keyof HealthFileCounts> = {
      'complexity_moderate': 'complexityModerate',
      'complexity_high': 'complexityHigh',
      'complexity_critical': 'complexityCritical',
      'crap_moderate': 'crapModerate',
      'crap_high': 'crapHigh',
      'crap_critical': 'crapCritical',
    };
    const field = fieldMap[f.kind];
    if (field) counts[field]++;
    map.set(key, counts);
  }
  return map;
}

export function buildHealthBaseline(findings: HealthFinding[], root: string): HealthBaselineData {
  return { counts: buildCountsFromFindings(findings, root) };
}

export function filterNewHealthFindings(
  current: HealthFinding[],
  baseline: HealthBaselineData,
  root: string,
): HealthFinding[] {
  const baselineCounts = buildCountsFromFindings(current, root);
  return current.filter(f => {
    const key = toRelativePath(f.filePath, root);
    const saved = baseline.counts.get(key);
    if (!saved) return true;
    const fieldMap: Record<string, keyof HealthFileCounts> = {
      'complexity_moderate': 'complexityModerate',
      'complexity_high': 'complexityHigh',
      'complexity_critical': 'complexityCritical',
      'crap_moderate': 'crapModerate',
      'crap_high': 'crapHigh',
      'crap_critical': 'crapCritical',
    };
    const field = fieldMap[f.kind];
    if (!field) return true;
    const currentCount = baselineCounts.get(key)?.[field] ?? 0;
    const savedCount = saved[field];
    return currentCount > savedCount;
  });
}
