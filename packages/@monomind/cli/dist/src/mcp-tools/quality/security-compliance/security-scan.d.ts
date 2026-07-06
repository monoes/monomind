/**
 * security-scan.ts - SAST/DAST security scanning MCP tool handler
 *
 * Performs static (SAST) and dynamic (DAST) security analysis to identify
 * vulnerabilities, security weaknesses, and compliance issues.
 */
import { z } from 'zod';
export declare const SecurityScanInputSchema: z.ZodObject<{
    targetPath: z.ZodString;
    scanType: z.ZodDefault<z.ZodEnum<["sast", "dast", "both"]>>;
    compliance: z.ZodDefault<z.ZodArray<z.ZodEnum<["owasp-top-10", "sans-25", "pci-dss", "hipaa", "gdpr", "soc2"]>, "many">>;
    severity: z.ZodDefault<z.ZodEnum<["all", "critical", "high", "medium"]>>;
    includeRemediation: z.ZodDefault<z.ZodBoolean>;
    scanDepth: z.ZodDefault<z.ZodEnum<["quick", "standard", "deep"]>>;
    excludePatterns: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    targetUrl: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    targetPath: string;
    compliance: ("owasp-top-10" | "sans-25" | "pci-dss" | "hipaa" | "gdpr" | "soc2")[];
    includeRemediation: boolean;
    scanType: "both" | "sast" | "dast";
    severity: "critical" | "high" | "all" | "medium";
    scanDepth: "standard" | "deep" | "quick";
    excludePatterns: string[];
    targetUrl?: string | undefined;
}, {
    targetPath: string;
    compliance?: ("owasp-top-10" | "sans-25" | "pci-dss" | "hipaa" | "gdpr" | "soc2")[] | undefined;
    includeRemediation?: boolean | undefined;
    scanType?: "both" | "sast" | "dast" | undefined;
    severity?: "critical" | "high" | "all" | "medium" | undefined;
    scanDepth?: "standard" | "deep" | "quick" | undefined;
    excludePatterns?: string[] | undefined;
    targetUrl?: string | undefined;
}>;
export type SecurityScanInput = z.infer<typeof SecurityScanInputSchema>;
export interface SecurityScanOutput {
    success: boolean;
    summary: ScanSummary;
    findings: SecurityFinding[];
    complianceResults: ComplianceResult[];
    metrics: SecurityMetrics;
    recommendations: SecurityRecommendation[];
    metadata: ScanMetadata;
}
export interface ScanSummary {
    totalFindings: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    infoCount: number;
    passedChecks: number;
    failedChecks: number;
    riskScore: number;
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
}
export interface SecurityFinding {
    id: string;
    title: string;
    description: string;
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    category: string;
    cweId?: string;
    cvss?: number;
    location: FindingLocation;
    evidence: string;
    remediation?: RemediationGuidance;
    compliance: string[];
    falsePositiveLikelihood: 'low' | 'medium' | 'high';
}
export interface FindingLocation {
    file: string;
    startLine: number;
    endLine: number;
    column?: number;
    codeSnippet?: string;
}
export interface RemediationGuidance {
    description: string;
    steps: string[];
    codeExample?: string;
    effort: 'low' | 'medium' | 'high';
    priority: number;
}
export interface ComplianceResult {
    framework: string;
    status: 'compliant' | 'partial' | 'non-compliant';
    score: number;
    passedRules: number;
    failedRules: number;
    findings: string[];
}
export interface SecurityMetrics {
    vulnerabilityDensity: number;
    avgSeverity: number;
    owaspCoverage: number;
    fixRate: number;
    mttr: string;
}
export interface SecurityRecommendation {
    priority: number;
    category: string;
    title: string;
    description: string;
    impact: 'low' | 'medium' | 'high';
    effort: 'low' | 'medium' | 'high';
    affectedFindings: string[];
}
export interface ScanMetadata {
    scannedAt: string;
    durationMs: number;
    scanType: string;
    filesScanned: number;
    linesScanned: number;
    rulesExecuted: number;
    engineVersion: string;
}
export interface ToolContext {
    get<T>(key: string): T | undefined;
}
/**
 * MCP Tool Handler for security-scan
 */
export declare function handler(input: SecurityScanInput, context: ToolContext): Promise<{
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
        scanType: z.ZodDefault<z.ZodEnum<["sast", "dast", "both"]>>;
        compliance: z.ZodDefault<z.ZodArray<z.ZodEnum<["owasp-top-10", "sans-25", "pci-dss", "hipaa", "gdpr", "soc2"]>, "many">>;
        severity: z.ZodDefault<z.ZodEnum<["all", "critical", "high", "medium"]>>;
        includeRemediation: z.ZodDefault<z.ZodBoolean>;
        scanDepth: z.ZodDefault<z.ZodEnum<["quick", "standard", "deep"]>>;
        excludePatterns: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        targetUrl: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        targetPath: string;
        compliance: ("owasp-top-10" | "sans-25" | "pci-dss" | "hipaa" | "gdpr" | "soc2")[];
        includeRemediation: boolean;
        scanType: "both" | "sast" | "dast";
        severity: "critical" | "high" | "all" | "medium";
        scanDepth: "standard" | "deep" | "quick";
        excludePatterns: string[];
        targetUrl?: string | undefined;
    }, {
        targetPath: string;
        compliance?: ("owasp-top-10" | "sans-25" | "pci-dss" | "hipaa" | "gdpr" | "soc2")[] | undefined;
        includeRemediation?: boolean | undefined;
        scanType?: "both" | "sast" | "dast" | undefined;
        severity?: "critical" | "high" | "all" | "medium" | undefined;
        scanDepth?: "standard" | "deep" | "quick" | undefined;
        excludePatterns?: string[] | undefined;
        targetUrl?: string | undefined;
    }>;
    handler: typeof handler;
};
export default toolDefinition;
//# sourceMappingURL=security-scan.d.ts.map