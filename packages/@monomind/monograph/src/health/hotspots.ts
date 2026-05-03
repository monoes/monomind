import type { ChurnResult, FileChurn } from '../analysis/churn.js';

export interface HotspotEntry {
  path: string;
  score: number;
  weightedCommits: number;
  complexityDensity: number;
  rank: number;
}

export interface HotspotSummary {
  count: number;
  topScore: number;
  meanScore: number;
}

const TEST_PATH_PATTERNS = [
  '/__tests__/',
  '.test.',
  '.spec.',
  '_test.',
  '_spec.',
  '/test/',
  '/tests/',
  '/spec/',
  '/specs/',
];

export function isTestPath(path: string): boolean {
  for (const pattern of TEST_PATH_PATTERNS) {
    if (path.includes(pattern)) return true;
  }
  return false;
}

export function normalizeValue(value: number, max: number): number {
  return max > 0 ? value / max : 0;
}

export function computeHotspotScore(
  weightedCommits: number,
  maxWeighted: number,
  density: number,
  maxDensity: number,
): number {
  return normalizeValue(weightedCommits, maxWeighted) * normalizeValue(density, maxDensity) * 100;
}

export function computeHotspots(
  churnResult: ChurnResult,
  complexityMap: Map<string, number>,
  minCommits = 3,
): { entries: HotspotEntry[]; summary: HotspotSummary } {
  // Filter qualifying files
  const qualifying = churnResult.files.filter(
    (f) => !isTestPath(f.path) && f.totalCommits >= minCommits,
  );

  if (qualifying.length === 0) {
    return {
      entries: [],
      summary: { count: 0, topScore: 0, meanScore: 0 },
    };
  }

  // Compute normalization maxima from qualifying files only
  let maxWeighted = 0;
  let maxDensity = 0;

  for (const f of qualifying) {
    if (f.weightedCommits > maxWeighted) maxWeighted = f.weightedCommits;
    const density = complexityMap.get(f.path) ?? 0;
    if (density > maxDensity) maxDensity = density;
  }

  // Score each qualifying file
  const scored = qualifying.map((f) => {
    const density = complexityMap.get(f.path) ?? 0;
    const score = computeHotspotScore(f.weightedCommits, maxWeighted, density, maxDensity);
    return { f, score, density };
  });

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  // Build entries with 1-based rank
  const entries: HotspotEntry[] = scored.map((item, idx) => ({
    path: item.f.path,
    score: item.score,
    weightedCommits: item.f.weightedCommits,
    complexityDensity: item.density,
    rank: idx + 1,
  }));

  // Compute summary
  const count = entries.length;
  const topScore = entries[0]?.score ?? 0;
  const meanScore = count > 0 ? entries.reduce((s, e) => s + e.score, 0) / count : 0;

  return {
    entries,
    summary: { count, topScore, meanScore },
  };
}
