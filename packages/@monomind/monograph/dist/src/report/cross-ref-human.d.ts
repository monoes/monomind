export type CrossRefDeadCodeKind = {
    type: 'unused-file';
} | {
    type: 'unused-export';
    exportName: string;
} | {
    type: 'unused-type';
    typeName: string;
};
export interface CrossRefHumanFinding {
    cloneFile: string;
    startLine: number;
    endLine: number;
    deadCodeKind: CrossRefDeadCodeKind;
    groupIndex: number;
}
export interface CrossRefHumanResult {
    findings: CrossRefHumanFinding[];
    clonesInUnusedFiles: number;
    clonesWithUnusedExports: number;
}
export declare function buildCrossReferenceLines(result: CrossRefHumanResult, root: string): string[];
export declare function printCrossReferenceFindings(result: CrossRefHumanResult, root: string, quiet?: boolean): void;
//# sourceMappingURL=cross-ref-human.d.ts.map