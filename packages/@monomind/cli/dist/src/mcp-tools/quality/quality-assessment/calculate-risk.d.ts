/**
 * calculate-risk.ts - Quality risk calculation MCP tool handler
 *
 * Calculates quality risk scores based on code complexity, test coverage,
 * change frequency, defect history, and other factors.
 */
import { z } from 'zod';
export declare const CalculateRiskInputSchema: z.ZodObject<{
    targetPath: z.ZodString;
    factors: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        documentation: "documentation";
        size: "size";
        coverage: "coverage";
        complexity: "complexity";
        age: "age";
        "change-frequency": "change-frequency";
        "defect-density": "defect-density";
        coupling: "coupling";
        "team-experience": "team-experience";
    }>>>;
    weights: z.ZodOptional<z.ZodObject<{
        complexity: z.ZodDefault<z.ZodNumber>;
        coverage: z.ZodDefault<z.ZodNumber>;
        changeFrequency: z.ZodDefault<z.ZodNumber>;
        defectDensity: z.ZodDefault<z.ZodNumber>;
        age: z.ZodDefault<z.ZodNumber>;
        coupling: z.ZodDefault<z.ZodNumber>;
        size: z.ZodDefault<z.ZodNumber>;
        teamExperience: z.ZodDefault<z.ZodNumber>;
        documentation: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    granularity: z.ZodDefault<z.ZodEnum<{
        function: "function";
        project: "project";
        module: "module";
        file: "file";
    }>>;
    riskThresholds: z.ZodOptional<z.ZodObject<{
        low: z.ZodDefault<z.ZodNumber>;
        medium: z.ZodDefault<z.ZodNumber>;
        high: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>;
    includeRecommendations: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type CalculateRiskInput = z.infer<typeof CalculateRiskInputSchema>;
export interface CalculateRiskOutput {
    success: boolean;
    overallRisk: RiskScore;
    componentRisks: ComponentRisk[];
    factorContributions: FactorContribution[];
    hotspots: RiskHotspot[];
    recommendations: RiskRecommendation[];
    trendAnalysis: RiskTrend;
    metadata: RiskMetadata;
}
export interface RiskScore {
    score: number;
    level: 'low' | 'medium' | 'high' | 'critical';
    confidence: number;
    breakdown: Record<string, number>;
}
export interface ComponentRisk {
    path: string;
    type: 'file' | 'module' | 'function';
    riskScore: number;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    factors: Record<string, number>;
    topIssues: string[];
}
export interface FactorContribution {
    factor: string;
    weight: number;
    rawScore: number;
    weightedScore: number;
    percentageContribution: number;
    details: string;
}
export interface RiskHotspot {
    path: string;
    riskScore: number;
    primaryFactor: string;
    description: string;
    urgency: 'immediate' | 'short-term' | 'long-term';
}
export interface RiskRecommendation {
    priority: number;
    factor: string;
    action: string;
    expectedImpact: string;
    effort: 'low' | 'medium' | 'high';
    affectedComponents: string[];
}
export interface RiskTrend {
    direction: 'improving' | 'stable' | 'worsening';
    changePercent: number;
    historicalScores: Array<{
        date: string;
        score: number;
    }>;
    projection: number;
}
export interface RiskMetadata {
    calculatedAt: string;
    durationMs: number;
    targetPath: string;
    componentsAnalyzed: number;
    factorsUsed: string[];
}
export interface ToolContext {
    get<T>(key: string): T | undefined;
}
/**
 * MCP Tool Handler for calculate-risk
 */
export declare function handler(input: CalculateRiskInput, context: ToolContext): Promise<{
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
        factors: z.ZodDefault<z.ZodArray<z.ZodEnum<{
            documentation: "documentation";
            size: "size";
            coverage: "coverage";
            complexity: "complexity";
            age: "age";
            "change-frequency": "change-frequency";
            "defect-density": "defect-density";
            coupling: "coupling";
            "team-experience": "team-experience";
        }>>>;
        weights: z.ZodOptional<z.ZodObject<{
            complexity: z.ZodDefault<z.ZodNumber>;
            coverage: z.ZodDefault<z.ZodNumber>;
            changeFrequency: z.ZodDefault<z.ZodNumber>;
            defectDensity: z.ZodDefault<z.ZodNumber>;
            age: z.ZodDefault<z.ZodNumber>;
            coupling: z.ZodDefault<z.ZodNumber>;
            size: z.ZodDefault<z.ZodNumber>;
            teamExperience: z.ZodDefault<z.ZodNumber>;
            documentation: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>>;
        granularity: z.ZodDefault<z.ZodEnum<{
            function: "function";
            project: "project";
            module: "module";
            file: "file";
        }>>;
        riskThresholds: z.ZodOptional<z.ZodObject<{
            low: z.ZodDefault<z.ZodNumber>;
            medium: z.ZodDefault<z.ZodNumber>;
            high: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>>;
        includeRecommendations: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>;
    handler: typeof handler;
};
export default toolDefinition;
//# sourceMappingURL=calculate-risk.d.ts.map