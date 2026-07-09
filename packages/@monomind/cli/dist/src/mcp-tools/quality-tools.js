/**
 * Quality Tools — built-in quality MCP tools
 *
 * Wraps 2 tools: coverage gap prioritization and secret detection.
 *
 * monolean: 14 tools were removed — their handlers fabricated results
 * (hardcoded fake file coverage, Math.random()-driven projections/predictions,
 * invented defect data, fake security scan findings, hardcoded compliance
 * results) rather than performing real analysis. Only prioritize-gaps
 * (salvageable) and detect-secrets (real) remain.
 */
import { handler as prioritizeGapsHandler } from './quality/coverage-analysis/prioritize-gaps.js';
import { handler as detectSecretsHandler } from './quality/security-compliance/detect-secrets.js';
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
];
//# sourceMappingURL=quality-tools.js.map