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
    algorithm: z.ZodDefault<z.ZodEnum<{
        "johnson-lindenstrauss": "johnson-lindenstrauss";
        "full-scan": "full-scan";
    }>>;
    prioritize: z.ZodDefault<z.ZodBoolean>;
    includeFileDetails: z.ZodDefault<z.ZodBoolean>;
    thresholds: z.ZodOptional<z.ZodObject<{
        line: z.ZodDefault<z.ZodNumber>;
        branch: z.ZodDefault<z.ZodNumber>;
        function: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    projectionDimension: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
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
        algorithm: z.ZodDefault<z.ZodEnum<{
            "johnson-lindenstrauss": "johnson-lindenstrauss";
            "full-scan": "full-scan";
        }>>;
        prioritize: z.ZodDefault<z.ZodBoolean>;
        includeFileDetails: z.ZodDefault<z.ZodBoolean>;
        thresholds: z.ZodOptional<z.ZodObject<{
            line: z.ZodDefault<z.ZodNumber>;
            branch: z.ZodDefault<z.ZodNumber>;
            function: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>>;
        projectionDimension: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>;
    handler: typeof handler;
};
export default toolDefinition;
//# sourceMappingURL=analyze-coverage.d.ts.map