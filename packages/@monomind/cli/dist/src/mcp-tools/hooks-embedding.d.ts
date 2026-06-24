/**
 * Hooks Embedding Utilities
 * Shared utility functions for hooks: embedding generation, memory access,
 * routing outcome persistence, agent suggestion, and risk assessment.
 * Extracted from hooks-tools.ts.
 */
export declare function getRouteOutcomesBaseDir(): string;
export declare function getRealSearchFunction(): Promise<((options: {
    query: string;
    namespace?: string;
    limit?: number;
    threshold?: number;
}) => Promise<{
    success: boolean;
    results: {
        id: string;
        key: string;
        content: string;
        score: number;
        namespace: string;
    }[];
    searchTime: number;
    error?: string;
}>) | null>;
export declare function getRealStoreFunction(): Promise<((options: {
    key: string;
    value: string;
    namespace?: string;
    generateEmbeddingFlag?: boolean;
    tags?: string[];
    ttl?: number;
}) => Promise<{
    success: boolean;
    id: string;
    embedding?: {
        dimensions: number;
        model: string;
    };
    error?: string;
}>) | null>;
export declare function getSONAOptimizer(): Promise<import("../memory/sona-optimizer.js").SONAOptimizer | null>;
export declare function getEWCConsolidator(): Promise<import("../memory/ewc-consolidation.js").EWCConsolidator | null>;
export declare function generateSimpleEmbedding(text: string, dimension?: number): Float32Array;
export declare function getRoutingOutcomesPath(): string;
export declare const ROUTING_STOPWORDS: Set<string>;
interface RoutingOutcome {
    task: string;
    agent: string;
    success: boolean;
    quality: number;
    keywords: string[];
    timestamp: string;
}
export declare function extractKeywords(text: string): string[];
export declare function loadRoutingOutcomes(): RoutingOutcome[];
export declare function saveRoutingOutcomes(outcomes: RoutingOutcome[]): void;
/**
 * Build learned routing patterns from successful task outcomes.
 * Returns patterns in the same shape as TASK_PATTERNS so they can be
 * merged into both the native HNSW and pure-JS semantic routers.
 */
export declare function loadLearnedPatterns(): Record<string, {
    keywords: string[];
    agents: string[];
}>;
/**
 * Merge static TASK_PATTERNS with runtime-learned patterns.
 * Static patterns take precedence (learned patterns won't overwrite them).
 */
export declare function getMergedTaskPatterns(): Record<string, {
    keywords: string[];
    agents: string[];
}>;
export declare const TASK_PATTERNS: Record<string, {
    keywords: string[];
    agents: string[];
}>;
export interface TrajectoryStep {
    action: string;
    result: string;
    quality: number;
    timestamp: string;
}
export interface TrajectoryData {
    id: string;
    task: string;
    agent: string;
    steps: TrajectoryStep[];
    startedAt: string;
    success?: boolean;
    endedAt?: string;
}
export declare const activeTrajectories: Map<string, TrajectoryData>;
export interface MemoryEntry {
    key: string;
    value: unknown;
    metadata?: Record<string, unknown>;
    storedAt: string;
    accessCount: number;
    lastAccessed: string;
}
export interface MemoryStore {
    entries: Record<string, MemoryEntry>;
    version: string;
}
export declare const MEMORY_DIR = ".monomind/memory";
export declare const MEMORY_FILE = "store.json";
export declare function getMemoryPath(): string;
export declare const MAX_MEMORY_STORE_BYTES: number;
export declare function loadMemoryStore(): MemoryStore;
/**
 * Get real intelligence statistics from memory store
 */
export declare function getIntelligenceStatsFromMemory(): {
    trajectories: {
        total: number;
        successful: number;
    };
    patterns: {
        learned: number;
        categories: Record<string, number>;
    };
    memory: {
        indexSize: number;
        totalAccessCount: number;
        memorySizeBytes: number;
    };
    routing: {
        decisions: number;
        avgConfidence: number;
    };
};
export declare const AGENT_PATTERNS: Record<string, string[]>;
export declare const KEYWORD_PATTERNS: Record<string, {
    agents: string[];
    confidence: number;
}>;
export declare function getFileExtension(filePath: string): string;
export declare function suggestAgentsForFile(filePath: string): string[];
export declare function suggestAgentsForTask(task: string): {
    agents: string[];
    confidence: number;
};
/**
 * V3: Augment agent suggestions with semantic matches from intelligence.ts ReasoningBank.
 * Returns null when the intelligence system is unavailable or has no relevant patterns.
 * Kept sync-safe by returning a Promise — callers that need a sync result use the
 * non-async suggestAgentsForTask above and optionally merge async results.
 */
export declare const VALID_AGENT_TYPES: Set<string>;
export declare function suggestAgentsFromIntelligence(task: string): Promise<{
    agents: string[];
    confidence: number;
} | null>;
export declare function assessCommandRisk(command: string): {
    risk: string;
    level: number;
    warnings: string[];
};
export {};
//# sourceMappingURL=hooks-embedding.d.ts.map