/**
 * Security Domain Service - Domain Layer
 *
 * Contains security logic for validation, policy enforcement, and threat detection.
 *
 * @module v1/security/domain/services
 */
import { SecurityContext } from '../entities/security-context.js';
/**
 * Validation result
 */
export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    sanitized?: string;
}
/**
 * Threat detection result
 */
export interface ThreatDetectionResult {
    safe: boolean;
    threats: Array<{
        type: string;
        severity: 'low' | 'medium' | 'high' | 'critical';
        description: string;
        location?: string;
    }>;
}
/**
 * Security Domain Service
 */
export declare class SecurityDomainService {
    private static readonly PATH_TRAVERSAL_PATTERNS;
    private static readonly DANGEROUS_COMMANDS;
    private static readonly SQL_INJECTION_PATTERNS;
    private static readonly XSS_PATTERNS;
    /**
     * Validate a file path
     */
    validatePath(path: string, context: SecurityContext): ValidationResult;
    /**
     * Validate a command
     */
    validateCommand(command: string, context: SecurityContext): ValidationResult;
    /**
     * Validate user input
     */
    validateInput(input: string): ValidationResult;
    /**
     * Detect threats in content
     */
    detectThreats(content: string): ThreatDetectionResult;
    /**
     * Sanitize path
     */
    private sanitizePath;
    /**
     * Sanitize command
     */
    private sanitizeCommand;
    /**
     * Sanitize user input
     */
    private sanitizeInput;
    /**
     * Create security context for agent
     */
    createAgentContext(agentId: string, role: string, customPaths?: string[]): SecurityContext;
}
//# sourceMappingURL=security-domain-service.d.ts.map