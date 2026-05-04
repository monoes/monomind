import type { RawGroup } from './extraction.js';

export interface PipelineDuplicationStats {
  totalFiles: number;
  filesWithClones: number;
  totalTokens: number;
  duplicatedTokens: number;
  totalLines: number;
  duplicatedLines: number;
  cloneGroups: number;
  cloneInstances: number;
  duplicationPct: number;
}

export function computePipelineStats(
  groups: RawGroup[],
  allFileIds: number[],
  totalTokens: number,
  totalLines: number,
  fileLineCount: (fileId: number, offset: number, length: number) => number,
): PipelineDuplicationStats {
  const filesWithClones = new Set<number>();
  const fileDupLines = new Map<number, Set<number>>();
  let duplicatedTokens = 0;
  let cloneInstances = 0;

  for (const group of groups) {
    for (const inst of group.instances) {
      filesWithClones.add(inst.fileId);
      cloneInstances++;

      let lineSet = fileDupLines.get(inst.fileId);
      if (!lineSet) {
        lineSet = new Set<number>();
        fileDupLines.set(inst.fileId, lineSet);
      }

      const lines = fileLineCount(inst.fileId, inst.offset, group.lcpLength);
      for (let l = 0; l < lines; l++) {
        lineSet.add(inst.offset + l);
      }
    }

    if (group.instances.length > 1) {
      duplicatedTokens += group.lcpLength * (group.instances.length - 1);
    }
  }

  let duplicatedLines = 0;
  for (const lineSet of fileDupLines.values()) {
    duplicatedLines += lineSet.size;
  }

  duplicatedTokens = Math.min(duplicatedTokens, totalTokens);

  const duplicationPct = totalLines > 0 ? (duplicatedLines / totalLines) * 100 : 0;

  return {
    totalFiles: allFileIds.length,
    filesWithClones: filesWithClones.size,
    totalTokens,
    duplicatedTokens,
    totalLines,
    duplicatedLines,
    cloneGroups: groups.length,
    cloneInstances,
    duplicationPct,
  };
}
