/**
 * Security Application Service - Application Layer
 *
 * Orchestrates security operations and provides simplified interface.
 *
 * @module v1/security/application/services
 */
import { SecurityDomainService } from '../../domain/services/security-domain-service.js';
/**
 * Security Application Service
 */
export class SecurityApplicationService {
    domainService;
    contexts = new Map();
    constructor() {
        this.domainService = new SecurityDomainService();
    }
    // ============================================================================
    // Context Management
    // ============================================================================
    /**
     * Create and register security context for agent
     */
    createAgentContext(agentId, role) {
        const context = this.domainService.createAgentContext(agentId, role);
        this.contexts.set(agentId, context);
        return context;
    }
    /**
     * Get security context
     */
    getContext(principalId) {
        return this.contexts.get(principalId);
    }
    /**
     * Remove security context
     */
    removeContext(principalId) {
        return this.contexts.delete(principalId);
    }
    // ============================================================================
    // Validation
    // ============================================================================
    /**
     * Validate path access
     */
    validatePath(path, principalId) {
        const context = this.contexts.get(principalId);
        if (!context) {
            return {
                valid: false,
                errors: ['Security context not found'],
                warnings: [],
            };
        }
        return this.domainService.validatePath(path, context);
    }
    /**
     * Validate command execution
     */
    validateCommand(command, principalId) {
        const context = this.contexts.get(principalId);
        if (!context) {
            return {
                valid: false,
                errors: ['Security context not found'],
                warnings: [],
            };
        }
        return this.domainService.validateCommand(command, context);
    }
    /**
     * Validate user input
     */
    validateInput(input) {
        return this.domainService.validateInput(input);
    }
    /**
     * Detect threats in content
     */
    detectThreats(content) {
        return this.domainService.detectThreats(content);
    }
    // ============================================================================
    // Audit
    // ============================================================================
    /**
     * Run security audit on codebase
     */
    async auditCodebase(files) {
        const checks = [];
        const recommendations = [];
        let criticalCount = 0;
        let highCount = 0;
        for (const file of files) {
            const threats = this.domainService.detectThreats(file.content);
            for (const threat of threats.threats) {
                checks.push({
                    name: `${threat.type} in ${file.path}`,
                    passed: false,
                    severity: threat.severity,
                    message: threat.description,
                });
                if (threat.severity === 'critical')
                    criticalCount++;
                if (threat.severity === 'high')
                    highCount++;
            }
            if (threats.safe) {
                checks.push({
                    name: `Security check: ${file.path}`,
                    passed: true,
                    severity: 'low',
                    message: 'No threats detected',
                });
            }
        }
        // Generate recommendations
        if (criticalCount > 0) {
            recommendations.push('Address critical security issues immediately');
        }
        if (highCount > 0) {
            recommendations.push('Review and fix high-severity findings');
        }
        recommendations.push('Run regular security scans');
        recommendations.push('Keep dependencies updated');
        // Calculate score
        const totalChecks = checks.length;
        const passedChecks = checks.filter((c) => c.passed).length;
        const score = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 100;
        return {
            passed: criticalCount === 0 && highCount === 0,
            score,
            checks,
            recommendations,
        };
    }
    /**
     * Check if operation is allowed
     */
    isOperationAllowed(principalId, operation, target) {
        const context = this.contexts.get(principalId);
        if (!context || context.isExpired())
            return false;
        if (operation === 'path') {
            return context.canAccessPath(target);
        }
        else {
            return context.canExecuteCommand(target);
        }
    }
}
//# sourceMappingURL=security-application-service.js.map