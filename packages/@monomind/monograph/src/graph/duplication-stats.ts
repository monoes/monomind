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
  const duplicatedLines = [...fileLines.values()].reduce((s, set) => s + set.size, 0);
  const duplicatedTokens = Math.min(
    totalTokens,
    groups.reduce((s, g) => s + g.instances.reduce((t, i) => t + (i.tokenCount ?? 0), 0), 0),
  );

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
  return [
    `Clone groups:      ${stats.cloneGroups}`,
    `Clone instances:   ${stats.cloneInstances}`,
    `Files with clones: ${stats.filesWithClones} / ${stats.totalFiles}`,
    `Duplicated lines:  ${stats.duplicatedLines} / ${stats.totalLines} (${stats.duplicationPct.toFixed(1)}%)`,
  ].join('\n');
}
