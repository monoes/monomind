/**
 * assess-readiness.ts - Release readiness assessment MCP tool handler
 *
 * Comprehensive release readiness assessment combining quality metrics,
 * test results, risk factors, and stakeholder criteria.
 */
import { z } from 'zod';
export declare const AssessReadinessInputSchema: z.ZodObject<{
    releaseType: z.ZodDefault<z.ZodEnum<{
        minor: "minor";
        major: "major";
        patch: "patch";
        hotfix: "hotfix";
    }>>;
    projectPath: z.ZodOptional<z.ZodString>;
    criteria: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        category: z.ZodEnum<{
            security: "security";
            performance: "performance";
            documentation: "documentation";
            testing: "testing";
            quality: "quality";
            compliance: "compliance";
        }>;
        required: z.ZodDefault<z.ZodBoolean>;
        weight: z.ZodDefault<z.ZodNumber>;
    }, z.core.$strip>>>;
    includeChecks: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        dependencies: "dependencies";
        documentation: "documentation";
        "quality-gates": "quality-gates";
        "test-results": "test-results";
        "security-scan": "security-scan";
        "performance-baseline": "performance-baseline";
        "change-log": "change-log";
        "rollback-plan": "rollback-plan";
    }>>>;
    compareToRelease: z.ZodOptional<z.ZodString>;
    strictMode: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export type AssessReadinessInput = z.infer<typeof AssessReadinessInputSchema>;
export interface AssessReadinessOutput {
    success: boolean;
    ready: boolean;
    confidence: number;
    verdict: ReadinessVerdict;
    checkResults: CheckResult[];
    riskAssessment: RiskAssessment;
    blockers: Blocker[];
    warnings: Warning[];
    signOffRequired: SignOff[];
    releaseNotes: ReleaseNotes;
    metadata: ReadinessMetadata;
}
export interface ReadinessVerdict {
    decision: 'go' | 'no-go' | 'conditional';
    reason: string;
    conditions?: string[];
}
export interface CheckResult {
    name: string;
    category: string;
    status: 'passed' | 'failed' | 'warning' | 'skipped';
    required: boolean;
    score: number;
    details: string;
    evidence: Evidence[];
}
export interface Evidence {
    type: string;
    value: string;
    link?: string;
}
export interface RiskAssessment {
    overallRisk: 'low' | 'medium' | 'high' | 'critical';
    riskScore: number;
    factors: RiskFactor[];
    mitigations: Mitigation[];
}
export interface RiskFactor {
    name: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    likelihood: 'unlikely' | 'possible' | 'likely' | 'certain';
    impact: string;
    mitigation?: string;
}
export interface Mitigation {
    risk: string;
    action: string;
    owner: string;
    status: 'planned' | 'in-progress' | 'complete';
}
export interface Blocker {
    id: string;
    severity: 'critical' | 'high';
    description: string;
    resolution: string;
    owner?: string;
}
export interface Warning {
    id: string;
    severity: 'medium' | 'low';
    description: string;
    recommendation: string;
}
export interface SignOff {
    role: string;
    status: 'pending' | 'approved' | 'rejected';
    approver?: string;
    date?: string;
    notes?: string;
}
export interface ReleaseNotes {
    version: string;
    date: string;
    highlights: string[];
    features: string[];
    bugFixes: string[];
    breakingChanges: string[];
    knownIssues: string[];
}
export interface ReadinessMetadata {
    assessedAt: string;
    durationMs: number;
    releaseType: string;
    checksPerformed: number;
    checksPassed: number;
    comparedTo?: string;
}
export interface ToolContext {
    get<T>(key: string): T | undefined;
}
/**
 * MCP Tool Handler for assess-readiness
 */
export declare function handler(input: AssessReadinessInput, context: ToolContext): Promise<{
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
        releaseType: z.ZodDefault<z.ZodEnum<{
            minor: "minor";
            major: "major";
            patch: "patch";
            hotfix: "hotfix";
        }>>;
        projectPath: z.ZodOptional<z.ZodString>;
        criteria: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            category: z.ZodEnum<{
                security: "security";
                performance: "performance";
                documentation: "documentation";
                testing: "testing";
                quality: "quality";
                compliance: "compliance";
            }>;
            required: z.ZodDefault<z.ZodBoolean>;
            weight: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strip>>>;
        includeChecks: z.ZodDefault<z.ZodArray<z.ZodEnum<{
            dependencies: "dependencies";
            documentation: "documentation";
            "quality-gates": "quality-gates";
            "test-results": "test-results";
            "security-scan": "security-scan";
            "performance-baseline": "performance-baseline";
            "change-log": "change-log";
            "rollback-plan": "rollback-plan";
        }>>>;
        compareToRelease: z.ZodOptional<z.ZodString>;
        strictMode: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strip>;
    handler: typeof handler;
};
export default toolDefinition;
//# sourceMappingURL=assess-readiness.d.ts.map