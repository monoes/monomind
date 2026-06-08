import type { MonographDiagnostic } from './diagnostics.js';
export interface UnusedSymbolLocation {
    uri: string;
    line: number;
    col: number;
    name: string;
    symbolKind: 'export' | 'type' | 'member' | 'file';
}
export declare function buildUnusedSymbolDiagnostics(symbols: UnusedSymbolLocation[]): Map<string, MonographDiagnostic[]>;
export interface CircularDepLocation {
    uri: string;
    importLine: number;
    cycle: string[];
}
export interface BoundaryViolationLocation {
    uri: string;
    line: number;
    fromZone: string;
    toZone: string;
    importedPath: string;
}
export declare function buildCircularDepDiagnostics(cycles: CircularDepLocation[]): Map<string, MonographDiagnostic[]>;
export declare function buildBoundaryViolationDiagnostics(violations: BoundaryViolationLocation[]): Map<string, MonographDiagnostic[]>;
export interface ComplexityIssueLocation {
    uri: string;
    line: number;
    functionName: string;
    cyclomaticComplexity: number;
    cognitiveComplexity?: number;
    crapScore?: number;
    severity: 'moderate' | 'high' | 'critical';
}
export declare function buildComplexityDiagnostics(issues: ComplexityIssueLocation[]): Map<string, MonographDiagnostic[]>;
//# sourceMappingURL=diagnostics-ext.d.ts.map