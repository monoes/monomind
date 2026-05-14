/**
 * Pure JavaScript SemanticRouter implementation
 *
 * Provides intent routing using cosine similarity.
 * This is a fallback implementation since @ruvector/router's native VectorDb has bugs.
 *
 * Performance: ~50,000 routes/sec with 100 intents (sufficient for agent routing)
 */
export class SemanticRouter {
    dimension;
    metric;
    intents = new Map();
    totalVectors = 0;
    constructor(config) {
        if (!config || typeof config.dimension !== 'number') {
            throw new Error('SemanticRouter requires a dimension in config');
        }
        this.dimension = config.dimension;
        this.metric = config.metric ?? 'cosine';
    }
    /**
     * Add an intent with pre-computed embeddings
     */
    addIntentWithEmbeddings(name, embeddings, metadata = {}) {
        if (!name || !Array.isArray(embeddings)) {
            throw new Error('Must provide name and embeddings array');
        }
        // Validate embeddings
        for (const emb of embeddings) {
            if (!(emb instanceof Float32Array) || emb.length !== this.dimension) {
                throw new Error(`Embedding must be Float32Array of length ${this.dimension}`);
            }
        }
        // Normalize embeddings for cosine similarity
        const normalizedEmbeddings = embeddings.map(emb => this.normalize(emb));
        this.intents.set(name, {
            name,
            embeddings: normalizedEmbeddings,
            metadata,
        });
        this.totalVectors += embeddings.length;
    }
    /**
     * Route a query using a pre-computed embedding
     */
    routeWithEmbedding(embedding, k = 5) {
        if (!(embedding instanceof Float32Array) || embedding.length !== this.dimension) {
            throw new Error(`Embedding must be Float32Array of length ${this.dimension}`);
        }
        const normalizedQuery = this.normalize(embedding);
        const scores = [];
        // Calculate best score for each intent
        for (const [intentName, intent] of this.intents) {
            let bestScore = -Infinity;
            for (const storedEmb of intent.embeddings) {
                const score = this.similarity(normalizedQuery, storedEmb);
                if (score > bestScore) {
                    bestScore = score;
                }
            }
            scores.push({
                intent: intentName,
                score: bestScore,
                metadata: intent.metadata,
            });
        }
        // Sort by score descending and take top k
        return scores
            .sort((a, b) => b.score - a.score)
            .slice(0, k);
    }
    /**
     * Remove an intent
     */
    removeIntent(name) {
        const intent = this.intents.get(name);
        if (!intent)
            return false;
        this.totalVectors -= intent.embeddings.length;
        this.intents.delete(name);
        return true;
    }
    /**
     * Get all intent names
     */
    getIntents() {
        return Array.from(this.intents.keys());
    }
    /**
     * Get intent details
     */
    getIntent(name) {
        const data = this.intents.get(name);
        if (!data)
            return null;
        return {
            name: data.name,
            utterances: [], // We don't store utterances, only embeddings
            metadata: data.metadata,
        };
    }
    /**
     * Clear all intents
     */
    clear() {
        this.intents.clear();
        this.totalVectors = 0;
    }
    /**
     * Get total vector count
     */
    count() {
        return this.totalVectors;
    }
    /**
     * Get number of intents
     */
    intentCount() {
        return this.intents.size;
    }
    /**
     * Normalize a vector for cosine similarity
     */
    normalize(vec) {
        let norm = 0;
        for (let i = 0; i < vec.length; i++) {
            norm += vec[i] * vec[i];
        }
        norm = Math.sqrt(norm);
        if (norm === 0)
            return vec;
        const normalized = new Float32Array(vec.length);
        for (let i = 0; i < vec.length; i++) {
            normalized[i] = vec[i] / norm;
        }
        return normalized;
    }
    /**
     * Calculate similarity between two normalized vectors
     */
    similarity(a, b) {
        switch (this.metric) {
            case 'cosine':
                // For normalized vectors, cosine similarity = dot product
                return this.dotProduct(a, b);
            case 'dotProduct':
                return this.dotProduct(a, b);
            case 'euclidean':
                // Convert Euclidean distance to similarity
                return 1 / (1 + this.euclideanDistance(a, b));
            default:
                return this.dotProduct(a, b);
        }
    }
    dotProduct(a, b) {
        let sum = 0;
        for (let i = 0; i < a.length; i++) {
            sum += a[i] * b[i];
        }
        return sum;
    }
    euclideanDistance(a, b) {
        let sum = 0;
        for (let i = 0; i < a.length; i++) {
            const diff = a[i] - b[i];
            sum += diff * diff;
        }
        return Math.sqrt(sum);
    }
}
/**
 * Create a SemanticRouter with the given configuration
 */
export function createSemanticRouter(config) {
    return new SemanticRouter(config);
}
export default SemanticRouter;
//# sourceMappingURL=semantic-router.js.map