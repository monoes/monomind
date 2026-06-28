/**
 * audit-compliance.ts - Compliance auditing MCP tool handler
 *
 * Generates comprehensive compliance audit reports for various security
 * frameworks including OWASP, PCI-DSS, HIPAA, GDPR, and SOC2.
 */
import { z } from 'zod';
export declare const AuditComplianceInputSchema: z.ZodObject<{
    targetPath: z.ZodString;
    frameworks: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        "owasp-top-10": "owasp-top-10";
        "sans-25": "sans-25";
        "pci-dss": "pci-dss";
        hipaa: "hipaa";
        gdpr: "gdpr";
        soc2: "soc2";
        nist: "nist";
    }>>>;
    auditType: z.ZodDefault<z.ZodEnum<{
        full: "full";
        quick: "quick";
        delta: "delta";
    }>>;
    includeEvidence: z.ZodDefault<z.ZodBoolean>;
    includeRemediation: z.ZodDefault<z.ZodBoolean>;
    lastAuditDate: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type AuditComplianceInput = z.infer<typeof AuditComplianceInputSchema>;
export interface AuditComplianceOutput {
    success: boolean;
    auditSummary: AuditSummary;
    frameworkResults: FrameworkAuditResult[];
    controls: ControlAssessment[];
    gaps: ComplianceGap[];
    remediationPlan: RemediationPlan | null;
    evidence: EvidenceCollection[];
    metadata: AuditMetadata;
}
export interface AuditSummary {
    overallScore: number;
    overallStatus: 'compliant' | 'partial' | 'non-compliant';
    frameworkCount: number;
    controlsAssessed: number;
    controlsPassed: number;
    controlsFailed: number;
    criticalGaps: number;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
}
export interface FrameworkAuditResult {
    framework: string;
    version: string;
    score: number;
    status: 'compliant' | 'partial' | 'non-compliant';
    controlsPassed: number;
    controlsFailed: number;
    controlsNA: number;
    categories: CategoryResult[];
    requiredActions: string[];
}
export interface CategoryResult {
    name: string;
    score: number;
    status: 'pass' | 'partial' | 'fail';
    controls: number;
    findings: number;
}
export interface ControlAssessment {
    id: string;
    framework: string;
    category: string;
    title: string;
    description: string;
    status: 'pass' | 'fail' | 'partial' | 'na';
    severity: 'critical' | 'high' | 'medium' | 'low';
    evidence: string[];
    findings: string[];
    remediation?: string;
}
export interface ComplianceGap {
    id: string;
    framework: string;
    controlId: string;
    title: string;
    description: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    businessImpact: string;
    remediationEffort: 'low' | 'medium' | 'high';
    deadline?: string;
}
export interface RemediationPlan {
    priority: RemediationItem[];
    timeline: TimelineItem[];
    estimatedEffort: string;
    resourcesRequired: string[];
}
export interface RemediationItem {
    priority: number;
    gap: string;
    action: string;
    owner: string;
    effort: 'low' | 'medium' | 'high';
    deadline: string;
}
export interface TimelineItem {
    phase: string;
    duration: string;
    activities: string[];
    milestones: string[];
}
export interface EvidenceCollection {
    controlId: string;
    type: 'automated' | 'manual' | 'documented';
    description: string;
    artifacts: string[];
    collectedAt: string;
    validity: 'current' | 'expired' | 'pending';
}
export interface AuditMetadata {
    auditedAt: string;
    durationMs: number;
    auditor: string;
    auditType: string;
    scopeFiles: number;
    controlsChecked: number;
}
export interface ToolContext {
    get<T>(key: string): T | undefined;
}
/**
 * MCP Tool Handler for audit-compliance
 */
export declare function handler(input: AuditComplianceInput, context: ToolContext): Promise<{
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
        frameworks: z.ZodDefault<z.ZodArray<z.ZodEnum<{
            "owasp-top-10": "owasp-top-10";
            "sans-25": "sans-25";
            "pci-dss": "pci-dss";
            hipaa: "hipaa";
            gdpr: "gdpr";
            soc2: "soc2";
            nist: "nist";
        }>>>;
        auditType: z.ZodDefault<z.ZodEnum<{
            full: "full";
            quick: "quick";
            delta: "delta";
        }>>;
        includeEvidence: z.ZodDefault<z.ZodBoolean>;
        includeRemediation: z.ZodDefault<z.ZodBoolean>;
        lastAuditDate: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    handler: typeof handler;
};
export default toolDefinition;
//# sourceMappingURL=audit-compliance.d.ts.map