/**
 * Prime Radiant MCP Tool Types
 *
 * Type definitions for Prime Radiant mathematical AI tools.
 */
import { z } from 'zod';
// ============================================================================
// Coherence Types
// ============================================================================
export const CoherenceInputSchema = z.object({
    vectors: z.array(z.array(z.number())).min(1).describe('Array of embedding vectors to check for coherence'),
    threshold: z.number().min(0).max(1).default(0.3).describe('Energy threshold for coherence (0-1)'),
});
// ============================================================================
// Spectral Types
// ============================================================================
export const SpectralInputSchema = z.object({
    matrix: z.array(z.array(z.number())).min(1).describe('Adjacency matrix representing connections'),
    analyzeType: z.enum(['stability', 'clustering', 'connectivity']).default('stability'),
});
// ============================================================================
// Causal Types
// ============================================================================
export const CausalGraphSchema = z.object({
    nodes: z.array(z.string()).min(1).describe('List of variable names'),
    edges: z.array(z.tuple([z.string(), z.string()])).describe('Directed edges as [from, to] pairs'),
});
export const CausalInputSchema = z.object({
    graph: CausalGraphSchema.describe('Causal graph with nodes and edges'),
    intervention: z.string().describe('Treatment/intervention variable'),
    outcome: z.string().describe('Outcome variable to measure effect on'),
});
// ============================================================================
// Consensus Types
// ============================================================================
export const AgentStateSchema = z.object({
    agentId: z.string().describe('Unique agent identifier'),
    embedding: z.array(z.number()).describe('Agent state embedding vector'),
    vote: z.string().optional().describe('Agent vote or decision'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Additional agent metadata'),
});
export const ConsensusInputSchema = z.object({
    agentStates: z.array(AgentStateSchema).min(1).describe('Array of agent states to verify consensus'),
    threshold: z.number().min(0).max(1).default(0.8).describe('Required agreement threshold (0-1)'),
});
// ============================================================================
// Topology Types
// ============================================================================
export const SimplexSchema = z.object({
    vertices: z.array(z.number()).describe('Vertex indices forming the simplex'),
    dimension: z.number().int().min(0).describe('Dimension of the simplex'),
});
export const SimplicialComplexSchema = z.object({
    vertices: z.array(z.array(z.number())).describe('Vertex coordinates'),
    simplices: z.array(SimplexSchema).optional().describe('Explicit simplices (if not provided, computed from vertices)'),
    maxDimension: z.number().int().min(0).max(3).default(2).describe('Maximum homology dimension to compute'),
});
export const TopologyInputSchema = z.object({
    complex: SimplicialComplexSchema.describe('Simplicial complex for topological analysis'),
});
// ============================================================================
// Memory Gate Types
// ============================================================================
export const MemoryGateInputSchema = z.object({
    key: z.string().describe('Memory entry key'),
    value: z.unknown().describe('Value to be stored'),
    existingVectors: z.array(z.array(z.number())).optional().describe('Existing context embeddings'),
    thresholds: z.object({
        reject: z.number().min(0).max(1).default(0.7),
        warn: z.number().min(0).max(1).default(0.3),
    }).optional().describe('Custom coherence thresholds'),
});
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Create a successful MCP tool result
 */
export function successResult(data) {
    return {
        content: [{
                type: 'text',
                text: JSON.stringify(data, null, 2),
            }],
    };
}
/**
 * Create an error MCP tool result
 */
export function errorResult(error) {
    const message = error instanceof Error ? error.message : error;
    return {
        content: [{
                type: 'text',
                text: JSON.stringify({
                    error: true,
                    message,
                    timestamp: new Date().toISOString(),
                }, null, 2),
            }],
        isError: true,
    };
}
/**
 * Track performance metrics
 */
export function trackPerformance(operationName, operation) {
    const startTime = performance.now();
    return Promise.resolve()
        .then(() => operation())
        .then((result) => {
        const endTime = performance.now();
        return {
            result,
            metrics: {
                operationName,
                startTime,
                endTime,
                duration: endTime - startTime,
                success: true,
            },
        };
    })
        .catch((error) => {
        const endTime = performance.now();
        throw {
            error,
            metrics: {
                operationName,
                startTime,
                endTime,
                duration: endTime - startTime,
                success: false,
                error: error instanceof Error ? error.message : String(error),
            },
        };
    });
}
/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a, b) {
    if (a.length !== b.length) {
        throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
    }
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0)
        return 0;
    return dotProduct / denominator;
}
//# sourceMappingURL=types.js.map