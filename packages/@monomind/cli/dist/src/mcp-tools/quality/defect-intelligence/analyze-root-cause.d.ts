/**
 * analyze-root-cause.ts - Root cause analysis MCP tool handler
 *
 * Performs deep root cause analysis for defects using causal chain
 * analysis, historical pattern matching, and contributing factor identification.
 */
import { z } from 'zod';
export declare const AnalyzeRootCauseInputSchema: z.ZodObject<{
    defect: z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        description: z.ZodString;
        location: z.ZodOptional<z.ZodObject<{
            file: z.ZodString;
            line: z.ZodOptional<z.ZodNumber>;
            function: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            file: string;
            function?: string | undefined;
            line?: number | undefined;
        }, {
            file: string;
            function?: string | undefined;
            line?: number | undefined;
        }>>;
        category: z.ZodOptional<z.ZodString>;
        stackTrace: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        description: string;
        id?: string | undefined;
        category?: string | undefined;
        location?: {
            file: string;
            function?: string | undefined;
            line?: number | undefined;
        } | undefined;
        stackTrace?: string | undefined;
    }, {
        description: string;
        id?: string | undefined;
        category?: string | undefined;
        location?: {
            file: string;
            function?: string | undefined;
            line?: number | undefined;
        } | undefined;
        stackTrace?: string | undefined;
    }>;
    analysisDepth: z.ZodDefault<z.ZodEnum<["immediate", "standard", "deep"]>>;
    includeHistorical: z.ZodDefault<z.ZodBoolean>;
    includeRemediation: z.ZodDefault<z.ZodBoolean>;
    maxContributingFactors: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    analysisDepth: "standard" | "deep" | "immediate";
    defect: {
        description: string;
        id?: string | undefined;
        category?: string | undefined;
        location?: {
            file: string;
            function?: string | undefined;
            line?: number | undefined;
        } | undefined;
        stackTrace?: string | undefined;
    };
    includeHistorical: boolean;
    includeRemediation: boolean;
    maxContributingFactors: number;
}, {
    defect: {
        description: string;
        id?: string | undefined;
        category?: string | undefined;
        location?: {
            file: string;
            function?: string | undefined;
            line?: number | undefined;
        } | undefined;
        stackTrace?: string | undefined;
    };
    analysisDepth?: "standard" | "deep" | "immediate" | undefined;
    includeHistorical?: boolean | undefined;
    includeRemediation?: boolean | undefined;
    maxContributingFactors?: number | undefined;
}>;
export type AnalyzeRootCauseInput = z.infer<typeof AnalyzeRootCauseInputSchema>;
export interface AnalyzeRootCauseOutput {
    success: boolean;
    rootCause: RootCause;
    causalChain: CausalChainLink[];
    contributingFactors: ContributingFactor[];
    historicalAnalysis: HistoricalAnalysis | null;
    remediation: RemediationPlan | null;
    preventionMeasures: PreventionMeasure[];
    metadata: RootCauseMetadata;
}
export interface RootCause {
    id: string;
    type: 'code' | 'design' | 'process' | 'environment' | 'human';
    category: string;
    description: string;
    confidence: number;
    evidence: string[];
    technicalDetails: TechnicalDetails;
}
export interface TechnicalDetails {
    codePattern?: string;
    antiPattern?: string;
    affectedComponents: string[];
    dataFlow?: string;
    controlFlow?: string;
}
export interface CausalChainLink {
    level: number;
    description: string;
    type: 'symptom' | 'proximate' | 'intermediate' | 'root';
    evidence: string;
    confidence: number;
}
export interface ContributingFactor {
    id: string;
    category: 'technical' | 'process' | 'organizational' | 'environmental';
    description: string;
    severity: 'major' | 'moderate' | 'minor';
    evidence: string;
    addressable: boolean;
}
export interface HistoricalAnalysis {
    similarDefects: SimilarDefectMatch[];
    recurringPatterns: RecurringPattern[];
    trendAnalysis: TrendInfo;
}
export interface SimilarDefectMatch {
    defectId: string;
    similarity: number;
    resolution: string;
    resolvedDate: string;
    resolutionEffective: boolean;
}
export interface RecurringPattern {
    pattern: string;
    occurrences: number;
    firstSeen: string;
    lastSeen: string;
    addressed: boolean;
}
export interface TrendInfo {
    increasing: boolean;
    frequency: string;
    hotspots: string[];
}
export interface RemediationPlan {
    immediateActions: RemediationAction[];
    shortTermActions: RemediationAction[];
    longTermActions: RemediationAction[];
    estimatedEffort: string;
    riskIfUnaddressed: string;
}
export interface RemediationAction {
    priority: number;
    action: string;
    owner: string;
    effort: 'low' | 'medium' | 'high';
    impact: 'low' | 'medium' | 'high';
    timeframe: string;
}
export interface PreventionMeasure {
    measure: string;
    type: 'code-review' | 'testing' | 'tooling' | 'training' | 'process';
    effectiveness: number;
    implementation: string;
    cost: 'low' | 'medium' | 'high';
}
export interface RootCauseMetadata {
    analyzedAt: string;
    durationMs: number;
    analysisDepth: string;
    confidenceScore: number;
    methodsUsed: string[];
}
export interface ToolContext {
    get<T>(key: string): T | undefined;
}
/**
 * MCP Tool Handler for analyze-root-cause
 */
export declare function handler(input: AnalyzeRootCauseInput, context: ToolContext): Promise<{
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
        defect: z.ZodObject<{
            id: z.ZodOptional<z.ZodString>;
            description: z.ZodString;
            location: z.ZodOptional<z.ZodObject<{
                file: z.ZodString;
                line: z.ZodOptional<z.ZodNumber>;
                function: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                file: string;
                function?: string | undefined;
                line?: number | undefined;
            }, {
                file: string;
                function?: string | undefined;
                line?: number | undefined;
            }>>;
            category: z.ZodOptional<z.ZodString>;
            stackTrace: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            description: string;
            id?: string | undefined;
            category?: string | undefined;
            location?: {
                file: string;
                function?: string | undefined;
                line?: number | undefined;
            } | undefined;
            stackTrace?: string | undefined;
        }, {
            description: string;
            id?: string | undefined;
            category?: string | undefined;
            location?: {
                file: string;
                function?: string | undefined;
                line?: number | undefined;
            } | undefined;
            stackTrace?: string | undefined;
        }>;
        analysisDepth: z.ZodDefault<z.ZodEnum<["immediate", "standard", "deep"]>>;
        includeHistorical: z.ZodDefault<z.ZodBoolean>;
        includeRemediation: z.ZodDefault<z.ZodBoolean>;
        maxContributingFactors: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        analysisDepth: "standard" | "deep" | "immediate";
        defect: {
            description: string;
            id?: string | undefined;
            category?: string | undefined;
            location?: {
                file: string;
                function?: string | undefined;
                line?: number | undefined;
            } | undefined;
            stackTrace?: string | undefined;
        };
        includeHistorical: boolean;
        includeRemediation: boolean;
        maxContributingFactors: number;
    }, {
        defect: {
            description: string;
            id?: string | undefined;
            category?: string | undefined;
            location?: {
                file: string;
                function?: string | undefined;
                line?: number | undefined;
            } | undefined;
            stackTrace?: string | undefined;
        };
        analysisDepth?: "standard" | "deep" | "immediate" | undefined;
        includeHistorical?: boolean | undefined;
        includeRemediation?: boolean | undefined;
        maxContributingFactors?: number | undefined;
    }>;
    handler: typeof handler;
};
export default toolDefinition;
//# sourceMappingURL=analyze-root-cause.d.ts.map