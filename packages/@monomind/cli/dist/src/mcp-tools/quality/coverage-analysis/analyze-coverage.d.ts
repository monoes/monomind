/**
 * analyze-coverage.ts - O(log n) Johnson-Lindenstrauss coverage analysis
 *
 * Performs efficient coverage analysis using Johnson-Lindenstrauss random
 * projection for O(log n) gap detection instead of O(n) full scan.
 */
import { z } from 'zod';
export declare const AnalyzeCoverageInputSchema: z.ZodObject<{
    targetPath: z.ZodString;
    coverageReport: z.ZodOptional<z.ZodString>;
    algorithm: z.ZodDefault<z.ZodEnum<["johnson-lindenstrauss", "full-scan"]>>;
    prioritize: z.ZodDefault<z.ZodBoolean>;
    includeFileDetails: z.ZodDefault<z.ZodBoolean>;
    thresholds: z.ZodOptional<z.ZodObject<{
        line: z.ZodDefault<z.ZodNumber>;
        branch: z.ZodDefault<z.ZodNumber>;
        function: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        function: number;
        line: number;
        branch: number;
    }, {
        function?: number | undefined;
        line?: number | undefined;
        branch?: number | undefined;
    }>>;
    projectionDimension: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    algorithm: "johnson-lindenstrauss" | "full-scan";
    prioritize: boolean;
    targetPath: string;
    includeFileDetails: boolean;
    projectionDimension: number;
    coverageReport?: string | undefined;
    thresholds?: {
        function: number;
        line: number;
        branch: number;
    } | undefined;
}, {
    targetPath: string;
    algorithm?: "johnson-lindenstrauss" | "full-scan" | undefined;
    prioritize?: boolean | undefined;
    coverageReport?: string | undefined;
    includeFileDetails?: boolean | undefined;
    thresholds?: {
        function?: number | undefined;
        line?: number | undefined;
        branch?: number | undefined;
    } | undefined;
    projectionDimension?: number | undefined;
}>;
export type AnalyzeCoverageInput = z.infer<typeof AnalyzeCoverageInputSchema>;
export interface AnalyzeCoverageOutput {
    success: boolean;
    summary: CoverageSummary;
    gaps: CoverageGap[];
    files: FileCoverage[];
    thresholdResults: ThresholdResult[];
    algorithm: AlgorithmInfo;
    metadata: AnalysisMetadata;
}
export interface CoverageSummary {
    lines: CoverageMetric;
    branches: CoverageMetric;
    functions: CoverageMetric;
    statements: CoverageMetric;
    overall: number;
    trend: 'improving' | 'declining' | 'stable';
}
export interface CoverageMetric {
    covered: number;
    total: number;
    percentage: number;
}
export interface CoverageGap {
    id: string;
    type: 'line' | 'branch' | 'function';
    file: string;
    location: {
        startLine: number;
        endLine: number;
    };
    risk: 'critical' | 'high' | 'medium' | 'low';
    riskScore: number;
    reason: string;
    suggestions: string[];
}
export interface FileCoverage {
    path: string;
    lines: CoverageMetric;
    branches: CoverageMetric;
    functions: CoverageMetric;
    uncoveredRanges: Array<{
        start: number;
        end: number;
    }>;
    complexity: number;
}
export interface ThresholdResult {
    metric: string;
    threshold: number;
    actual: number;
    passed: boolean;
    gap: number;
}
export interface AlgorithmInfo {
    name: string;
    complexity: string;
    projectionDimension?: number;
    accuracy: number;
    speedup: number;
}
export interface AnalysisMetadata {
    analyzedAt: string;
    durationMs: number;
    filesAnalyzed: number;
    totalLines: number;
    algorithm: string;
}
export interface ToolContext {
    get<T>(key: string): T | undefined;
}
/**
 * MCP Tool Handler for analyze-coverage
 */
export declare function handler(input: AnalyzeCoverageInput, context: ToolContext): Promise<{
    content: Array<{
        type: 'text';
        text: string;
    }>;
}>;
export declare const toolDefinition: {
    name: string;
    description: string;
    category: string;
    version: string;
    inputSchema: z.ZodObject<{
        targetPath: z.ZodString;
        coverageReport: z.ZodOptional<z.ZodString>;
        algorithm: z.ZodDefault<z.ZodEnum<["johnson-lindenstrauss", "full-scan"]>>;
        prioritize: z.ZodDefault<z.ZodBoolean>;
        includeFileDetails: z.ZodDefault<z.ZodBoolean>;
        thresholds: z.ZodOptional<z.ZodObject<{
            line: z.ZodDefault<z.ZodNumber>;
            branch: z.ZodDefault<z.ZodNumber>;
            function: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            function: number;
            line: number;
            branch: number;
        }, {
            function?: number | undefined;
            line?: number | undefined;
            branch?: number | undefined;
        }>>;
        projectionDimension: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        algorithm: "johnson-lindenstrauss" | "full-scan";
        prioritize: boolean;
        targetPath: string;
        includeFileDetails: boolean;
        projectionDimension: number;
        coverageReport?: string | undefined;
        thresholds?: {
            function: number;
            line: number;
            branch: number;
        } | undefined;
    }, {
        targetPath: string;
        algorithm?: "johnson-lindenstrauss" | "full-scan" | undefined;
        prioritize?: boolean | undefined;
        coverageReport?: string | undefined;
        includeFileDetails?: boolean | undefined;
        thresholds?: {
            function?: number | undefined;
            line?: number | undefined;
            branch?: number | undefined;
        } | undefined;
        projectionDimension?: number | undefined;
    }>;
    handler: typeof handler;
};
export default toolDefinition;
//# sourceMappingURL=analyze-coverage.d.ts.map