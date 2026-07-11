/**
 * prioritize-gaps.ts - Risk-based gap prioritization MCP tool handler
 *
 * Prioritizes coverage gaps based on multiple risk factors including
 * code complexity, change frequency, business criticality, and defect history.
 */
import { z } from 'zod';
export declare const PrioritizeGapsInputSchema: z.ZodObject<{
    gaps: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        type: z.ZodEnum<["line", "branch", "function"]>;
        file: z.ZodString;
        startLine: z.ZodNumber;
        endLine: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        id: string;
        type: "function" | "line" | "branch";
        file: string;
        startLine: number;
        endLine: number;
    }, {
        id: string;
        type: "function" | "line" | "branch";
        file: string;
        startLine: number;
        endLine: number;
    }>, "many">>;
    targetPath: z.ZodOptional<z.ZodString>;
    factors: z.ZodDefault<z.ZodArray<z.ZodEnum<["complexity", "change-frequency", "defect-history", "business-critical", "dependency-count", "test-difficulty"]>, "many">>;
    weights: z.ZodOptional<z.ZodObject<{
        complexity: z.ZodDefault<z.ZodNumber>;
        changeFrequency: z.ZodDefault<z.ZodNumber>;
        defectHistory: z.ZodDefault<z.ZodNumber>;
        businessCritical: z.ZodDefault<z.ZodNumber>;
        dependencyCount: z.ZodDefault<z.ZodNumber>;
        testDifficulty: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        complexity: number;
        changeFrequency: number;
        defectHistory: number;
        businessCritical: number;
        dependencyCount: number;
        testDifficulty: number;
    }, {
        complexity?: number | undefined;
        changeFrequency?: number | undefined;
        defectHistory?: number | undefined;
        businessCritical?: number | undefined;
        dependencyCount?: number | undefined;
        testDifficulty?: number | undefined;
    }>>;
    limit: z.ZodDefault<z.ZodNumber>;
    groupBy: z.ZodDefault<z.ZodEnum<["risk", "file", "type", "none"]>>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    factors: ("complexity" | "change-frequency" | "defect-history" | "business-critical" | "dependency-count" | "test-difficulty")[];
    groupBy: "type" | "none" | "file" | "risk";
    weights?: {
        complexity: number;
        changeFrequency: number;
        defectHistory: number;
        businessCritical: number;
        dependencyCount: number;
        testDifficulty: number;
    } | undefined;
    gaps?: {
        id: string;
        type: "function" | "line" | "branch";
        file: string;
        startLine: number;
        endLine: number;
    }[] | undefined;
    targetPath?: string | undefined;
}, {
    limit?: number | undefined;
    weights?: {
        complexity?: number | undefined;
        changeFrequency?: number | undefined;
        defectHistory?: number | undefined;
        businessCritical?: number | undefined;
        dependencyCount?: number | undefined;
        testDifficulty?: number | undefined;
    } | undefined;
    gaps?: {
        id: string;
        type: "function" | "line" | "branch";
        file: string;
        startLine: number;
        endLine: number;
    }[] | undefined;
    targetPath?: string | undefined;
    factors?: ("complexity" | "change-frequency" | "defect-history" | "business-critical" | "dependency-count" | "test-difficulty")[] | undefined;
    groupBy?: "type" | "none" | "file" | "risk" | undefined;
}>;
export type PrioritizeGapsInput = z.infer<typeof PrioritizeGapsInputSchema>;
export interface PrioritizeGapsOutput {
    success: boolean;
    prioritizedGaps: PrioritizedGap[];
    groups: GapGroup[];
    statistics: PrioritizationStatistics;
    recommendations: Recommendation[];
    metadata: PrioritizationMetadata;
}
export interface PrioritizedGap {
    id: string;
    type: 'line' | 'branch' | 'function';
    file: string;
    location: {
        startLine: number;
        endLine: number;
    };
    risk: 'critical' | 'high' | 'medium' | 'low';
    priorityScore: number;
    factors: FactorScore[];
    effort: 'low' | 'medium' | 'high';
    roi: number;
}
export interface FactorScore {
    factor: string;
    score: number;
    weight: number;
    contribution: number;
    details: string;
}
export interface GapGroup {
    name: string;
    count: number;
    avgPriorityScore: number;
    gaps: PrioritizedGap[];
}
export interface PrioritizationStatistics {
    totalGaps: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    avgPriorityScore: number;
    avgEffort: string;
    estimatedTestingEffort: string;
}
export interface Recommendation {
    type: 'immediate-action' | 'short-term' | 'long-term';
    priority: number;
    description: string;
    affectedGaps: string[];
    expectedImpact: string;
}
export interface PrioritizationMetadata {
    analyzedAt: string;
    durationMs: number;
    factorsUsed: string[];
    weightsApplied: Record<string, number>;
}
export interface ToolContext {
    get<T>(key: string): T | undefined;
}
/**
 * MCP Tool Handler for prioritize-gaps
 */
export declare function handler(input: PrioritizeGapsInput, context: ToolContext): Promise<{
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
        gaps: z.ZodOptional<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            type: z.ZodEnum<["line", "branch", "function"]>;
            file: z.ZodString;
            startLine: z.ZodNumber;
            endLine: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            id: string;
            type: "function" | "line" | "branch";
            file: string;
            startLine: number;
            endLine: number;
        }, {
            id: string;
            type: "function" | "line" | "branch";
            file: string;
            startLine: number;
            endLine: number;
        }>, "many">>;
        targetPath: z.ZodOptional<z.ZodString>;
        factors: z.ZodDefault<z.ZodArray<z.ZodEnum<["complexity", "change-frequency", "defect-history", "business-critical", "dependency-count", "test-difficulty"]>, "many">>;
        weights: z.ZodOptional<z.ZodObject<{
            complexity: z.ZodDefault<z.ZodNumber>;
            changeFrequency: z.ZodDefault<z.ZodNumber>;
            defectHistory: z.ZodDefault<z.ZodNumber>;
            businessCritical: z.ZodDefault<z.ZodNumber>;
            dependencyCount: z.ZodDefault<z.ZodNumber>;
            testDifficulty: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            complexity: number;
            changeFrequency: number;
            defectHistory: number;
            businessCritical: number;
            dependencyCount: number;
            testDifficulty: number;
        }, {
            complexity?: number | undefined;
            changeFrequency?: number | undefined;
            defectHistory?: number | undefined;
            businessCritical?: number | undefined;
            dependencyCount?: number | undefined;
            testDifficulty?: number | undefined;
        }>>;
        limit: z.ZodDefault<z.ZodNumber>;
        groupBy: z.ZodDefault<z.ZodEnum<["risk", "file", "type", "none"]>>;
    }, "strip", z.ZodTypeAny, {
        limit: number;
        factors: ("complexity" | "change-frequency" | "defect-history" | "business-critical" | "dependency-count" | "test-difficulty")[];
        groupBy: "type" | "none" | "file" | "risk";
        weights?: {
            complexity: number;
            changeFrequency: number;
            defectHistory: number;
            businessCritical: number;
            dependencyCount: number;
            testDifficulty: number;
        } | undefined;
        gaps?: {
            id: string;
            type: "function" | "line" | "branch";
            file: string;
            startLine: number;
            endLine: number;
        }[] | undefined;
        targetPath?: string | undefined;
    }, {
        limit?: number | undefined;
        weights?: {
            complexity?: number | undefined;
            changeFrequency?: number | undefined;
            defectHistory?: number | undefined;
            businessCritical?: number | undefined;
            dependencyCount?: number | undefined;
            testDifficulty?: number | undefined;
        } | undefined;
        gaps?: {
            id: string;
            type: "function" | "line" | "branch";
            file: string;
            startLine: number;
            endLine: number;
        }[] | undefined;
        targetPath?: string | undefined;
        factors?: ("complexity" | "change-frequency" | "defect-history" | "business-critical" | "dependency-count" | "test-difficulty")[] | undefined;
        groupBy?: "type" | "none" | "file" | "risk" | undefined;
    }>;
    handler: typeof handler;
};
export default toolDefinition;
//# sourceMappingURL=prioritize-gaps.d.ts.map