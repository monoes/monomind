/**
 * predict-defects.ts - ML-based defect prediction MCP tool handler
 *
 * Predicts potential defects using machine learning analysis of code
 * complexity, historical patterns, and semantic similarity to known defects.
 */
import { z } from 'zod';
export declare const PredictDefectsInputSchema: z.ZodObject<{
    targetPath: z.ZodString;
    depth: z.ZodDefault<z.ZodEnum<{
        medium: "medium";
        shallow: "shallow";
        deep: "deep";
    }>>;
    includeRootCause: z.ZodDefault<z.ZodBoolean>;
    minConfidence: z.ZodDefault<z.ZodNumber>;
    categories: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        security: "security";
        performance: "performance";
        boundary: "boundary";
        "null-pointer": "null-pointer";
        "resource-leak": "resource-leak";
        "race-condition": "race-condition";
        "logic-error": "logic-error";
        "type-error": "type-error";
        "exception-handling": "exception-handling";
    }>>>;
    useSimilarPatterns: z.ZodDefault<z.ZodBoolean>;
    maxPredictions: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type PredictDefectsInput = z.infer<typeof PredictDefectsInputSchema>;
export interface PredictDefectsOutput {
    success: boolean;
    predictions: DefectPrediction[];
    riskSummary: RiskSummary;
    similarDefects: SimilarDefect[];
    preventionStrategies: PreventionStrategy[];
    metadata: PredictionMetadata;
}
export interface DefectPrediction {
    id: string;
    category: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    confidence: number;
    location: CodeLocation;
    description: string;
    rootCause?: RootCauseAnalysis;
    evidence: Evidence[];
    suggestedFix: string;
}
export interface CodeLocation {
    file: string;
    startLine?: number;
    endLine?: number;
    functionName?: string;
    codeSnippet?: string;
}
export interface RootCauseAnalysis {
    primaryCause: string;
    contributingFactors: string[];
    codePattern: string;
    historicalOccurrences: number;
}
export interface Evidence {
    type: 'code-pattern' | 'complexity' | 'history' | 'semantic' | 'static-analysis';
    description: string;
    weight: number;
}
export interface RiskSummary {
    totalPredictions: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    avgConfidence: number;
    highRiskAreas: string[];
}
export interface SimilarDefect {
    id: string;
    similarity: number;
    originalDefect: {
        category: string;
        description: string;
        resolution: string;
        file: string;
    };
    matchedPattern: string;
}
export interface PreventionStrategy {
    category: string;
    strategy: string;
    implementation: string;
    effectiveness: number;
    affectedPredictions: string[];
}
export interface PredictionMetadata {
    analyzedAt: string;
    durationMs: number;
    filesAnalyzed: number;
    linesAnalyzed: number;
    patternsMatched: number;
    modelVersion: string;
}
export interface ToolContext {
    get<T>(key: string): T | undefined;
}
/**
 * MCP Tool Handler for predict-defects
 */
export declare function handler(input: PredictDefectsInput, context: ToolContext): Promise<{
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
        depth: z.ZodDefault<z.ZodEnum<{
            medium: "medium";
            shallow: "shallow";
            deep: "deep";
        }>>;
        includeRootCause: z.ZodDefault<z.ZodBoolean>;
        minConfidence: z.ZodDefault<z.ZodNumber>;
        categories: z.ZodDefault<z.ZodArray<z.ZodEnum<{
            security: "security";
            performance: "performance";
            boundary: "boundary";
            "null-pointer": "null-pointer";
            "resource-leak": "resource-leak";
            "race-condition": "race-condition";
            "logic-error": "logic-error";
            "type-error": "type-error";
            "exception-handling": "exception-handling";
        }>>>;
        useSimilarPatterns: z.ZodDefault<z.ZodBoolean>;
        maxPredictions: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>;
    handler: typeof handler;
};
export default toolDefinition;
//# sourceMappingURL=predict-defects.d.ts.map