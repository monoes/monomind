import { type RefactoringTarget, type TargetThresholds } from './target-types.js';
export interface FileScoreInput {
    filePath: string;
    fanIn: number;
    fanOut: number;
    churnScore?: number;
    complexity?: number;
    deadCodeRatio?: number;
    inCycle?: boolean;
    coveragePct?: number;
    lineCount?: number;
}
export declare function computeThresholds(files: FileScoreInput[]): TargetThresholds;
export declare function computeRefactoringTargets(files: FileScoreInput[], thresholds: TargetThresholds, maxTargets?: number): RefactoringTarget[];
//# sourceMappingURL=targets.d.ts.map