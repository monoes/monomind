/**
 * detect-secrets.ts - Secret detection MCP tool handler
 *
 * Detects secrets, API keys, passwords, and other sensitive data in code
 * using pattern matching and entropy analysis.
 */
import { z } from 'zod';
export declare const DetectSecretsInputSchema: z.ZodObject<{
    targetPath: z.ZodString;
    secretTypes: z.ZodDefault<z.ZodArray<z.ZodEnum<["api-key", "password", "private-key", "token", "connection-string", "certificate", "aws-key", "aws-secret", "gcp-key", "azure-key", "generic"]>, "many">>;
    excludePatterns: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    includeEntropy: z.ZodDefault<z.ZodBoolean>;
    entropyThreshold: z.ZodDefault<z.ZodNumber>;
    verifySecrets: z.ZodDefault<z.ZodBoolean>;
    scanHistory: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    targetPath: string;
    excludePatterns: string[];
    secretTypes: ("password" | "token" | "api-key" | "private-key" | "connection-string" | "certificate" | "aws-key" | "aws-secret" | "gcp-key" | "azure-key" | "generic")[];
    includeEntropy: boolean;
    entropyThreshold: number;
    verifySecrets: boolean;
    scanHistory: boolean;
}, {
    targetPath: string;
    excludePatterns?: string[] | undefined;
    secretTypes?: ("password" | "token" | "api-key" | "private-key" | "connection-string" | "certificate" | "aws-key" | "aws-secret" | "gcp-key" | "azure-key" | "generic")[] | undefined;
    includeEntropy?: boolean | undefined;
    entropyThreshold?: number | undefined;
    verifySecrets?: boolean | undefined;
    scanHistory?: boolean | undefined;
}>;
export type DetectSecretsInput = z.infer<typeof DetectSecretsInputSchema>;
export interface DetectSecretsOutput {
    success: boolean;
    summary: DetectionSummary;
    findings: SecretFinding[];
    byType: TypeSummary[];
    recommendations: SecretRecommendation[];
    metadata: DetectionMetadata;
}
export interface DetectionSummary {
    totalFindings: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    verifiedCount: number;
    filesAffected: number;
    riskScore: number;
}
export interface SecretFinding {
    id: string;
    type: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    location: SecretLocation;
    pattern: string;
    entropy: number;
    verified: boolean | null;
    active: boolean | null;
    exposureRisk: string;
    remediation: string;
}
export interface SecretLocation {
    file: string;
    line: number;
    column: number;
    context: string;
    masked: string;
}
export interface TypeSummary {
    type: string;
    count: number;
    severity: 'critical' | 'high' | 'medium' | 'low';
    files: string[];
}
export interface SecretRecommendation {
    priority: number;
    action: string;
    affectedSecrets: string[];
    effort: 'low' | 'medium' | 'high';
    automatable: boolean;
}
export interface DetectionMetadata {
    scannedAt: string;
    durationMs: number;
    filesScanned: number;
    linesScanned: number;
    patternsUsed: number;
    entropyEnabled: boolean;
}
export interface ToolContext {
    get<T>(key: string): T | undefined;
}
/**
 * MCP Tool Handler for detect-secrets
 */
export declare function handler(input: DetectSecretsInput, context: ToolContext): Promise<{
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
        secretTypes: z.ZodDefault<z.ZodArray<z.ZodEnum<["api-key", "password", "private-key", "token", "connection-string", "certificate", "aws-key", "aws-secret", "gcp-key", "azure-key", "generic"]>, "many">>;
        excludePatterns: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        includeEntropy: z.ZodDefault<z.ZodBoolean>;
        entropyThreshold: z.ZodDefault<z.ZodNumber>;
        verifySecrets: z.ZodDefault<z.ZodBoolean>;
        scanHistory: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        targetPath: string;
        excludePatterns: string[];
        secretTypes: ("password" | "token" | "api-key" | "private-key" | "connection-string" | "certificate" | "aws-key" | "aws-secret" | "gcp-key" | "azure-key" | "generic")[];
        includeEntropy: boolean;
        entropyThreshold: number;
        verifySecrets: boolean;
        scanHistory: boolean;
    }, {
        targetPath: string;
        excludePatterns?: string[] | undefined;
        secretTypes?: ("password" | "token" | "api-key" | "private-key" | "connection-string" | "certificate" | "aws-key" | "aws-secret" | "gcp-key" | "azure-key" | "generic")[] | undefined;
        includeEntropy?: boolean | undefined;
        entropyThreshold?: number | undefined;
        verifySecrets?: boolean | undefined;
        scanHistory?: boolean | undefined;
    }>;
    handler: typeof handler;
};
export default toolDefinition;
//# sourceMappingURL=detect-secrets.d.ts.map