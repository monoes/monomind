export type DiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint';
export interface LspRange {
    start: {
        line: number;
        character: number;
    };
    end: {
        line: number;
        character: number;
    };
}
export interface LspDiagnosticEntry {
    filePath: string;
    range: LspRange;
    message: string;
    severity: DiagnosticSeverity;
    code: string;
    source: string;
}
export type DiagnosticMap = Map<string, LspDiagnosticEntry[]>;
export interface UnusedExportFinding {
    filePath: string;
    line: number;
    symbol: string;
}
export interface UnusedFileFinding {
    filePath: string;
}
export interface UnresolvedImportFinding {
    filePath: string;
    line: number;
    specifier: string;
}
export interface UnusedDepFinding {
    name: string;
    kind: 'unused' | 'unlisted';
}
export interface UnusedMemberFinding {
    filePath: string;
    line: number;
    className: string;
    member: string;
}
export interface CircularDepFinding {
    files: string[];
}
export interface BoundaryViolFinding {
    fromFile: string;
    toFile: string;
    line: number;
    rule: string;
}
export interface DupeExportFinding {
    filePath: string;
    line: number;
    symbol: string;
}
export interface DuplicationFinding {
    filePath: string;
    startLine: number;
    endLine: number;
    groupId: number;
}
export interface StaleSuppressionFinding {
    filePath: string;
    line: number;
    code: string;
}
export declare function pushExportDiagnostics(map: DiagnosticMap, results: UnusedExportFinding[]): void;
export declare function pushFileDiagnostics(map: DiagnosticMap, results: UnusedFileFinding[]): void;
export declare function pushImportDiagnostics(map: DiagnosticMap, results: UnresolvedImportFinding[]): void;
export declare function pushDepDiagnostics(map: DiagnosticMap, results: UnusedDepFinding[]): void;
export declare function pushMemberDiagnostics(map: DiagnosticMap, results: UnusedMemberFinding[]): void;
export declare function pushCircularDepDiagnostics(map: DiagnosticMap, results: CircularDepFinding[]): void;
export declare function pushBoundaryViolationDiagnostics(map: DiagnosticMap, results: BoundaryViolFinding[]): void;
export declare function pushDuplicateExportDiagnostics(map: DiagnosticMap, results: DupeExportFinding[]): void;
export declare function pushDuplicationDiagnostics(map: DiagnosticMap, results: DuplicationFinding[]): void;
export declare function pushStaleSuppressionDiagnostics(map: DiagnosticMap, results: StaleSuppressionFinding[]): void;
//# sourceMappingURL=diagnostics-push.d.ts.map