/**
 * suggest-tests.ts - Coverage gap test suggestions MCP tool handler
 *
 * Analyzes existing code and coverage data to suggest tests that would
 * improve coverage in areas that matter most based on risk and complexity.
 */
import { z } from 'zod';
export declare const SuggestTestsInputSchema: z.ZodObject<{
    targetPath: z.ZodString;
    coverageReport: z.ZodOptional<z.ZodString>;
    focusAreas: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        lines: "lines";
        branches: "branches";
        functions: "functions";
        "edge-cases": "edge-cases";
        "error-handling": "error-handling";
        boundaries: "boundaries";
    }>>>;
    maxSuggestions: z.ZodDefault<z.ZodNumber>;
    priorityBy: z.ZodDefault<z.ZodEnum<{
        risk: "risk";
        complexity: "complexity";
        "coverage-impact": "coverage-impact";
        "change-frequency": "change-frequency";
    }>>;
    includeCode: z.ZodDefault<z.ZodBoolean>;
    framework: z.ZodDefault<z.ZodEnum<{
        vitest: "vitest";
        jest: "jest";
        mocha: "mocha";
        pytest: "pytest";
        junit: "junit";
    }>>;
}, z.core.$strip>;
export type SuggestTestsInput = z.infer<typeof SuggestTestsInputSchema>;
export interface SuggestTestsOutput {
    success: boolean;
    suggestions: TestSuggestion[];
    coverageAnalysis: CoverageAnalysisSummary;
    prioritization: PrioritizationInfo;
    metadata: SuggestionMetadata;
}
export interface TestSuggestion {
    id: string;
    type: 'branch' | 'function' | 'line' | 'edge-case' | 'error-handling' | 'boundary';
    priority: 'critical' | 'high' | 'medium' | 'low';
    title: string;
    description: string;
    targetLocation: CodeLocation;
    rationale: string;
    estimatedCoverageGain: number;
    complexity: 'simple' | 'moderate' | 'complex';
    testCode?: string;
    relatedTests?: string[];
}
export interface CodeLocation {
    file: string;
    startLine: number;
    endLine: number;
    functionName?: string;
    className?: string;
}
export interface CoverageAnalysisSummary {
    currentCoverage: CoverageMetrics;
    projectedCoverage: CoverageMetrics;
    uncoveredAreas: UncoveredArea[];
}
export interface CoverageMetrics {
    lines: number;
    branches: number;
    functions: number;
    statements: number;
}
export interface UncoveredArea {
    type: string;
    location: CodeLocation;
    risk: 'critical' | 'high' | 'medium' | 'low';
    reason: string;
}
export interface PrioritizationInfo {
    strategy: string;
    factors: PrioritizationFactor[];
    riskScore: number;
}
export interface PrioritizationFactor {
    name: string;
    weight: number;
    value: number;
    description: string;
}
export interface SuggestionMetadata {
    generatedAt: string;
    analysisTimeMs: number;
    filesAnalyzed: number;
    totalUncoveredLines: number;
    totalUncoveredBranches: number;
}
export interface ToolContext {
    get<T>(key: string): T | undefined;
}
/**
 * MCP Tool Handler for suggest-tests
 */
export declare function handler(input: SuggestTestsInput, context: ToolContext): Promise<{
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
        focusAreas: z.ZodDefault<z.ZodArray<z.ZodEnum<{
            lines: "lines";
            branches: "branches";
            functions: "functions";
            "edge-cases": "edge-cases";
            "error-handling": "error-handling";
            boundaries: "boundaries";
        }>>>;
        maxSuggestions: z.ZodDefault<z.ZodNumber>;
        priorityBy: z.ZodDefault<z.ZodEnum<{
            risk: "risk";
            complexity: "complexity";
            "coverage-impact": "coverage-impact";
            "change-frequency": "change-frequency";
        }>>;
        includeCode: z.ZodDefault<z.ZodBoolean>;
        framework: z.ZodDefault<z.ZodEnum<{
            vitest: "vitest";
            jest: "jest";
            mocha: "mocha";
            pytest: "pytest";
            junit: "junit";
        }>>;
    }, z.core.$strip>;
    handler: typeof handler;
};
export default toolDefinition;
//# sourceMappingURL=suggest-tests.d.ts.map