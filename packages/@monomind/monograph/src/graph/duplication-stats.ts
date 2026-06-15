export interface DuplicationStats {
  totalFiles: number;
  filesWithClones: number;
  totalLines: number;
  duplicatedLines: number;
  totalTokens: number;
  duplicatedTokens: number;
  cloneGroups: number;
  cloneInstances: number;
  duplicationPct: number;
}

export interface CloneGroupInput {
  instances: Array<{
    filePath: string;
    startLine: number;
    endLine: number;
    tokenCount?: number;
  }>;
}

export function computeDuplicationStats(
  groups: CloneGroupInput[],
  allFilePaths: string[],
  totalLines: number,
  totalTokens: number,
): DuplicationStats {
  // Per-file deduplicated line sets to avoid double-counting
  const fileLines = new Map<string, Set<number>>();
  let cloneInstances = 0;

  for (const group of groups) {
    for (const inst of group.instances) {
      cloneInstances++;
      if (!fileLines.has(inst.filePath)) fileLines.set(inst.filePath, new Set());
      const set = fileLines.get(inst.filePath)!;
      for (let l = inst.startLine; l <= inst.endLine; l++) set.add(l);
    }
  }

  const filesWithClones = fileLines.size;
  // Single-pass line count — avoids spread allocation over all file Sets
  let duplicatedLines = 0;
  for (const set of fileLines.values()) duplicatedLines += set.size;
  // Single-pass token sum — avoids nested reduce and intermediate arrays
  let rawTokens = 0;
  for (const group of groups) {
    for (const inst of group.instances) rawTokens += inst.tokenCount ?? 0;
  }
  const duplicatedTokens = Math.min(totalTokens, rawTokens);

  return {
    totalFiles: allFilePaths.length,
    filesWithClones,
    totalLines,
    duplicatedLines,
    totalTokens,
    duplicatedTokens,
    cloneGroups: groups.length,
    cloneInstances,
    duplicationPct: totalLines > 0 ? (duplicatedLines / totalLines) * 100 : 0,
  };
}

export function formatDuplicationStats(stats: DuplicationStats): string {
  const pct = stats.duplicationPct;
  const grade = pct < 5 ? 'A' : pct < 10 ? 'B' : pct < 20 ? 'C' : pct < 30 ? 'D' : 'F';
  const tokenPct = stats.totalTokens > 0
    ? ((stats.duplicatedTokens / stats.totalTokens) * 100).toFixed(1)
    : '0.0';
  return [
    `Duplication grade: ${grade} (${pct.toFixed(1)}% duplicated lines)`,
    `Clone groups:      ${stats.cloneGroups}`,
    `Clone instances:   ${stats.cloneInstances}`,
    `Files with clones: ${stats.filesWithClones} / ${stats.totalFiles}`,
    `Duplicated lines:  ${stats.duplicatedLines} / ${stats.totalLines} (${pct.toFixed(1)}%)`,
    `Duplicated tokens: ${stats.duplicatedTokens} / ${stats.totalTokens} (${tokenPct}%)`,
  ].join('\n');
}
