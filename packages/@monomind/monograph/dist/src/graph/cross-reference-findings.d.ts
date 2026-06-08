export type DeadCodeKind = {
    type: 'unused-file';
} | {
    type: 'unused-export';
    exportName: string;
} | {
    type: 'unused-type';
    typeName: string;
};
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
    unusedExports: Array<{
        path: string;
        exportName: string;
        line: number;
    }>;
    unusedTypes: Array<{
        path: string;
        typeName: string;
        line: number;
    }>;
}
export interface CrossRefDuplicationReport {
    cloneGroups: Array<{
        instances: CloneInstanceRef[];
    }>;
}
export declare function crossReference(duplication: CrossRefDuplicationReport, deadCode: CrossRefDeadCodeSummary): CrossReferenceResult;
export declare function affectedGroupIndices(result: CrossReferenceResult): Set<number>;
//# sourceMappingURL=cross-reference-findings.d.ts.map