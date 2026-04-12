/**
 * Security Application Service - Application Layer
 *
 * Orchestrates security operations and provides simplified interface.
 *
 * @module v1/security/application/services
 */
import { SecurityContext } from '../../domain/entities/security-context.js';
import { ValidationResult, ThreatDetectionResult } from '../../domain/services/security-domain-service.js';
/**
 * Security audit result
 */
export interface SecurityAuditResult {
    passed: boolean;
    score: number;
    checks: Array<{
        name: string;
        passed: boolean;
        severity: 'low' | 'medium' | 'high' | 'critical';
        message: string;
    }>;
    recommendations: string[];
}
/**
 * Security Application Service
 */
export declare class SecurityApplicationService {
    private readonly domainService;
    private readonly contexts;
    constructor();
    /**
     * Create and register security context for agent
     */
    createAgentContext(agentId: string, role: string): SecurityContext;
    /**
     * Get security context
     */
    getContext(principalId: string): SecurityContext | undefined;
    /**
     * Remove security context
     */
    removeContext(principalId: string): boolean;
    /**
     * Validate path access
     */
    validatePath(path: string, principalId: string): ValidationResult;
    /**
     * Validate command execution
     */
    validateCommand(command: string, principalId: string): ValidationResult;
    /**
     * Validate user input
     */
    validateInput(input: string): ValidationResult;
    /**
     * Detect threats in content
     */
    detectThreats(content: string): ThreatDetectionResult;
    /**
     * Run security audit on codebase
     */
    auditCodebase(files: Array<{
        path: string;
        content: string;
    }>): Promise<SecurityAuditResult>;
    /**
     * Check if operation is allowed
     */
    isOperationAllowed(principalId: string, operation: 'path' | 'command', target: string): boolean;
}
//# sourceMappingURL=security-application-service.d.ts.map