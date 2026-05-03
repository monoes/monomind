export interface FileScoreOutput {
  complexityModerate: number;
  complexityHigh: number;
  complexityCritical: number;
  crapModerate: number;
  crapHigh: number;
  crapCritical: number;
  functionCount: number;
  fileLoc: number;
}

export interface AnalysisCountsSnapshot {
  counts: Map<string, FileScoreOutput>;
}

export function buildAnalysisCountsSnapshot(
  fileScores: Array<{ filePath: string } & FileScoreOutput>
): AnalysisCountsSnapshot {
  const counts = new Map<string, FileScoreOutput>();
  for (const { filePath, ...rest } of fileScores) {
    counts.set(filePath, rest);
  }
  return { counts };
}

export function countsFor(
  snapshot: AnalysisCountsSnapshot,
  roots: string[]
): AnalysisCountsSnapshot {
  const filtered = new Map<string, FileScoreOutput>();
  for (const [key, value] of snapshot.counts) {
    if (roots.some((root) => key.startsWith(root))) {
      filtered.set(key, value);
    }
  }
  return { counts: filtered };
}

export function serializeSnapshot(
  snapshot: AnalysisCountsSnapshot
): Record<string, FileScoreOutput> {
  const result: Record<string, FileScoreOutput> = {};
  for (const [key, value] of snapshot.counts) {
    result[key] = value;
  }
  return result;
}

export function deserializeSnapshot(
  data: Record<string, FileScoreOutput>
): AnalysisCountsSnapshot {
  const counts = new Map<string, FileScoreOutput>();
  for (const [key, value] of Object.entries(data)) {
    counts.set(key, value);
  }
  return { counts };
}
