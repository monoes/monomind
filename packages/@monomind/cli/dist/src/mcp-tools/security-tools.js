/**
 * Security MCP Tools - MonoFence Integration
 *
 * Provides MCP tools for AI manipulation defense:
 * - monofence_scan: Scan input for threats
 * - monofence_analyze: Deep analysis of threats
 * - monofence_stats: Get detection statistics
 * - monofence_learn: Learn from detection feedback
 *
 * github.com/monoes/monomind
 */
import { autoInstallPackage } from './auto-install.js';
import { createRequire } from 'module';
// Create require for resolving module paths
const require = createRequire(import.meta.url);
// Lazy-loaded MonoFence instance
let monofenceInstance = null;
// Track if we've attempted install this session
let installAttempted = false;
/**
 * Get or create MonoFence instance (throws if unavailable)
 */
async function getMonoFence() {
    if (monofenceInstance) {
        return monofenceInstance;
    }
    const packageName = 'monofence-ai';
    // First attempt - try to load via dynamic import (ESM)
    try {
        const monofence = await import(packageName);
        const instance = monofence.createMonoDefence({ enableLearning: true });
        if (!instance) {
            throw new Error('createMonoDefence returned null');
        }
        monofenceInstance = instance;
        return instance;
    }
    catch (e) {
        // Package not found or failed to load
        const error = e;
        if (!error.message?.includes('Cannot find package') && !error.message?.includes('ERR_MODULE_NOT_FOUND')) {
            // Different error - might be a real issue
            throw new Error(`MonoFence failed to load: ${error.message}`);
        }
    }
    // Don't attempt install more than once per session
    if (installAttempted) {
        throw new Error('MonoFence package not available. Install with: npm install monofence-ai');
    }
    installAttempted = true;
    // Second attempt - auto-install and retry
    console.error(`[monomind] ${packageName} not found, attempting auto-install...`);
    const installed = await autoInstallPackage(packageName);
    if (!installed) {
        throw new Error('MonoFence package not available. Install with: npm install monofence-ai');
    }
    // The in-process ESM module cache cannot be invalidated after install; require a server restart.
    throw new Error(`MonoFence installed successfully. Restart the MCP server to load it: npx monomind mcp start`);
}
/**
 * Scan input for AI manipulation threats
 */
const monofenceScanTool = {
    name: 'monofence_scan',
    description: 'Scan input text for AI manipulation threats (prompt injection, jailbreaks, PII). Returns threat assessment with <10ms latency.',
    inputSchema: {
        type: 'object',
        properties: {
            input: {
                type: 'string',
                description: 'Text to scan for threats',
            },
            quick: {
                type: 'boolean',
                description: 'Quick scan mode (faster, less detailed)',
                default: false,
            },
        },
        required: ['input'],
    },
    handler: async (args) => {
        const input = args.input;
        const quick = args.quick;
        try {
            const defender = await getMonoFence();
            if (quick) {
                const result = defender.quickScan(input);
                return {
                    content: [{
                            type: 'text',
                            text: JSON.stringify({
                                safe: !result.threat,
                                threatDetected: result.threat,
                                confidence: result.confidence,
                                mode: 'quick',
                            }, null, 2),
                        }],
                };
            }
            const result = await defender.detect(input);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            safe: result.safe,
                            threats: result.threats.map(t => ({
                                type: t.type,
                                severity: t.severity,
                                confidence: t.confidence,
                                description: t.description,
                            })),
                            piiFound: result.piiFound,
                            detectionTimeMs: result.detectionTimeMs,
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({ error: String(error) }),
                    }],
                isError: true,
            };
        }
    },
};
/**
 * Deep analysis of specific threat
 */
const monofenceAnalyzeTool = {
    name: 'monofence_analyze',
    description: 'Deep analysis of input for specific threat types with similar pattern search and mitigation recommendations.',
    inputSchema: {
        type: 'object',
        properties: {
            input: {
                type: 'string',
                description: 'Text to analyze',
            },
            searchSimilar: {
                type: 'boolean',
                description: 'Search for similar known threats',
                default: true,
            },
            k: {
                type: 'number',
                description: 'Number of similar patterns to retrieve',
                default: 5,
            },
        },
        required: ['input'],
    },
    handler: async (args) => {
        const input = args.input;
        const searchSimilar = args.searchSimilar !== false;
        const k = args.k || 5;
        try {
            const defender = await getMonoFence();
            const result = await defender.detect(input);
            const analysis = {
                detection: {
                    safe: result.safe,
                    threats: result.threats,
                    piiFound: result.piiFound,
                },
                mitigations: [],
                similarPatterns: [],
            };
            // Get mitigations for detected threats
            for (const threat of result.threats) {
                const mitigation = await defender.getBestMitigation(threat.type);
                if (mitigation) {
                    analysis.mitigations.push({
                        threatType: threat.type,
                        strategy: mitigation.strategy,
                        effectiveness: mitigation.effectiveness,
                    });
                }
            }
            // Search similar patterns
            if (searchSimilar) {
                const similar = await defender.searchSimilarThreats(input, { k });
                analysis.similarPatterns = similar.map(p => ({
                    pattern: p.pattern,
                    type: p.type,
                    effectiveness: p.effectiveness,
                }));
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify(analysis, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({ error: String(error) }),
                    }],
                isError: true,
            };
        }
    },
};
/**
 * Get detection statistics
 */
const monofenceStatsTool = {
    name: 'monofence_stats',
    description: 'Get MonoFence detection and learning statistics.',
    inputSchema: {
        type: 'object',
        properties: {},
    },
    handler: async () => {
        try {
            const defender = await getMonoFence();
            const stats = await defender.getStats();
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            detectionCount: stats.detectionCount,
                            avgDetectionTimeMs: stats.avgDetectionTimeMs,
                            learnedPatterns: stats.learnedPatterns,
                            mitigationStrategies: stats.mitigationStrategies,
                            avgMitigationEffectiveness: stats.avgMitigationEffectiveness,
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({ error: String(error) }),
                    }],
                isError: true,
            };
        }
    },
};
/**
 * Record detection feedback for learning
 */
const monofenceLearnTool = {
    name: 'monofence_learn',
    description: 'Record detection feedback for pattern learning. Improves future detection accuracy.',
    inputSchema: {
        type: 'object',
        properties: {
            input: {
                type: 'string',
                description: 'Original input that was scanned',
            },
            wasAccurate: {
                type: 'boolean',
                description: 'Whether the detection was accurate',
            },
            verdict: {
                type: 'string',
                description: 'User verdict or correction',
            },
            threatType: {
                type: 'string',
                description: 'Threat type for mitigation recording',
            },
            mitigationStrategy: {
                type: 'string',
                description: 'Mitigation strategy used',
                enum: ['block', 'sanitize', 'warn', 'log', 'escalate', 'transform', 'redirect'],
            },
            mitigationSuccess: {
                type: 'boolean',
                description: 'Whether the mitigation was successful',
            },
        },
        required: ['input', 'wasAccurate'],
    },
    handler: async (args) => {
        const input = args.input;
        const wasAccurate = args.wasAccurate;
        const verdict = args.verdict;
        const threatType = args.threatType;
        const mitigationStrategy = args.mitigationStrategy;
        const mitigationSuccess = args.mitigationSuccess;
        try {
            const defender = await getMonoFence();
            // Re-detect to get result for learning
            const result = await defender.detect(input);
            // Learn from detection
            await defender.learnFromDetection(input, result, {
                wasAccurate,
                userVerdict: verdict,
            });
            // Record mitigation if provided
            if (threatType && mitigationStrategy && mitigationSuccess !== undefined) {
                await defender.recordMitigation(threatType, mitigationStrategy, mitigationSuccess);
            }
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            message: 'Feedback recorded for pattern learning',
                            learnedFrom: {
                                input: input.slice(0, 50) + (input.length > 50 ? '...' : ''),
                                wasAccurate,
                                threatCount: result.threats.length,
                            },
                        }, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({ error: String(error) }),
                    }],
                isError: true,
            };
        }
    },
};
/**
 * Check if input is safe (simple boolean check)
 */
const monofenceIsSafeTool = {
    name: 'monofence_is_safe',
    description: 'Quick boolean check if input is safe. Fastest option for simple validation.',
    inputSchema: {
        type: 'object',
        properties: {
            input: {
                type: 'string',
                description: 'Text to check',
            },
        },
        required: ['input'],
    },
    handler: async (args) => {
        const input = args.input;
        try {
            await getMonoFence(); // triggers auto-install if package is missing
            const { isSafe } = await import('monofence-ai');
            const safe = isSafe(input);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({ safe }, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({ error: String(error) }),
                    }],
                isError: true,
            };
        }
    },
};
/**
 * Check for PII in input
 */
const monofenceHasPIITool = {
    name: 'monofence_has_pii',
    description: 'Check if input contains PII (emails, SSNs, API keys, passwords, etc.).',
    inputSchema: {
        type: 'object',
        properties: {
            input: {
                type: 'string',
                description: 'Text to check for PII',
            },
        },
        required: ['input'],
    },
    handler: async (args) => {
        const input = args.input;
        try {
            const defender = await getMonoFence();
            const hasPII = defender.hasPII(input);
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({ hasPII }, null, 2),
                    }],
            };
        }
        catch (error) {
            return {
                content: [{
                        type: 'text',
                        text: JSON.stringify({ error: String(error) }),
                    }],
                isError: true,
            };
        }
    },
};
/**
 * Export all security tools
 */
export const securityTools = [
    monofenceScanTool,
    monofenceAnalyzeTool,
    monofenceStatsTool,
    monofenceLearnTool,
    monofenceIsSafeTool,
    monofenceHasPIITool,
];
export default securityTools;
//# sourceMappingURL=security-tools.js.map