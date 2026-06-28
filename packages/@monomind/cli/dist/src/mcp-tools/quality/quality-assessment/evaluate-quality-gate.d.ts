/**
 * evaluate-quality-gate.ts - Quality gate evaluation MCP tool handler
 *
 * Evaluates quality gates against defined thresholds to determine
 * release readiness. Supports multiple metrics and custom gate configurations.
 */
import { z } from 'zod';
export declare const EvaluateQualityGateInputSchema: z.ZodObject<{
    gates: z.ZodOptional<z.ZodArray<z.ZodObject<{
        metric: z.ZodString;
        operator: z.ZodEnum<{
            ">": ">";
            "<": "<";
            ">=": ">=";
            "<=": "<=";
            "==": "==";
        }>;
        threshold: z.ZodNumber;
        weight: z.ZodDefault<z.ZodNumber>;
        blocking: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>>>;
    defaults: z.ZodDefault<z.ZodEnum<{
        minimal: "minimal";
        standard: "standard";
        strict: "strict";
    }>>;
    projectPath: z.ZodOptional<z.ZodString>;
    includeMetrics: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        security: "security";
        coverage: "coverage";
        complexity: "complexity";
        bugs: "bugs";
        vulnerabilities: "vulnerabilities";
        "code-smells": "code-smells";
        duplications: "duplications";
        "technical-debt": "technical-debt";
        reliability: "reliability";
        maintainability: "maintainability";
    }>>>;
    failFast: z.ZodDefault<z.ZodBoolean>;
    generateReport: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type EvaluateQualityGateInput = z.infer<typeof EvaluateQualityGateInputSchema>;
export interface EvaluateQualityGateOutput {
    success: boolean;
    passed: boolean;
    overallScore: number;
    gateResults: GateResult[];
    metrics: CollectedMetrics;
    blockers: GateResult[];
    warnings: GateResult[];
    report: QualityReport | null;
    metadata: QualityGateMetadata;
}
export interface GateResult {
    metric: string;
    operator: string;
    threshold: number;
    actual: number;
    passed: boolean;
    blocking: boolean;
    weight: number;
    deviation: number;
    message: string;
}
export interface CollectedMetrics {
    coverage: CoverageMetrics;
    bugs: BugMetrics;
    vulnerabilities: VulnerabilityMetrics;
    codeSmells: CodeSmellMetrics;
    duplications: DuplicationMetrics;
    complexity: ComplexityMetrics;
    technicalDebt: TechnicalDebtMetrics;
    ratings: QualityRatings;
}
export interface CoverageMetrics {
    line: number;
    branch: number;
    function: number;
    overall: number;
}
export interface BugMetrics {
    total: number;
    critical: number;
    major: number;
    minor: number;
}
export interface VulnerabilityMetrics {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
}
export interface CodeSmellMetrics {
    total: number;
    debt: string;
    ratio: number;
}
export interface DuplicationMetrics {
    lines: number;
    blocks: number;
    percentage: number;
}
export interface ComplexityMetrics {
    cyclomatic: number;
    cognitive: number;
    avgPerFunction: number;
}
export interface TechnicalDebtMetrics {
    total: string;
    ratio: number;
    rating: 'A' | 'B' | 'C' | 'D' | 'E';
}
export interface QualityRatings {
    reliability: 'A' | 'B' | 'C' | 'D' | 'E';
    security: 'A' | 'B' | 'C' | 'D' | 'E';
    maintainability: 'A' | 'B' | 'C' | 'D' | 'E';
}
export interface QualityReport {
    summary: string;
    recommendations: string[];
    trends: TrendComparison[];
    riskAreas: RiskArea[];
}
export interface TrendComparison {
    metric: string;
    previous: number;
    current: number;
    trend: 'improving' | 'stable' | 'declining';
}
export interface RiskArea {
    name: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    files: string[];
}
export interface QualityGateMetadata {
    evaluatedAt: string;
    durationMs: number;
    preset: string;
    totalGates: number;
    passedGates: number;
    failedGates: number;
}
export interface ToolContext {
    get<T>(key: string): T | undefined;
}
/**
 * MCP Tool Handler for evaluate-quality-gate
 */
export declare function handler(input: EvaluateQualityGateInput, context: ToolContext): Promise<{
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
        gates: z.ZodOptional<z.ZodArray<z.ZodObject<{
            metric: z.ZodString;
            operator: z.ZodEnum<{
                ">": ">";
                "<": "<";
                ">=": ">=";
                "<=": "<=";
                "==": "==";
            }>;
            threshold: z.ZodNumber;
            weight: z.ZodDefault<z.ZodNumber>;
            blocking: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strip>>>;
        defaults: z.ZodDefault<z.ZodEnum<{
            minimal: "minimal";
            standard: "standard";
            strict: "strict";
        }>>;
        projectPath: z.ZodOptional<z.ZodString>;
        includeMetrics: z.ZodDefault<z.ZodArray<z.ZodEnum<{
            security: "security";
            coverage: "coverage";
            complexity: "complexity";
            bugs: "bugs";
            vulnerabilities: "vulnerabilities";
            "code-smells": "code-smells";
            duplications: "duplications";
            "technical-debt": "technical-debt";
            reliability: "reliability";
            maintainability: "maintainability";
        }>>>;
        failFast: z.ZodDefault<z.ZodBoolean>;
        generateReport: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>;
    handler: typeof handler;
};
export default toolDefinition;
//# sourceMappingURL=evaluate-quality-gate.d.ts.map