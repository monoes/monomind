export interface ExportTraceRef {
    fromFile: string;
    kind: string;
}
export interface ReExportChain {
    barrelFile: string;
    exportedAs: string;
    referenceCount: number;
}
export interface ExportTraceInput {
    exportName: string;
    file: string;
    isUsed: boolean;
    fileReachable: boolean;
    isEntryPoint: boolean;
    reason: string;
    directReferences: ExportTraceRef[];
    reExportChains: ReExportChain[];
}
export interface FileTraceExport {
    name: string;
    referenceCount: number;
    isTypeOnly: boolean;
    referencedBy: ExportTraceRef[];
}
export interface FileTraceInput {
    file: string;
    isReachable: boolean;
    isEntryPoint: boolean;
    exports: FileTraceExport[];
    importedBy: string[];
}
export interface DependencyTraceInput {
    packageName: string;
    isUsed: boolean;
    importCount: number;
    importedBy: string[];
    typeOnlyImportedBy: string[];
    usedInScripts: boolean;
}
export interface CloneGroupTrace {
    lineCount: number;
    tokenCount: number;
    instances: Array<{
        file: string;
        startLine: number;
        endLine: number;
    }>;
}
export interface CloneTraceInput {
    matchedInstance?: {
        file: string;
        startLine: number;
        endLine: number;
    };
    cloneGroups: CloneGroupTrace[];
}
export declare function printExportTraceHuman(trace: ExportTraceInput, root: string): void;
export declare function printFileTraceHuman(trace: FileTraceInput, root: string): void;
export declare function printDependencyTraceHuman(trace: DependencyTraceInput): void;
export declare function printCloneTraceHuman(trace: CloneTraceInput, root: string): void;
//# sourceMappingURL=trace-human.d.ts.map