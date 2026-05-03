import type { VitalSigns, HealthScore } from './vital-signs-snapshot.js';
import type { SubsetFilter } from '../analysis/workspace-filter.js';

export type HealthGrouping = 'package' | 'owner' | 'directory' | 'section';

export interface HealthGroup {
  key: string;
  vitalSigns: VitalSigns;
  healthScore: HealthScore;
  fileCount: number;
}

function gradeFromValue(value: number): string {
  if (value >= 90) return 'A';
  if (value >= 75) return 'B';
  if (value >= 60) return 'C';
  if (value >= 45) return 'D';
  return 'F';
}

function averageVitalSigns(signs: VitalSigns[]): VitalSigns {
  const count = signs.length;
  if (count === 0) {
    return {
      deadCodePct: 0,
      duplicationPct: 0,
      complexityHighPct: 0,
      complexityCriticalPct: 0,
      crapHighPct: 0,
      crapCriticalPct: 0,
      hotspotDensity: 0,
      busFactor: 0,
      unusedDepsPct: 0,
      maintainabilityIndex: 0,
    };
  }
  const sum = signs.reduce(
    (acc, v) => ({
      deadCodePct: acc.deadCodePct + v.deadCodePct,
      duplicationPct: acc.duplicationPct + v.duplicationPct,
      complexityHighPct: acc.complexityHighPct + v.complexityHighPct,
      complexityCriticalPct: acc.complexityCriticalPct + v.complexityCriticalPct,
      crapHighPct: acc.crapHighPct + v.crapHighPct,
      crapCriticalPct: acc.crapCriticalPct + v.crapCriticalPct,
      hotspotDensity: acc.hotspotDensity + v.hotspotDensity,
      busFactor: acc.busFactor + v.busFactor,
      unusedDepsPct: acc.unusedDepsPct + v.unusedDepsPct,
      maintainabilityIndex: acc.maintainabilityIndex + v.maintainabilityIndex,
    }),
    {
      deadCodePct: 0,
      duplicationPct: 0,
      complexityHighPct: 0,
      complexityCriticalPct: 0,
      crapHighPct: 0,
      crapCriticalPct: 0,
      hotspotDensity: 0,
      busFactor: 0,
      unusedDepsPct: 0,
      maintainabilityIndex: 0,
    }
  );
  return {
    deadCodePct: sum.deadCodePct / count,
    duplicationPct: sum.duplicationPct / count,
    complexityHighPct: sum.complexityHighPct / count,
    complexityCriticalPct: sum.complexityCriticalPct / count,
    crapHighPct: sum.crapHighPct / count,
    crapCriticalPct: sum.crapCriticalPct / count,
    hotspotDensity: sum.hotspotDensity / count,
    busFactor: sum.busFactor / count,
    unusedDepsPct: sum.unusedDepsPct / count,
    maintainabilityIndex: sum.maintainabilityIndex / count,
  };
}

function resolveKey(
  filePath: string,
  grouping: HealthGrouping,
  codeownersMap?: Map<string, string>
): string {
  switch (grouping) {
    case 'directory': {
      const lastSlash = filePath.lastIndexOf('/');
      return lastSlash >= 0 ? filePath.slice(0, lastSlash) : '.';
    }
    case 'owner':
      return codeownersMap?.get(filePath) ?? 'UNOWNED';
    case 'package': {
      // Use first path segment after leading slash or relative root
      const parts = filePath.replace(/^\//, '').split('/');
      return parts[0] ?? filePath;
    }
    case 'section':
      return codeownersMap?.get(filePath) ?? '(no section)';
  }
}

export function groupHealthResults(
  fileVitals: Array<{ filePath: string; vitalSigns: VitalSigns; healthScore: HealthScore }>,
  grouping: HealthGrouping,
  codeownersMap?: Map<string, string>
): HealthGroup[] {
  const buckets = new Map<
    string,
    { vitalSigns: VitalSigns[]; scores: number[] }
  >();

  for (const entry of fileVitals) {
    const key = resolveKey(entry.filePath, grouping, codeownersMap);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { vitalSigns: [], scores: [] };
      buckets.set(key, bucket);
    }
    bucket.vitalSigns.push(entry.vitalSigns);
    bucket.scores.push(entry.healthScore.value);
  }

  const groups: HealthGroup[] = [];
  for (const [key, bucket] of buckets) {
    const avgValue =
      bucket.scores.length > 0
        ? bucket.scores.reduce((a, b) => a + b, 0) / bucket.scores.length
        : 0;
    groups.push({
      key,
      vitalSigns: averageVitalSigns(bucket.vitalSigns),
      healthScore: { value: avgValue, grade: gradeFromValue(avgValue) },
      fileCount: bucket.vitalSigns.length,
    });
  }

  // Sort ascending by healthScore.value (worst first)
  groups.sort((a, b) => a.healthScore.value - b.healthScore.value);

  return groups;
}
