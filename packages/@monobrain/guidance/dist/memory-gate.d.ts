/**
 * Memory Write Gating System
 *
 * Adds authority scope, TTL, decay, and contradiction tracking
 * to memory operations. Ensures that only authorized agents can
 * write to specific namespaces, enforces rate limits, and detects
 * contradictions between memory entries.
 *
 * @module @monobrain/guidance/memory-gate
 */
/**
 * Authority definition for a memory-writing agent
 */
export interface MemoryAuthority {
    /** Agent identifier */
    agentId: string;
    /** Role in the hierarchy */
    role: 'queen' | 'coordinator' | 'worker' | 'observer';
    /** Namespaces this agent is allowed to write to */
    namespaces: string[];
    /** Maximum writes allowed per minute */
    maxWritesPerMinute: number;
    /** Whether this agent can delete entries */
    canDelete: boolean;
    /** Whether this agent can overwrite existing entries */
    canOverwrite: boolean;
    /** Trust level from 0 (untrusted) to 1 (fully trusted) */
    trustLevel: number;
}
/**
 * A gated memory entry with metadata for TTL, decay, lineage, and contradictions
 */
export interface MemoryEntry {
    /** Entry key */
    key: string;
    /** Namespace the entry belongs to */
    namespace: string;
    /** The stored value */
    value: unknown;
    /** SHA-256 hash of the serialized value */
    valueHash: string;
    /** Authority that created/last wrote this entry */
    authority: MemoryAuthority;
    /** Timestamp when the entry was created (ms since epoch) */
    createdAt: number;
    /** Timestamp of the last update (ms since epoch) */
    updatedAt: number;
    /** Time-to-live in milliseconds, or null for no expiry */
    ttlMs: number | null;
    /** Decay rate from 0 (no decay) to 1 (immediate decay) */
    decayRate: number;
    /** Confidence score from 0 to 1, decays over time */
    confidence: number;
    /** Lineage tracking for provenance */
    lineage: {
        parentKey?: string;
        derivedFrom?: string[];
        operation: string;
    };
    /** Detected contradictions with other entries */
    contradictions: Array<{
        entryKey: string;
        description: string;
        resolvedAt?: number;
    }>;
}
/**
 * Result of evaluating a write request
 */
export interface WriteDecision {
    /** Whether the write is allowed */
    allowed: boolean;
    /** Human-readable reason for the decision */
    reason: string;
    /** Contradictions detected with existing entries */
    contradictions: Array<{
        existingKey: string;
        description: string;
    }>;
    /** Authority check result */
    authorityCheck: {
        passed: boolean;
        requiredRole: string;
        actualRole: string;
    };
    /** Rate limit check result */
    rateCheck: {
        passed: boolean;
        writesInWindow: number;
        limit: number;
    };
    /** Overwrite permission check result */
    overwriteCheck: {
        isOverwrite: boolean;
        allowed: boolean;
    };
}
/**
 * Configuration for the MemoryWriteGate
 */
export interface MemoryWriteGateConfig {
    /** Pre-registered authorities */
    authorities?: MemoryAuthority[];
    /** Similarity threshold for contradiction detection (0-1) */
    contradictionThreshold?: number;
    /** Default TTL for new entries in ms (null = no expiry) */
    defaultTtlMs?: number;
    /** Default decay rate for new entries (0-1) */
    defaultDecayRate?: number;
    /** Whether to run contradiction detection on writes */
    enableContradictionTracking?: boolean;
}
/**
 * Memory Write Gate
 *
 * Controls write access to the memory system by enforcing:
 * - Authority checks (namespace access, role hierarchy)
 * - Rate limiting (sliding window per agent)
 * - Overwrite permissions
 * - Contradiction detection against existing entries
 * - TTL and confidence decay tracking
 */
export declare class MemoryWriteGate {
    private authorities;
    private writeTimestamps;
    private contradictionThreshold;
    private defaultTtlMs;
    private defaultDecayRate;
    private enableContradictionTracking;
    private contradictionResolutions;
    constructor(config?: MemoryWriteGateConfig);
    /**
     * Evaluate whether a write operation should be allowed.
     *
     * Steps:
     * 1. Check authority (namespace allowed, role sufficient)
     * 2. Check rate limit
     * 3. Check overwrite permission
     * 4. Detect contradictions against existing entries
     * 5. Return decision
     */
    evaluateWrite(authority: MemoryAuthority, key: string, namespace: string, value: unknown, existingEntries?: MemoryEntry[]): WriteDecision;
    /**
     * Register a new authority or update an existing one
     */
    registerAuthority(authority: MemoryAuthority): void;
    /**
     * Compute the current confidence for an entry based on decay over time.
     *
     * Uses exponential decay: confidence = initialConfidence * e^(-decayRate * ageHours)
     * where ageHours is (now - updatedAt) / 3600000
     */
    computeConfidence(entry: MemoryEntry): number;
    /**
     * Get all entries whose TTL has been exceeded
     */
    getExpiredEntries(entries: MemoryEntry[]): MemoryEntry[];
    /**
     * Get entries whose decayed confidence has dropped below a threshold
     */
    getDecayedEntries(entries: MemoryEntry[], threshold: number): MemoryEntry[];
    /**
     * Detect contradictions between a new value and existing entries.
     *
     * Uses string-based pattern matching to find conflicting statements
     * (must vs never, always vs never, require vs forbid, etc.)
     */
    detectContradictions(newValue: unknown, existingEntries: MemoryEntry[]): Array<{
        entryKey: string;
        description: string;
    }>;
    /**
     * Mark a contradiction as resolved
     */
    resolveContradiction(entryKey: string, resolution: string): void;
    /**
     * Get the authority for an agent by ID
     */
    getAuthorityFor(agentId: string): MemoryAuthority | undefined;
    /**
     * Get the current rate limit status for an agent
     */
    getRateLimitStatus(agentId: string): {
        writesInWindow: number;
        limit: number;
        resetAt: number;
    };
    /** Get the default TTL in ms */
    getDefaultTtlMs(): number | null;
    /** Get the default decay rate */
    getDefaultDecayRate(): number;
    /** Check if contradiction tracking is enabled */
    isContradictionTrackingEnabled(): boolean;
    /** Get the contradiction resolution for an entry key */
    getContradictionResolution(entryKey: string): string | undefined;
    /**
     * Check whether an authority is allowed to write to a namespace
     */
    private checkAuthority;
    /**
     * Check rate limit using a sliding window of write timestamps
     */
    private checkRateLimit;
    /**
     * Record a write timestamp for an agent
     */
    private recordWrite;
}
/**
 * Create a MemoryWriteGate instance with optional configuration
 */
export declare function createMemoryWriteGate(config?: MemoryWriteGateConfig): MemoryWriteGate;
/**
 * Create a new MemoryEntry with defaults applied
 */
export declare function createMemoryEntry(key: string, namespace: string, value: unknown, authority: MemoryAuthority, options?: {
    ttlMs?: number | null;
    decayRate?: number;
    confidence?: number;
    lineage?: MemoryEntry['lineage'];
}): MemoryEntry;
//# sourceMappingURL=memory-gate.d.ts.map