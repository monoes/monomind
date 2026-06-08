import type { LspRange } from './code-lens.js';
export type DiagnosticSeverity = 1 | 2 | 3 | 4;
export type DiagnosticTag = 1 | 2;
export interface RelatedInformation {
    uri: string;
    range: LspRange;
    message: string;
}
export interface MonographDiagnostic {
    range: LspRange;
    severity: DiagnosticSeverity;
    code: string;
    source: string;
    message: string;
    tags?: DiagnosticTag[];
    relatedInformation?: RelatedInformation[];
}
export interface DuplicateExportLocation {
    uri: string;
    line: number;
    col: number;
    exportName: string;
}
export interface DuplicateExportGroup {
    name: string;
    locations: DuplicateExportLocation[];
}
export interface StaleSuppressionInfo {
    uri: string;
    line: number;
    description: string;
}
export declare function buildDuplicateExportDiagnostics(groups: DuplicateExportGroup[]): Map<string, MonographDiagnostic[]>;
export declare function buildStaleSuppressionDiagnostics(suppressions: StaleSuppressionInfo[]): Map<string, MonographDiagnostic[]>;
//# sourceMappingURL=diagnostics.d.ts.map