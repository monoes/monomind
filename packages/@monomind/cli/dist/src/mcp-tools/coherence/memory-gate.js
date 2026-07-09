/**
 * Memory Gate Tool - pr_memory_gate
 *
 * Pre-storage coherence gate for memory entries.
 * Validates that new entries are coherent with existing context before storage.
 * Uses cosine similarity on vectors to compute coherence energy.
 * When no pre-computed embeddings are supplied, falls back to a deterministic
 * hash-based vector (structural proxy, not semantic similarity).
 */
import { MemoryGateInputSchema, successResult, errorResult, cosineSimilarity, } from './types.js';
// Default logger
const defaultLogger = {
    debug: (msg, meta) => console.debug(`[pr_memory_gate] ${msg}`, meta),
    info: (msg, meta) => console.info(`[pr_memory_gate] ${msg}`, meta),
    warn: (msg, meta) => console.warn(`[pr_memory_gate] ${msg}`, meta),
    error: (msg, meta) => console.error(`[pr_memory_gate] ${msg}`, meta),
};
// ============================================================================
// Memory Gate Functions
// ============================================================================
/**
 * Deterministic hash-based vector from value content.
 * This is NOT a semantic embedding -- it produces a normalized vector
 * derived from character codes via an LCG, so only identical (or
 * near-identical) strings will be "similar". It serves as a
 * structural-consistency proxy when no real embedding model is available.
 *
 * For real semantic similarity, use the generateEmbedding() from
 * neural-tools.ts which tries ONNX first and falls back to a
 * deterministic hash.
 */
function hashVector(value) {
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    // Seed from string content
    let seed = 0;
    for (let i = 0; i < str.length; i++) {
        seed = ((seed * 1103515245 + 12345) & 0x7fffffff) ^ (str.charCodeAt(i) * (i + 1));
    }
    // Generate deterministic vector via LCG
    const dims = 64;
    const vec = new Array(dims);
    for (let i = 0; i < dims; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        vec[i] = (seed / 0x7fffffff) * 2 - 1;
    }
    // Normalize
    let norm = 0;
    for (let i = 0; i < dims; i++) {
        norm += vec[i] * vec[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
        for (let i = 0; i < dims; i++) {
            vec[i] /= norm;
        }
    }
    return vec;
}
/**
 * Compute coherence energy using Sheaf Laplacian
 */
function computeCoherenceEnergy(newEmbedding, existingEmbeddings) {
    if (existingEmbeddings.length === 0)
        return 0;
    let totalDisagreement = 0;
    for (const existing of existingEmbeddings) {
        const similarity = cosineSimilarity(newEmbedding, existing);
        const disagreement = 1 - Math.max(0, similarity);
        totalDisagreement += disagreement;
    }
    return totalDisagreement / existingEmbeddings.length;
}
/**
 * Detect specific violations
 */
function detectViolations(newEmbedding, existingEmbeddings, warnThreshold) {
    const violations = [];
    for (let i = 0; i < existingEmbeddings.length; i++) {
        const similarity = cosineSimilarity(newEmbedding, existingEmbeddings[i]);
        if (similarity < -0.3) {
            violations.push(`Strong contradiction with context entry ${i} (similarity: ${similarity.toFixed(3)})`);
        }
        else if (similarity < warnThreshold) {
            violations.push(`Weak coherence with context entry ${i} (similarity: ${similarity.toFixed(3)})`);
        }
    }
    return violations;
}
/**
 * Determine action based on coherence energy
 */
function determineAction(energy, thresholds) {
    if (energy >= thresholds.reject) {
        return 'reject';
    }
    if (energy >= thresholds.warn) {
        return 'warn';
    }
    return 'allow';
}
/**
 * Get interpretation of memory gate result
 */
function getInterpretation(action, energy, violations) {
    switch (action) {
        case 'allow':
            return 'Entry is coherent with existing context - storage allowed';
        case 'warn':
            return `Entry has minor inconsistencies (energy: ${energy.toFixed(3)}) - storage allowed with warning`;
        case 'reject':
            return `Entry contradicts existing context (energy: ${energy.toFixed(3)}) - storage blocked. ${violations.length} violation(s) detected.`;
    }
}
/**
 * Handler for pr_memory_gate tool
 */
async function handler(input, context) {
    const logger = context?.logger ?? defaultLogger;
    const startTime = performance.now();
    try {
        // Validate input
        const validationResult = MemoryGateInputSchema.safeParse(input);
        if (!validationResult.success) {
            logger.error('Input validation failed', { error: validationResult.error.message });
            return errorResult(`Invalid input: ${validationResult.error.message}`);
        }
        const { key, value, existingVectors, thresholds } = validationResult.data;
        // Get thresholds from config or input
        const warnThreshold = thresholds?.warn ?? context?.config?.coherence?.warnThreshold ?? 0.3;
        const rejectThreshold = thresholds?.reject ?? context?.config?.coherence?.rejectThreshold ?? 0.7;
        logger.debug('Processing memory gate check', {
            key,
            hasExistingContext: !!existingVectors?.length,
            contextSize: existingVectors?.length ?? 0,
            warnThreshold,
            rejectThreshold,
        });
        // Generate hash-based vector for the new value (not a semantic embedding --
        // only detects near-identical content, not semantic similarity)
        const newEmbedding = hashVector(value);
        // If no existing context, always allow
        if (!existingVectors || existingVectors.length === 0) {
            const output = {
                allowed: true,
                coherenceEnergy: 0,
                details: {
                    action: 'allow',
                    violations: [],
                    confidence: 1,
                    interpretation: 'No existing context - entry allowed',
                    contextSize: 0,
                },
            };
            const duration = performance.now() - startTime;
            logger.info('Memory gate check completed (no context)', {
                key,
                allowed: true,
                durationMs: duration.toFixed(2),
            });
            return successResult(output);
        }
        // Validate embedding dimensions match
        const firstDim = existingVectors[0].length;
        for (let i = 1; i < existingVectors.length; i++) {
            if (existingVectors[i].length !== firstDim) {
                return errorResult(`Context embedding dimension mismatch: entry ${i} has ${existingVectors[i].length} dimensions, expected ${firstDim}`);
            }
        }
        let coherenceEnergy;
        let violations;
        // Try to use WASM bridge if available
        if (context?.bridge?.initialized) {
            try {
                logger.debug('Using WASM bridge for coherence check');
                const allEmbeddings = [
                    new Float32Array(newEmbedding),
                    ...existingVectors.map(v => new Float32Array(v)),
                ];
                const result = await context.bridge.checkCoherence(allEmbeddings);
                coherenceEnergy = result.energy;
                violations = result.violations;
            }
            catch (wasmError) {
                logger.warn('WASM bridge failed, falling back to JS implementation', {
                    error: wasmError instanceof Error ? wasmError.message : String(wasmError),
                });
                coherenceEnergy = computeCoherenceEnergy(newEmbedding, existingVectors);
                violations = detectViolations(newEmbedding, existingVectors, warnThreshold);
            }
        }
        else {
            // Pure JavaScript fallback
            logger.debug('Using JavaScript fallback for memory gate');
            coherenceEnergy = computeCoherenceEnergy(newEmbedding, existingVectors);
            violations = detectViolations(newEmbedding, existingVectors, warnThreshold);
        }
        const action = determineAction(coherenceEnergy, { warn: warnThreshold, reject: rejectThreshold });
        const allowed = action !== 'reject';
        const confidence = 1 - coherenceEnergy;
        const output = {
            allowed,
            coherenceEnergy,
            reason: !allowed ? `Coherence energy ${coherenceEnergy.toFixed(3)} exceeds reject threshold ${rejectThreshold}` : undefined,
            details: {
                action,
                violations,
                confidence,
                interpretation: getInterpretation(action, coherenceEnergy, violations),
                contextSize: existingVectors.length,
            },
        };
        const duration = performance.now() - startTime;
        logger.info('Memory gate check completed', {
            key,
            allowed,
            action,
            coherenceEnergy: coherenceEnergy.toFixed(4),
            violations: violations.length,
            durationMs: duration.toFixed(2),
        });
        return successResult(output);
    }
    catch (error) {
        const duration = performance.now() - startTime;
        logger.error('Memory gate check failed', {
            error: error instanceof Error ? error.message : String(error),
            durationMs: duration.toFixed(2),
        });
        return errorResult(error instanceof Error ? error : new Error(String(error)));
    }
}
/**
 * pr_memory_gate MCP Tool Definition
 */
export const memoryGateTool = {
    name: 'pr_memory_gate',
    description: 'Pre-storage coherence gate for memory entries. Validates new entries against existing context vectors using cosine-similarity energy. When no pre-computed embeddings are supplied, uses a deterministic hash-based vector (structural proxy, not semantic). Blocks contradictory entries to maintain memory coherence.',
    category: 'memory',
    version: '0.1.3',
    tags: ['memory', 'coherence', 'gate', 'validation', 'ai-interpretability'],
    cacheable: false, // Context changes frequently
    inputSchema: {
        type: 'object',
        properties: {
            key: {
                type: 'string',
                description: 'Memory entry key',
            },
            value: {
                description: 'Value to be stored (any JSON-serializable type)',
            },
            existingVectors: {
                type: 'array',
                items: { type: 'array', items: { type: 'number' } },
                description: 'Existing context embeddings to check against',
            },
            thresholds: {
                type: 'object',
                properties: {
                    warn: {
                        type: 'number',
                        default: 0.3,
                        description: 'Energy threshold for warnings (0-1)',
                    },
                    reject: {
                        type: 'number',
                        default: 0.7,
                        description: 'Energy threshold for rejection (0-1)',
                    },
                },
                description: 'Custom coherence thresholds',
            },
        },
        required: ['key', 'value'],
    },
    handler,
};
export default memoryGateTool;
//# sourceMappingURL=memory-gate.js.map