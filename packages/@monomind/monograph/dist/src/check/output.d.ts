import type { AnalysisIssue } from './rules.js';
export type OutputFormat = 'text' | 'json' | 'compact';
export interface TraceOptions {
    traceExport?: string;
    traceFile?: string;
    traceDependency?: string;
    performance: boolean;
}
export interface SarifOutput {
    version: '2.1.0';
    $schema: string;
    runs: SarifRun[];
}
export interface SarifRun {
    tool: {
        driver: {
            name: string;
            version: string;
            rules: SarifRule[];
        };
    };
    results: SarifResult[];
}
export interface SarifRule {
    id: string;
    shortDescription: {
        text: string;
    };
    defaultConfiguration: {
        level: 'error' | 'warning' | 'note';
    };
}
export interface SarifResult {
    ruleId: string;
    level: 'error' | 'warning' | 'note';
    message: {
        text: string;
    };
    locations: Array<{
        physicalLocation: {
            artifactLocation: {
                uri: string;
            };
            region?: {
                startLine: number;
            };
        };
    }>;
}
export declare function parseTraceSpec(spec: string): [string, string] | null;
export declare function buildSarifOutput(issues: AnalysisIssue[], toolVersion: string): SarifOutput;
export declare function formatIssuesAsText(issues: AnalysisIssue[], quiet: boolean): string;
export declare function formatIssuesAsJson(issues: AnalysisIssue[]): string;
//# sourceMappingURL=output.d.ts.map