/**
 * assess-readiness.ts - Release readiness assessment MCP tool handler
 *
 * Comprehensive release readiness assessment combining quality metrics,
 * test results, risk factors, and stakeholder criteria.
 */
import { z } from 'zod';
export declare const AssessReadinessInputSchema: z.ZodObject<{
    releaseType: z.ZodDefault<z.ZodEnum<["major", "minor", "patch", "hotfix"]>>;
    projectPath: z.ZodOptional<z.ZodString>;
    criteria: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        category: z.ZodEnum<["quality", "testing", "security", "performance", "documentation", "compliance"]>;
        required: z.ZodDefault<z.ZodBoolean>;
        weight: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        required: boolean;
        weight: number;
        category: "security" | "performance" | "documentation" | "testing" | "quality" | "compliance";
    }, {
        name: string;
        category: "security" | "performance" | "documentation" | "testing" | "quality" | "compliance";
        required?: boolean | undefined;
        weight?: number | undefined;
    }>, "many">>;
    includeChecks: z.ZodDefault<z.ZodArray<z.ZodEnum<["quality-gates", "test-results", "security-scan", "performance-baseline", "documentation", "change-log", "dependencies", "rollback-plan"]>, "many">>;
    compareToRelease: z.ZodOptional<z.ZodString>;
    strictMode: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    releaseType: "minor" | "major" | "patch" | "hotfix";
    includeChecks: ("dependencies" | "documentation" | "quality-gates" | "test-results" | "security-scan" | "performance-baseline" | "change-log" | "rollback-plan")[];
    strictMode: boolean;
    projectPath?: string | undefined;
    criteria?: {
        name: string;
        required: boolean;
        weight: number;
        category: "security" | "performance" | "documentation" | "testing" | "quality" | "compliance";
    }[] | undefined;
    compareToRelease?: string | undefined;
}, {
    projectPath?: string | undefined;
    releaseType?: "minor" | "major" | "patch" | "hotfix" | undefined;
    criteria?: {
        name: string;
        category: "security" | "performance" | "documentation" | "testing" | "quality" | "compliance";
        required?: boolean | undefined;
        weight?: number | undefined;
    }[] | undefined;
    includeChecks?: ("dependencies" | "documentation" | "quality-gates" | "test-results" | "security-scan" | "performance-baseline" | "change-log" | "rollback-plan")[] | undefined;
    compareToRelease?: string | undefined;
    strictMode?: boolean | undefined;
}>;
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
        releaseType: z.ZodDefault<z.ZodEnum<["major", "minor", "patch", "hotfix"]>>;
        projectPath: z.ZodOptional<z.ZodString>;
        criteria: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            category: z.ZodEnum<["quality", "testing", "security", "performance", "documentation", "compliance"]>;
            required: z.ZodDefault<z.ZodBoolean>;
            weight: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            name: string;
            required: boolean;
            weight: number;
            category: "security" | "performance" | "documentation" | "testing" | "quality" | "compliance";
        }, {
            name: string;
            category: "security" | "performance" | "documentation" | "testing" | "quality" | "compliance";
            required?: boolean | undefined;
            weight?: number | undefined;
        }>, "many">>;
        includeChecks: z.ZodDefault<z.ZodArray<z.ZodEnum<["quality-gates", "test-results", "security-scan", "performance-baseline", "documentation", "change-log", "dependencies", "rollback-plan"]>, "many">>;
        compareToRelease: z.ZodOptional<z.ZodString>;
        strictMode: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        releaseType: "minor" | "major" | "patch" | "hotfix";
        includeChecks: ("dependencies" | "documentation" | "quality-gates" | "test-results" | "security-scan" | "performance-baseline" | "change-log" | "rollback-plan")[];
        strictMode: boolean;
        projectPath?: string | undefined;
        criteria?: {
            name: string;
            required: boolean;
            weight: number;
            category: "security" | "performance" | "documentation" | "testing" | "quality" | "compliance";
        }[] | undefined;
        compareToRelease?: string | undefined;
    }, {
        projectPath?: string | undefined;
        releaseType?: "minor" | "major" | "patch" | "hotfix" | undefined;
        criteria?: {
            name: string;
            category: "security" | "performance" | "documentation" | "testing" | "quality" | "compliance";
            required?: boolean | undefined;
            weight?: number | undefined;
        }[] | undefined;
        includeChecks?: ("dependencies" | "documentation" | "quality-gates" | "test-results" | "security-scan" | "performance-baseline" | "change-log" | "rollback-plan")[] | undefined;
        compareToRelease?: string | undefined;
        strictMode?: boolean | undefined;
    }>;
    handler: typeof handler;
};
export default toolDefinition;
//# sourceMappingURL=assess-readiness.d.ts.map