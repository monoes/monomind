/**
 * Consensus Verification Tool - pr_consensus_verify
 *
 * Verifies multi-agent consensus mathematically using coherence analysis.
 * Identifies divergent agents and measures agreement ratios.
 *
 * Uses CohomologyEngine for multi-agent consensus validation
 */
import { ConsensusInputSchema, successResult, errorResult, cosineSimilarity, } from './types.js';
// Default logger
const defaultLogger = {
    debug: (msg, meta) => console.debug(`[pr_consensus_verify] ${msg}`, meta),
    info: (msg, meta) => console.info(`[pr_consensus_verify] ${msg}`, meta),
    warn: (msg, meta) => console.warn(`[pr_consensus_verify] ${msg}`, meta),
    error: (msg, meta) => console.error(`[pr_consensus_verify] ${msg}`, meta),
};
// ============================================================================
// Consensus Analysis Functions
// ============================================================================
/**
 * Compute pairwise similarity matrix
 */
function computeSimilarityMatrix(embeddings) {
    const n = embeddings.length;
    const matrix = [];
    for (let i = 0; i < n; i++) {
        const row = [];
        const embi = embeddings[i];
        for (let j = 0; j < n; j++) {
            const embj = embeddings[j];
            row.push(cosineSimilarity(embi, embj));
        }
        matrix.push(row);
    }
    return matrix;
}
/**
 * Compute coherence energy using Sheaf Laplacian approach
 */
function computeCoherenceEnergy(embeddings) {
    if (embeddings.length < 2)
        return 0;
    const n = embeddings.length;
    let totalDisagreement = 0;
    let edgeCount = 0;
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const embi = embeddings[i];
            const embj = embeddings[j];
            const similarity = cosineSimilarity(embi, embj);
            const disagreement = 1 - Math.max(0, similarity);
            totalDisagreement += disagreement;
            edgeCount++;
        }
    }
    return edgeCount > 0 ? totalDisagreement / edgeCount : 0;
}
/**
 * Identify divergent agents whose embeddings differ significantly from the group
 */
function identifyDivergentAgents(agentStates, threshold) {
    if (agentStates.length < 2)
        return [];
    const embeddings = agentStates.map(s => s.embedding);
    const n = embeddings.length;
    const divergentAgents = [];
    // Compute centroid
    const firstEmb = embeddings[0];
    if (!firstEmb)
        return [];
    const dim = firstEmb.length;
    const centroid = new Array(dim).fill(0);
    for (const emb of embeddings) {
        for (let d = 0; d < dim; d++) {
            const val = emb[d];
            if (val !== undefined) {
                centroid[d] = (centroid[d] ?? 0) + val / n;
            }
        }
    }
    // Find agents far from centroid
    for (let i = 0; i < n; i++) {
        const embi = embeddings[i];
        const agentState = agentStates[i];
        const similarity = cosineSimilarity(embi, centroid);
        if (similarity < threshold) {
            divergentAgents.push(agentState.agentId);
        }
    }
    return divergentAgents;
}
/**
 * Compute vote-based agreement ratio
 */
function computeVoteAgreement(agentStates) {
    const votes = agentStates.filter(s => s.vote !== undefined).map(s => s.vote);
    if (votes.length < 2)
        return 1;
    // Count vote frequencies
    const voteCounts = new Map();
    for (const vote of votes) {
        voteCounts.set(vote, (voteCounts.get(vote) || 0) + 1);
    }
    // Agreement is based on majority
    const values = Array.from(voteCounts.values());
    const maxCount = values.length > 0 ? Math.max(...values) : 0;
    return maxCount / votes.length;
}
/**
 * Compute spectral stability from similarity matrix
 */
function computeSpectralStability(similarityMatrix) {
    const n = similarityMatrix.length;
    if (n < 2)
        return { stable: true, spectralGap: 1 };
    // Convert similarity to adjacency (threshold at 0.5)
    const adjacency = [];
    for (let i = 0; i < n; i++) {
        const row = [];
        const simRow = similarityMatrix[i];
        for (let j = 0; j < n; j++) {
            const simVal = simRow[j] ?? 0;
            row.push(simVal > 0.5 ? simVal : 0);
        }
        adjacency.push(row);
    }
    // Compute degree matrix and Laplacian
    const degrees = [];
    for (let i = 0; i < n; i++) {
        let degree = 0;
        const adjRow = adjacency[i];
        for (let j = 0; j < n; j++) {
            degree += adjRow[j] ?? 0;
        }
        degrees.push(degree);
    }
    // Estimate spectral gap using power iteration on Laplacian
    // Simplified: use average degree connectivity as proxy
    const avgDegree = degrees.reduce((a, b) => a + b, 0) / n;
    const maxDegree = Math.max(...degrees);
    const spectralGap = maxDegree > 0 ? avgDegree / maxDegree : 0;
    const stable = spectralGap > 0.3;
    return { stable, spectralGap };
}
/**
 * Get interpretation of consensus results
 */
function getInterpretation(verified, coherenceScore, divergentAgents, spectralStability) {
    if (verified && divergentAgents.length === 0) {
        return 'Strong consensus achieved - all agents are aligned';
    }
    if (verified && divergentAgents.length > 0) {
        return `Consensus achieved with ${divergentAgents.length} minority agent(s)`;
    }
    if (!spectralStability) {
        return 'Consensus not achieved - agent network shows instability patterns';
    }
    if (coherenceScore < 0.5) {
        return 'Consensus not achieved - significant disagreement between agents';
    }
    return `Consensus not achieved - ${divergentAgents.length} divergent agent(s) detected`;
}
/**
 * Handler for pr_consensus_verify tool
 */
async function handler(input, context) {
    const logger = context?.logger ?? defaultLogger;
    const startTime = performance.now();
    try {
        // Validate input
        const validationResult = ConsensusInputSchema.safeParse(input);
        if (!validationResult.success) {
            logger.error('Input validation failed', { error: validationResult.error.message });
            return errorResult(`Invalid input: ${validationResult.error.message}`);
        }
        const { agentStates, threshold } = validationResult.data;
        logger.debug('Processing consensus verification', {
            agentCount: agentStates.length,
            threshold,
        });
        if (agentStates.length === 0) {
            return errorResult('No agent states provided');
        }
        // Validate embedding dimensions are consistent
        const firstDim = agentStates[0].embedding.length;
        for (let i = 1; i < agentStates.length; i++) {
            if (agentStates[i].embedding.length !== firstDim) {
                return errorResult(`Embedding dimension mismatch: agent ${agentStates[i].agentId} has ` +
                    `${agentStates[i].embedding.length} dimensions, expected ${firstDim}`);
            }
        }
        const embeddings = agentStates.map(s => s.embedding);
        let coherenceEnergy;
        let divergentAgents;
        // Try to use WASM bridge if available
        if (context?.bridge?.initialized) {
            try {
                logger.debug('Using WASM bridge for coherence check');
                const float32Embeddings = embeddings.map(e => new Float32Array(e));
                const result = await context.bridge.checkCoherence(float32Embeddings);
                coherenceEnergy = result.energy;
                // WASM doesn't return divergent agents, compute separately
                divergentAgents = identifyDivergentAgents(agentStates, threshold);
            }
            catch (wasmError) {
                logger.warn('WASM bridge failed, falling back to JS implementation', {
                    error: wasmError instanceof Error ? wasmError.message : String(wasmError),
                });
                coherenceEnergy = computeCoherenceEnergy(embeddings);
                divergentAgents = identifyDivergentAgents(agentStates, threshold);
            }
        }
        else {
            // Pure JavaScript fallback
            logger.debug('Using JavaScript fallback for consensus verification');
            coherenceEnergy = computeCoherenceEnergy(embeddings);
            divergentAgents = identifyDivergentAgents(agentStates, threshold);
        }
        // Compute additional metrics
        const similarityMatrix = computeSimilarityMatrix(embeddings);
        const { stable: spectralStability, spectralGap } = computeSpectralStability(similarityMatrix);
        const voteAgreement = computeVoteAgreement(agentStates);
        // Coherence score is inverse of energy
        const coherenceScore = 1 - coherenceEnergy;
        // Agreement ratio combines embedding coherence and vote agreement
        const agreementRatio = (coherenceScore + voteAgreement) / 2;
        // Consensus is verified if agreement exceeds threshold and no major divergence
        const verified = agreementRatio >= threshold &&
            divergentAgents.length <= Math.floor(agentStates.length * 0.2); // Allow 20% minority
        const output = {
            verified,
            coherenceScore,
            divergentAgents,
            details: {
                agreementRatio,
                coherenceEnergy,
                spectralStability,
                spectralGap,
                interpretation: getInterpretation(verified, coherenceScore, divergentAgents, spectralStability),
                agentCount: agentStates.length,
            },
        };
        const duration = performance.now() - startTime;
        logger.info('Consensus verification completed', {
            verified,
            coherenceScore: coherenceScore.toFixed(4),
            divergentAgents: divergentAgents.length,
            durationMs: duration.toFixed(2),
        });
        return successResult(output);
    }
    catch (error) {
        const duration = performance.now() - startTime;
        logger.error('Consensus verification failed', {
            error: error instanceof Error ? error.message : String(error),
            durationMs: duration.toFixed(2),
        });
        return errorResult(error instanceof Error ? error : new Error(String(error)));
    }
}
/**
 * pr_consensus_verify MCP Tool Definition
 */
export const consensusVerifyTool = {
    name: 'pr_consensus_verify',
    description: 'Verify multi-agent consensus mathematically using coherence analysis. Identifies divergent agents and measures agreement ratios. Uses CohomologyEngine for consensus validation.',
    category: 'consensus',
    version: '0.1.3',
    tags: ['consensus', 'multi-agent', 'coherence', 'swarm', 'ai-interpretability'],
    cacheable: false, // Agent states change frequently
    inputSchema: {
        type: 'object',
        properties: {
            agentStates: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        agentId: { type: 'string', description: 'Unique agent identifier' },
                        embedding: {
                            type: 'array',
                            items: { type: 'number' },
                            description: 'Agent state embedding vector',
                        },
                        vote: { type: 'string', description: 'Agent vote or decision' },
                        metadata: { type: 'object', description: 'Additional agent metadata' },
                    },
                    required: ['agentId', 'embedding'],
                },
                description: 'Array of agent states to verify consensus',
            },
            threshold: {
                type: 'number',
                default: 0.8,
                description: 'Required agreement threshold (0-1)',
            },
        },
        required: ['agentStates'],
    },
    handler,
};
export default consensusVerifyTool;
//# sourceMappingURL=consensus-verify.js.map