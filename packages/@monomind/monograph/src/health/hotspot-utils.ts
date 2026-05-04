export function isTestPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return (
    normalized.includes('/__tests__/') ||
    normalized.includes('/__mocks__/') ||
    normalized.includes('/test/') ||
    normalized.includes('/tests/') ||
    normalized.includes('/e2e/') ||
    normalized.includes('.test.') ||
    normalized.includes('.spec.')
  );
}

export interface NormalizationMaxima {
  maxWeightedCommits: number;
  maxComplexityDensity: number;
}

export function computeNormalizationMaxima(
  files: Array<{ weightedCommits: number; complexityDensity: number }>,
  percentile = 0.95,
): NormalizationMaxima {
  if (files.length < 2) {
    const maxWeightedCommits = files.length === 1 ? files[0].weightedCommits : 0;
    const maxComplexityDensity = files.length === 1 ? files[0].complexityDensity : 0;
    return { maxWeightedCommits, maxComplexityDensity };
  }

  const sortedWeighted = [...files.map(f => f.weightedCommits)].sort((a, b) => a - b);
  const sortedDensity = [...files.map(f => f.complexityDensity)].sort((a, b) => a - b);

  const idx = Math.min(
    Math.ceil(percentile * files.length) - 1,
    files.length - 1,
  );

  return {
    maxWeightedCommits: sortedWeighted[idx],
    maxComplexityDensity: sortedDensity[idx],
  };
}

export function normalizeHotspotScore(
  rawChurn: number,
  rawComplexity: number,
  maxima: NormalizationMaxima,
): number {
  const normChurn = maxima.maxWeightedCommits > 0
    ? rawChurn / maxima.maxWeightedCommits
    : 0;
  const normComplexity = maxima.maxComplexityDensity > 0
    ? rawComplexity / maxima.maxComplexityDensity
    : 0;
  return Math.round((normChurn * 0.6 + normComplexity * 0.4) * 100 * 10) / 10;
}
