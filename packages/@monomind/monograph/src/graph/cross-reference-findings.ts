export type DeadCodeKind =
  | { type: 'unused-file' }
  | { type: 'unused-export'; exportName: string }
  | { type: 'unused-type'; typeName: string };

export interface CloneInstanceRef {
  file: string;
  startLine: number;
  endLine: number;
  tokenCount?: number;
}

export interface CombinedFinding {
  cloneInstance: CloneInstanceRef;
  deadCodeKind: DeadCodeKind;
  groupIndex: number;
}

export interface CrossReferenceResult {
  combinedFindings: CombinedFinding[];
  clonesInUnusedFiles: number;
  clonesWithUnusedExports: number;
}

export interface CrossRefDeadCodeSummary {
  unusedFiles: Set<string>;
  unusedExports: Array<{ path: string; exportName: string; line: number }>;
  unusedTypes: Array<{ path: string; typeName: string; line: number }>;
}

export interface CrossRefDuplicationReport {
  cloneGroups: Array<{ instances: CloneInstanceRef[] }>;
}

export function crossReference(duplication: CrossRefDuplicationReport, deadCode: CrossRefDeadCodeSummary): CrossReferenceResult {
  const findings: CombinedFinding[] = [];
  let clonesInUnusedFiles = 0, clonesWithUnusedExports = 0;

  for (let gi = 0; gi < duplication.cloneGroups.length; gi++) {
    for (const inst of duplication.cloneGroups[gi].instances) {
      if (deadCode.unusedFiles.has(inst.file)) {
        findings.push({ cloneInstance: inst, deadCodeKind: { type: 'unused-file' }, groupIndex: gi });
        clonesInUnusedFiles++;
        continue;
      }
      const overlap = deadCode.unusedExports.find(e => e.path === inst.file && e.line >= inst.startLine && e.line <= inst.endLine);
      if (overlap) {
        findings.push({ cloneInstance: inst, deadCodeKind: { type: 'unused-export', exportName: overlap.exportName }, groupIndex: gi });
        clonesWithUnusedExports++;
        continue;
      }
      const typeOverlap = deadCode.unusedTypes.find(t => t.path === inst.file && t.line >= inst.startLine && t.line <= inst.endLine);
      if (typeOverlap) {
        findings.push({ cloneInstance: inst, deadCodeKind: { type: 'unused-type', typeName: typeOverlap.typeName }, groupIndex: gi });
        clonesWithUnusedExports++;
      }
    }
  }
  return { combinedFindings: findings, clonesInUnusedFiles, clonesWithUnusedExports };
}

export function affectedGroupIndices(result: CrossReferenceResult): Set<number> {
  return new Set(result.combinedFindings.map(f => f.groupIndex));
}
