export interface HumanDeadCodeFinding {
    filePath: string;
    symbol?: string;
    kind: string;
    line?: number;
}
export interface HumanHealthFinding {
    filePath: string;
    functionName: string;
    startLine: number;
    cyclomatic: number;
    cognitive: number;
    crapScore: number;
    severity: string;
}
export interface HumanDuplicationGroup {
    groupId: number;
    instances: Array<{
        filePath: string;
        startLine: number;
        endLine: number;
    }>;
    duplicatedLines: number;
}
export interface HumanTraceEntry {
    from: string;
    to: string;
    reason: string;
}
export declare function buildDeadCodeHumanLines(findings: HumanDeadCodeFinding[], root?: string): string[];
export declare function buildHealthHumanLines(findings: HumanHealthFinding[], root?: string): string[];
export declare function buildDuplicationHumanLines(groups: HumanDuplicationGroup[], root?: string): string[];
export declare function buildExportTraceHumanLines(trace: {
    exportName: string;
    filePath: string;
    consumers: HumanTraceEntry[];
}): string[];
export declare function buildFileTraceHumanLines(trace: {
    filePath: string;
    importedBy: HumanTraceEntry[];
}): string[];
export declare function buildDependencyTraceHumanLines(trace: {
    packageName: string;
    usedIn: HumanTraceEntry[];
}): string[];
//# sourceMappingURL=human.d.ts.map