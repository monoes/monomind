/**
 * Quality Tools — built-in quality MCP tools
 *
 * Wraps all 16 tools for test generation, coverage, defect intelligence, security, chaos
 * (quality_*) and plain JSON Schema inputSchemas.
 */
import { handler as generateTestsHandler } from './quality/test-generation/generate-tests.js';
import { handler as tddCycleHandler } from './quality/test-generation/tdd-cycle.js';
import { handler as suggestTestsHandler } from './quality/test-generation/suggest-tests.js';
import { handler as analyzeCoverageHandler } from './quality/coverage-analysis/analyze-coverage.js';
import { handler as prioritizeGapsHandler } from './quality/coverage-analysis/prioritize-gaps.js';
import { handler as trackTrendsHandler } from './quality/coverage-analysis/track-trends.js';
import { handler as evaluateGateHandler } from './quality/quality-assessment/evaluate-quality-gate.js';
import { handler as assessReadinessHandler } from './quality/quality-assessment/assess-readiness.js';
import { handler as calculateRiskHandler } from './quality/quality-assessment/calculate-risk.js';
import { handler as predictDefectsHandler } from './quality/defect-intelligence/predict-defects.js';
import { handler as analyzeDefectHandler } from './quality/defect-intelligence/analyze-root-cause.js';
import { handler as findSimilarDefectsHandler } from './quality/defect-intelligence/find-similar-defects.js';
import { handler as securityScanHandler } from './quality/security-compliance/security-scan.js';
import { handler as auditComplianceHandler } from './quality/security-compliance/audit-compliance.js';
import { handler as detectSecretsHandler } from './quality/security-compliance/detect-secrets.js';
import { handler as chaosInjectHandler } from './quality/chaos-resilience/chaos-inject.js';
// monolean: minimal context shim — quality handlers call context.get() which
// is optional; returning undefined is safe for all current handlers.
const noopContext = { get: (_key) => undefined };
function wrap(handler) {
    return async (input) => {
        const result = await handler(input, noopContext);
        return result;
    };
}
export const qualityTools = [
    {
        name: 'quality_generate_tests',
        description: 'Generate AI-powered tests for code. Supports unit, integration, e2e, property, mutation, and fuzz test types across multiple frameworks.',
        category: 'quality',
        version: '0.1.0',
        inputSchema: {
            type: 'object',
            properties: {
                targetPath: { type: 'string', description: 'Path to file/directory to test' },
                testType: { type: 'string', enum: ['unit', 'integration', 'e2e', 'property', 'mutation', 'fuzz'] },
                framework: { type: 'string', enum: ['vitest', 'jest', 'mocha', 'pytest', 'junit'] },
                coverage: {
                    type: 'object',
                    properties: {
                        target: { type: 'number' },
                        focusGaps: { type: 'boolean' },
                    },
                },
                style: { type: 'string', enum: ['tdd-london', 'tdd-chicago', 'bdd', 'example-based'] },
                language: { type: 'string', enum: ['typescript', 'javascript', 'python', 'java', 'go', 'rust'] },
                includeEdgeCases: { type: 'boolean' },
                includeMocks: { type: 'boolean' },
                maxTests: { type: 'number' },
            },
            required: ['targetPath'],
        },
        handler: wrap(generateTestsHandler),
    },
    {
        name: 'quality_tdd_cycle',
        description: 'Run a TDD red-green-refactor cycle for a requirement. Creates failing test, minimal implementation, then refactors.',
        category: 'quality',
        version: '0.1.0',
        inputSchema: {
            type: 'object',
            properties: {
                requirement: { type: 'string', description: 'Requirement or feature to implement via TDD' },
                targetPath: { type: 'string', description: 'Path to file/directory for implementation' },
                framework: { type: 'string', enum: ['vitest', 'jest', 'mocha', 'pytest', 'junit'] },
                language: { type: 'string', enum: ['typescript', 'javascript', 'python', 'java', 'go', 'rust'] },
                style: { type: 'string', enum: ['tdd-london', 'tdd-chicago', 'bdd', 'example-based'] },
            },
            required: ['requirement', 'targetPath'],
        },
        handler: wrap(tddCycleHandler),
    },
    {
        name: 'quality_suggest_tests',
        description: 'Suggest tests to improve coverage for a given file or directory. Returns prioritized test suggestions.',
        category: 'quality',
        version: '0.1.0',
        inputSchema: {
            type: 'object',
            properties: {
                targetPath: { type: 'string', description: 'Path to file/directory to analyze' },
                maxSuggestions: { type: 'number' },
                focusAreas: { type: 'array', items: { type: 'string' } },
            },
            required: ['targetPath'],
        },
        handler: wrap(suggestTestsHandler),
    },
    {
        name: 'quality_analyze_coverage',
        description: 'Analyze test coverage for a file or directory. Returns coverage metrics and identifies gaps.',
        category: 'quality',
        version: '0.1.0',
        inputSchema: {
            type: 'object',
            properties: {
                targetPath: { type: 'string', description: 'Path to file/directory to analyze' },
                includeUncovered: { type: 'boolean' },
                threshold: { type: 'number' },
            },
            required: ['targetPath'],
        },
        handler: wrap(analyzeCoverageHandler),
    },
    {
        name: 'quality_prioritize_gaps',
        description: 'Prioritize coverage gaps by risk and impact. Returns ordered list of gaps to address.',
        category: 'quality',
        version: '0.1.0',
        inputSchema: {
            type: 'object',
            properties: {
                gaps: { type: 'array', items: { type: 'object' } },
                targetPath: { type: 'string' },
                maxGaps: { type: 'number' },
            },
            required: [],
        },
        handler: wrap(prioritizeGapsHandler),
    },
    {
        name: 'quality_track_trends',
        description: 'Track coverage trends over time. Returns trend analysis and regression detection.',
        category: 'quality',
        version: '0.1.0',
        inputSchema: {
            type: 'object',
            properties: {
                targetPath: { type: 'string' },
                period: { type: 'string', enum: ['day', 'week', 'month'] },
                metric: { type: 'string', enum: ['line', 'branch', 'function'] },
            },
            required: [],
        },
        handler: wrap(trackTrendsHandler),
    },
    {
        name: 'quality_evaluate_gate',
        description: 'Evaluate whether code passes quality gates (coverage thresholds, complexity, etc.).',
        category: 'quality',
        version: '0.1.0',
        inputSchema: {
            type: 'object',
            properties: {
                targetPath: { type: 'string' },
                gates: { type: 'array', items: { type: 'object' } },
                strict: { type: 'boolean' },
            },
            required: [],
        },
        handler: wrap(evaluateGateHandler),
    },
    {
        name: 'quality_assess_readiness',
        description: 'Assess code readiness for release. Checks quality gates, test coverage, and risk factors.',
        category: 'quality',
        version: '0.1.0',
        inputSchema: {
            type: 'object',
            properties: {
                targetPath: { type: 'string' },
                releaseType: { type: 'string', enum: ['major', 'minor', 'patch'] },
                checkList: { type: 'array', items: { type: 'string' } },
            },
            required: [],
        },
        handler: wrap(assessReadinessHandler),
    },
    {
        name: 'quality_calculate_risk',
        description: 'Calculate risk score for a file or change. Returns risk metrics and recommendations.',
        category: 'quality',
        version: '0.1.0',
        inputSchema: {
            type: 'object',
            properties: {
                targetPath: { type: 'string', description: 'Path to file/directory to assess' },
                includeHistory: { type: 'boolean' },
                riskFactors: { type: 'array', items: { type: 'string' } },
            },
            required: ['targetPath'],
        },
        handler: wrap(calculateRiskHandler),
    },
    {
        name: 'quality_predict_defects',
        description: 'Predict defect-prone areas in code using static analysis and historical patterns.',
        category: 'quality',
        version: '0.1.0',
        inputSchema: {
            type: 'object',
            properties: {
                targetPath: { type: 'string', description: 'Path to file/directory to analyze' },
                confidence: { type: 'number' },
                maxPredictions: { type: 'number' },
            },
            required: ['targetPath'],
        },
        handler: wrap(predictDefectsHandler),
    },
    {
        name: 'quality_analyze_defect',
        description: 'Analyze root cause of a defect. Returns causal chain, contributing factors, and fix recommendations.',
        category: 'quality',
        version: '0.1.0',
        inputSchema: {
            type: 'object',
            properties: {
                defect: { type: 'object', description: 'Defect description with title, description, stackTrace' },
                codeContext: { type: 'string' },
                includeFixSuggestions: { type: 'boolean' },
            },
            required: ['defect'],
        },
        handler: wrap(analyzeDefectHandler),
    },
    {
        name: 'quality_find_similar_defects',
        description: 'Find defects similar to a given query using semantic search.',
        category: 'quality',
        version: '0.1.0',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Defect description to search for' },
                maxResults: { type: 'number' },
                threshold: { type: 'number' },
            },
            required: ['query'],
        },
        handler: wrap(findSimilarDefectsHandler),
    },
    {
        name: 'quality_security_scan',
        description: 'Scan code for security vulnerabilities. Returns findings with severity, location, and remediation.',
        category: 'quality',
        version: '0.1.0',
        inputSchema: {
            type: 'object',
            properties: {
                targetPath: { type: 'string', description: 'Path to file/directory to scan' },
                scanType: { type: 'string', enum: ['sast', 'dependency', 'all'] },
                severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                excludePatterns: { type: 'array', items: { type: 'string' } },
            },
            required: ['targetPath'],
        },
        handler: wrap(securityScanHandler),
    },
    {
        name: 'quality_audit_compliance',
        description: 'Audit code for compliance with security standards (OWASP, CWE, GDPR, etc.).',
        category: 'quality',
        version: '0.1.0',
        inputSchema: {
            type: 'object',
            properties: {
                targetPath: { type: 'string', description: 'Path to file/directory to audit' },
                standards: { type: 'array', items: { type: 'string' } },
                strict: { type: 'boolean' },
            },
            required: ['targetPath'],
        },
        handler: wrap(auditComplianceHandler),
    },
    {
        name: 'quality_detect_secrets',
        description: 'Detect hardcoded secrets, API keys, and credentials in code.',
        category: 'quality',
        version: '0.1.0',
        inputSchema: {
            type: 'object',
            properties: {
                targetPath: { type: 'string', description: 'Path to file/directory to scan' },
                includePatterns: { type: 'array', items: { type: 'string' } },
                excludePatterns: { type: 'array', items: { type: 'string' } },
                severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            },
            required: ['targetPath'],
        },
        handler: wrap(detectSecretsHandler),
    },
    {
        name: 'quality_chaos_inject',
        description: 'Inject chaos (failures, latency, errors) into a target to test resilience.',
        category: 'quality',
        version: '0.1.0',
        inputSchema: {
            type: 'object',
            properties: {
                target: { type: 'string', description: 'Target service or component' },
                failureType: { type: 'string', enum: ['latency', 'error', 'crash', 'resource-exhaustion', 'network-partition'] },
                duration: { type: 'number' },
                intensity: { type: 'number' },
                dryRun: { type: 'boolean' },
            },
            required: ['target', 'failureType'],
        },
        handler: wrap(chaosInjectHandler),
    },
];
//# sourceMappingURL=quality-tools.js.map