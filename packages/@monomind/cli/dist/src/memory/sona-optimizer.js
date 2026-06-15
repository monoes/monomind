/**
 * SONA (Self-Optimizing Neural Architecture) Optimizer
 *
 * Processes trajectory outcomes to learn optimal routing patterns.
 * Integrates with Q-learning router and persistence layer.
 *
 * Features:
 * - Processes trajectory outcomes from hooksTrajectoryEnd
 * - Extracts keywords from tasks for pattern matching
 * - Maintains learned routing patterns with confidence scoring
 * - Persists patterns to .swarm/sona-patterns.json
 * @module v1/cli/memory/sona-optimizer
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
// ============================================================================
// Constants
// ============================================================================
const DEFAULT_PERSISTENCE_PATH = '.swarm/sona-patterns.json';
const PATTERN_VERSION = '1.0.0';
const MIN_CONFIDENCE = 0.1;
const MAX_CONFIDENCE = 0.99;
const CONFIDENCE_INCREMENT = 0.1;
const CONFIDENCE_DECREMENT = 0.15;
const DECAY_RATE = 0.01; // Per day
const MAX_PATTERNS = 1000;
/**
 * Common agent types for routing
 */
const AGENT_TYPES = [
    'coder',
    'tester',
    'reviewer',
    'architect',
    'researcher',
    'optimizer',
    'debugger',
    'documenter',
    'security-architect',
    'performance-engineer',
];
/**
 * Task keywords for pattern extraction
 */
const KEYWORD_CATEGORIES = {
    coder: [
        'implement', 'code', 'write', 'create', 'build', 'develop', 'add',
        'feature', 'function', 'class', 'module', 'api', 'endpoint',
    ],
    tester: [
        'test', 'spec', 'coverage', 'unit', 'integration', 'e2e', 'mock',
        'assert', 'expect', 'verify', 'validate', 'scenario',
    ],
    reviewer: [
        'review', 'check', 'audit', 'analyze', 'inspect', 'evaluate',
        'quality', 'standards', 'best-practices', 'lint',
    ],
    architect: [
        'architect', 'design', 'structure', 'pattern', 'system', 'schema',
        'database', 'infrastructure', 'scalability', 'architecture',
    ],
    researcher: [
        'research', 'investigate', 'explore', 'find', 'search', 'discover',
        'analyze', 'understand', 'learn', 'study',
    ],
    optimizer: [
        'optimize', 'performance', 'speed', 'memory', 'improve', 'enhance',
        'faster', 'efficient', 'reduce', 'benchmark',
    ],
    debugger: [
        'debug', 'fix', 'bug', 'error', 'issue', 'problem', 'crash',
        'exception', 'trace', 'diagnose', 'resolve',
    ],
    documenter: [
        'document', 'docs', 'readme', 'comment', 'explain', 'guide',
        'tutorial', 'api-docs', 'specification', 'jsdoc',
    ],
    'security-architect': [
        'security', 'auth', 'authentication', 'authorization', 'encrypt',
        'vulnerability', 'cve', 'secure', 'permission', 'role',
    ],
    'performance-engineer': [
        'profiling', 'bottleneck', 'latency', 'throughput', 'cache',
        'scale', 'load', 'stress', 'concurrent', 'parallel',
    ],
};
// ============================================================================
// SONAOptimizer Class
// ============================================================================
/**
 * SONA Optimizer for adaptive routing based on trajectory outcomes
 *
 * Learns from past task outcomes to improve future routing decisions.
 */
export class SONAOptimizer {
    patterns = new Map();
    trajectoriesProcessed = 0;
    successfulRoutings = 0;
    failedRoutings = 0;
    lastUpdate = null;
    persistencePath;
    constructor(options) {
        this.persistencePath = options?.persistencePath || DEFAULT_PERSISTENCE_PATH;
    }
    /**
     * Initialize the optimizer and load persisted state
     */
    async initialize() {
        // Load persisted patterns
        const loaded = this.loadFromDisk();
        return {
            success: true,
            patternsLoaded: loaded ? this.patterns.size : 0,
        };
    }
    /**
     * Process a trajectory outcome and learn from it
     * Called by hooksTrajectoryEnd
     */
    processTrajectoryOutcome(outcome) {
        const { task, agent, success } = outcome;
        // Extract keywords from task
        const keywords = this.extractKeywords(task);
        if (keywords.length === 0) {
            return {
                learned: false,
                patternKey: '',
                confidence: 0,
                keywordsExtracted: [],
            };
        }
        // Create pattern key from sorted keywords
        const patternKey = this.createPatternKey(keywords, agent);
        // Get or create pattern
        let pattern = this.patterns.get(patternKey);
        if (!pattern) {
            pattern = {
                keywords,
                agent,
                confidence: 0.5, // Start at neutral
                successCount: 0,
                failureCount: 0,
                lastUsed: Date.now(),
                createdAt: Date.now(),
            };
        }
        // Update pattern based on outcome
        if (success) {
            pattern.successCount++;
            pattern.confidence = Math.min(MAX_CONFIDENCE, pattern.confidence + CONFIDENCE_INCREMENT * (1 - pattern.confidence));
            this.successfulRoutings++;
        }
        else {
            pattern.failureCount++;
            pattern.confidence = Math.max(MIN_CONFIDENCE, pattern.confidence - CONFIDENCE_DECREMENT * pattern.confidence);
            this.failedRoutings++;
        }
        pattern.lastUsed = Date.now();
        // Store pattern
        this.patterns.set(patternKey, pattern);
        this.trajectoriesProcessed++;
        this.lastUpdate = Date.now();
        // Prune old patterns if needed
        this.prunePatterns();
        // Persist to disk (debounced)
        this.saveToDisk();
        return {
            learned: true,
            patternKey,
            confidence: pattern.confidence,
            keywordsExtracted: keywords,
        };
    }
    /**
     * Get routing suggestion based on learned patterns
     */
    getRoutingSuggestion(task) {
        const keywords = this.extractKeywords(task);
        // Try SONA pattern matching first
        const sonaResult = this.findBestPatternMatch(keywords);
        if (sonaResult && sonaResult.confidence >= 0.6) {
            return {
                agent: sonaResult.agent,
                confidence: sonaResult.confidence,
                source: 'sona-pattern',
                alternatives: this.getAlternatives(keywords, sonaResult.agent),
                matchedKeywords: sonaResult.matchedKeywords,
            };
        }
        // Fallback to keyword-based heuristic
        const keywordMatch = this.matchKeywordsToAgent(keywords);
        if (keywordMatch) {
            return {
                agent: keywordMatch.agent,
                confidence: keywordMatch.confidence,
                source: 'keyword-match',
                alternatives: this.getAlternatives(keywords, keywordMatch.agent),
                matchedKeywords: keywordMatch.matchedKeywords,
            };
        }
        // Default fallback
        return {
            agent: 'coder',
            confidence: 0.3,
            source: 'default',
            alternatives: [
                { agent: 'researcher', score: 0.2 },
                { agent: 'architect', score: 0.15 },
            ],
        };
    }
    /**
     * Get optimizer statistics
     */
    getStats() {
        let totalConfidence = 0;
        for (const pattern of this.patterns.values()) {
            totalConfidence += pattern.confidence;
        }
        return {
            totalPatterns: this.patterns.size,
            successfulRoutings: this.successfulRoutings,
            failedRoutings: this.failedRoutings,
            trajectoriesProcessed: this.trajectoriesProcessed,
            avgConfidence: this.patterns.size > 0 ? totalConfidence / this.patterns.size : 0,
            lastUpdate: this.lastUpdate,
        };
    }
    /**
     * Apply temporal decay to pattern confidence
     * Reduces confidence of unused patterns
     */
    applyTemporalDecay() {
        const now = Date.now();
        let decayed = 0;
        for (const [key, pattern] of this.patterns) {
            const daysSinceUse = (now - pattern.lastUsed) / (1000 * 60 * 60 * 24);
            if (daysSinceUse > 1) {
                const decay = Math.exp(-DECAY_RATE * daysSinceUse);
                const newConfidence = pattern.confidence * decay;
                if (newConfidence < MIN_CONFIDENCE) {
                    // Remove patterns with very low confidence
                    this.patterns.delete(key);
                }
                else {
                    pattern.confidence = newConfidence;
                }
                decayed++;
            }
        }
        if (decayed > 0) {
            this.saveToDisk();
        }
        return decayed;
    }
    /**
     * Reset all learned patterns
     */
    reset() {
        this.patterns.clear();
        this.trajectoriesProcessed = 0;
        this.successfulRoutings = 0;
        this.failedRoutings = 0;
        this.lastUpdate = null;
        this.saveToDisk();
    }
    /**
     * Export patterns for analysis
     */
    exportPatterns() {
        const result = {};
        for (const [key, pattern] of this.patterns) {
            result[key] = { ...pattern };
        }
        return result;
    }
    /**
     * Import patterns (for migration or testing)
     */
    importPatterns(patterns) {
        let imported = 0;
        for (const [key, pattern] of Object.entries(patterns)) {
            if (this.validatePattern(pattern)) {
                this.patterns.set(key, pattern);
                imported++;
            }
        }
        this.saveToDisk();
        return imported;
    }
    // ============================================================================
    // Private Methods
    // ============================================================================
    /**
     * Extract meaningful keywords from task description
     */
    extractKeywords(task) {
        if (!task || typeof task !== 'string') {
            return [];
        }
        const lower = task.toLowerCase();
        const words = lower.split(/[\s\-_.,;:!?'"()\[\]{}]+/).filter(w => w.length > 2);
        // Extract keywords that match our categories
        const keywords = new Set();
        for (const categoryKeywords of Object.values(KEYWORD_CATEGORIES)) {
            for (const keyword of categoryKeywords) {
                if (lower.includes(keyword)) {
                    keywords.add(keyword);
                }
            }
        }
        // Add any significant words not in categories
        for (const word of words) {
            if (word.length >= 4 && !this.isStopWord(word)) {
                keywords.add(word);
            }
        }
        return Array.from(keywords).slice(0, 10); // Limit to 10 keywords
    }
    /**
     * Check if word is a stop word
     */
    isStopWord(word) {
        const stopWords = new Set([
            'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'been',
            'will', 'would', 'could', 'should', 'into', 'then', 'than', 'when',
            'where', 'which', 'there', 'their', 'what', 'about', 'more', 'some',
            'also', 'just', 'only', 'other', 'very', 'after', 'most', 'such',
        ]);
        return stopWords.has(word);
    }
    /**
     * Create a unique pattern key from keywords and agent
     */
    createPatternKey(keywords, agent) {
        const sortedKeywords = [...keywords].sort();
        return `${agent}:${sortedKeywords.join('+')}`;
    }
    /**
     * Find the best matching pattern for given keywords
     */
    findBestPatternMatch(keywords) {
        if (keywords.length === 0 || this.patterns.size === 0) {
            return null;
        }
        let bestMatch = null;
        let bestScore = 0;
        for (const pattern of this.patterns.values()) {
            const matchedKeywords = pattern.keywords.filter(k => keywords.includes(k));
            const matchRatio = matchedKeywords.length / Math.max(pattern.keywords.length, keywords.length);
            // Combine match ratio with confidence
            const score = matchRatio * pattern.confidence;
            if (score > bestScore && matchedKeywords.length >= 1) {
                bestScore = score;
                bestMatch = {
                    agent: pattern.agent,
                    confidence: pattern.confidence * matchRatio,
                    matchedKeywords,
                };
            }
        }
        return bestMatch;
    }
    /**
     * Match keywords to agent using category heuristics
     */
    matchKeywordsToAgent(keywords) {
        const scores = {};
        for (const [agent, categoryKeywords] of Object.entries(KEYWORD_CATEGORIES)) {
            const matched = keywords.filter(k => categoryKeywords.includes(k));
            if (matched.length > 0) {
                scores[agent] = {
                    score: matched.length / categoryKeywords.length,
                    matched,
                };
            }
        }
        // Find best scoring agent
        let bestAgent = '';
        let bestScore = 0;
        let bestMatched = [];
        for (const [agent, data] of Object.entries(scores)) {
            if (data.score > bestScore) {
                bestScore = data.score;
                bestAgent = agent;
                bestMatched = data.matched;
            }
        }
        if (bestAgent && bestScore > 0) {
            return {
                agent: bestAgent,
                confidence: Math.min(0.7, 0.3 + bestScore),
                matchedKeywords: bestMatched,
            };
        }
        return null;
    }
    /**
     * Get alternative agent suggestions
     */
    getAlternatives(keywords, excludeAgent) {
        const alternatives = [];
        for (const [agent, categoryKeywords] of Object.entries(KEYWORD_CATEGORIES)) {
            if (agent === excludeAgent)
                continue;
            const matched = keywords.filter(k => categoryKeywords.includes(k));
            if (matched.length > 0) {
                alternatives.push({
                    agent,
                    score: matched.length / Math.max(keywords.length, 1) * 0.5,
                });
            }
        }
        return alternatives
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);
    }
    /**
     * Prune old/low-confidence patterns if over limit
     */
    prunePatterns() {
        if (this.patterns.size <= MAX_PATTERNS) {
            return;
        }
        // Sort patterns by score (confidence * recency)
        const entries = Array.from(this.patterns.entries()).map(([key, pattern]) => {
            const ageInDays = (Date.now() - pattern.lastUsed) / (1000 * 60 * 60 * 24);
            const recency = Math.exp(-0.1 * ageInDays);
            const score = pattern.confidence * recency;
            return { key, pattern, score };
        });
        entries.sort((a, b) => a.score - b.score);
        // Remove lowest-scoring patterns
        const toRemove = entries.slice(0, entries.length - Math.floor(MAX_PATTERNS * 0.8));
        for (const { key } of toRemove) {
            this.patterns.delete(key);
        }
    }
    /**
     * Validate pattern structure with strict bounds.
     * SECURITY: confidence/keywords/agent fields must be bounds-checked to
     * defeat poisoning. typeof NaN === 'number' and typeof Infinity === 'number'
     * pass the loose typeof check; without bounds, an attacker who writes
     * sona-patterns.json (poisoned bundle, malicious test fixture, co-located
     * compromise) can inject `confidence: 1e308` to deterministically win
     * every routing decision via findBestPatternMatch's `score = matchRatio *
     * confidence`. Mirrors the pattern in intelligence.ts:loadFromDisk.
     */
    validatePattern(pattern) {
        if (!pattern || typeof pattern !== 'object')
            return false;
        const p = pattern;
        if (!Array.isArray(p.keywords) || p.keywords.length > 64)
            return false;
        if (!p.keywords.every(k => typeof k === 'string' && k.length > 0 && k.length <= 128))
            return false;
        if (typeof p.agent !== 'string' || p.agent.length === 0 || p.agent.length > 128)
            return false;
        if (typeof p.confidence !== 'number' || !Number.isFinite(p.confidence) || p.confidence < 0 || p.confidence > 1)
            return false;
        if (typeof p.successCount !== 'number' || !Number.isFinite(p.successCount) || p.successCount < 0 || p.successCount > 1e9)
            return false;
        if (typeof p.failureCount !== 'number' || !Number.isFinite(p.failureCount) || p.failureCount < 0 || p.failureCount > 1e9)
            return false;
        return true;
    }
    /**
     * Load patterns from disk
     */
    loadFromDisk() {
        try {
            const fullPath = join(process.cwd(), this.persistencePath);
            if (!existsSync(fullPath)) {
                return false;
            }
            if (statSync(fullPath).size > 50 * 1024 * 1024)
                return false;
            const data = readFileSync(fullPath, 'utf-8');
            const state = JSON.parse(data);
            // Validate version
            if (!state.version || !state.version.startsWith('1.')) {
                console.error('[SONA] Incompatible state version, starting fresh');
                return false;
            }
            // Load patterns — also cap key length so a crafted state file cannot
            // store arbitrarily long keys that bloat the in-memory Map. The key is
            // an agent:keyword string; 512 chars is ample for any real value.
            this.patterns.clear();
            for (const [key, pattern] of Object.entries(state.patterns)) {
                if (typeof key !== 'string' || key.length > 512)
                    continue;
                if (this.validatePattern(pattern)) {
                    this.patterns.set(key, pattern);
                }
            }
            // Load stats
            if (state.stats) {
                this.trajectoriesProcessed = state.stats.trajectoriesProcessed || 0;
                this.successfulRoutings = state.stats.successfulRoutings || 0;
                this.failedRoutings = state.stats.failedRoutings || 0;
                this.lastUpdate = state.stats.lastUpdate || null;
            }
            return true;
        }
        catch (err) {
            // Strip filesystem paths from error before logging to prevent path disclosure
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[SONA] Failed to load state: ${msg.replace(/\/[^\s:]+(\/|(?=\s|:|$))/g, '<path>/').slice(0, 200)}`);
            return false;
        }
    }
    /**
     * Save patterns to disk
     */
    saveToDisk() {
        try {
            const fullPath = join(process.cwd(), this.persistencePath);
            const dir = dirname(fullPath);
            // Ensure directory exists
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }
            const state = {
                version: PATTERN_VERSION,
                patterns: this.exportPatterns(),
                stats: {
                    trajectoriesProcessed: this.trajectoriesProcessed,
                    successfulRoutings: this.successfulRoutings,
                    failedRoutings: this.failedRoutings,
                    lastUpdate: this.lastUpdate,
                },
                metadata: {
                    createdAt: new Date().toISOString(),
                    savedAt: new Date().toISOString(),
                },
            };
            const tmp = fullPath + '.tmp';
            writeFileSync(tmp, JSON.stringify(state, null, 2));
            renameSync(tmp, fullPath);
            return true;
        }
        catch (err) {
            // Strip filesystem paths from error before logging to prevent path disclosure
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[SONA] Failed to save state: ${msg.replace(/\/[^\s:]+(\/|(?=\s|:|$))/g, '<path>/').slice(0, 200)}`);
            return false;
        }
    }
}
// ============================================================================
// Singleton Instance
// ============================================================================
let sonaOptimizerInstance = null;
let initializationPromise = null;
/**
 * Get the singleton SONAOptimizer instance
 * Uses lazy initialization to avoid circular imports
 */
export async function getSONAOptimizer() {
    if (sonaOptimizerInstance) {
        return sonaOptimizerInstance;
    }
    // Prevent multiple concurrent initializations
    if (initializationPromise) {
        return initializationPromise;
    }
    initializationPromise = (async () => {
        const optimizer = new SONAOptimizer();
        await optimizer.initialize();
        sonaOptimizerInstance = optimizer;
        return optimizer;
    })();
    return initializationPromise;
}
/**
 * Reset the singleton instance (for testing)
 */
export function resetSONAOptimizer() {
    if (sonaOptimizerInstance) {
        sonaOptimizerInstance.reset();
    }
    sonaOptimizerInstance = null;
    initializationPromise = null;
}
/**
 * Process a trajectory outcome (convenience function)
 */
export async function processTrajectory(outcome) {
    const optimizer = await getSONAOptimizer();
    return optimizer.processTrajectoryOutcome(outcome);
}
/**
 * Get routing suggestion (convenience function)
 */
export async function getSuggestion(task) {
    const optimizer = await getSONAOptimizer();
    return optimizer.getRoutingSuggestion(task);
}
/**
 * Get SONA statistics (convenience function)
 */
export async function getSONAStats() {
    const optimizer = await getSONAOptimizer();
    return optimizer.getStats();
}
export default {
    SONAOptimizer,
    getSONAOptimizer,
    resetSONAOptimizer,
    processTrajectory,
    getSuggestion,
    getSONAStats,
};
//# sourceMappingURL=sona-optimizer.js.map