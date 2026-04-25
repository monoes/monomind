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
import { createHash } from 'node:crypto';
// ============================================================================
// Role Hierarchy
// ============================================================================
/** Role hierarchy levels (higher = more authority) */
const ROLE_HIERARCHY = {
    queen: 4,
    coordinator: 3,
    worker: 2,
    observer: 1,
};
/**
 * Minimum role required to write to any namespace
 */
const MINIMUM_WRITE_ROLE = 'worker';
// ============================================================================
// Contradiction Detection Patterns
// ============================================================================
const CONTRADICTION_PATTERNS = [
    {
        positive: /\bmust\b/i,
        negative: /\bnever\b|\bdo not\b|\bavoid\b/i,
        description: 'Conflicting obligation: "must" vs negation',
    },
    {
        positive: /\balways\b/i,
        negative: /\bnever\b|\bdon't\b|\bdo not\b/i,
        description: 'Conflicting frequency: "always" vs "never"',
    },
    {
        positive: /\brequire\b/i,
        negative: /\bforbid\b|\bprohibit\b/i,
        description: 'Conflicting policy: "require" vs "forbid"',
    },
    {
        positive: /\benable\b/i,
        negative: /\bdisable\b/i,
        description: 'Conflicting state: "enable" vs "disable"',
    },
    {
        positive: /\btrue\b/i,
        negative: /\bfalse\b/i,
        description: 'Conflicting boolean: "true" vs "false"',
    },
];
// ============================================================================
// Utility Functions
// ============================================================================
/**
 * Compute SHA-256 hash of a value
 */
function computeValueHash(value) {
    const serialized = JSON.stringify(value);
    return createHash('sha256').update(serialized).digest('hex');
}
/**
 * Stringify a value for contradiction detection
 */
function stringifyForComparison(value) {
    if (typeof value === 'string')
        return value;
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
// ============================================================================
// MemoryWriteGate
// ============================================================================
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
export class MemoryWriteGate {
    authorities = new Map();
    writeTimestamps = new Map();
    contradictionThreshold;
    defaultTtlMs;
    defaultDecayRate;
    enableContradictionTracking;
    contradictionResolutions = new Map();
    constructor(config = {}) {
        this.contradictionThreshold = config.contradictionThreshold ?? 0.5;
        this.defaultTtlMs = config.defaultTtlMs ?? null;
        this.defaultDecayRate = config.defaultDecayRate ?? 0;
        this.enableContradictionTracking = config.enableContradictionTracking ?? true;
        if (config.authorities) {
            for (const authority of config.authorities) {
                this.authorities.set(authority.agentId, authority);
            }
        }
    }
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
    evaluateWrite(authority, key, namespace, value, existingEntries) {
        const reasons = [];
        let allowed = true;
        // Step 1: Authority check
        const authorityCheck = this.checkAuthority(authority, namespace);
        if (!authorityCheck.passed) {
            allowed = false;
            reasons.push(`Authority check failed: role "${authority.role}" insufficient or namespace "${namespace}" not allowed`);
        }
        // Step 2: Rate limit check
        const rateCheck = this.checkRateLimit(authority);
        if (!rateCheck.passed) {
            allowed = false;
            reasons.push(`Rate limit exceeded: ${rateCheck.writesInWindow}/${rateCheck.limit} writes in window`);
        }
        // Step 3: Overwrite check
        const isOverwrite = existingEntries
            ? existingEntries.some((e) => e.key === key && e.namespace === namespace)
            : false;
        const overwriteCheck = {
            isOverwrite,
            allowed: isOverwrite ? authority.canOverwrite : true,
        };
        if (isOverwrite && !authority.canOverwrite) {
            allowed = false;
            reasons.push('Overwrite not permitted for this authority');
        }
        // Step 4: Contradiction detection
        let contradictions = [];
        if (this.enableContradictionTracking &&
            existingEntries &&
            existingEntries.length > 0) {
            const raw = this.detectContradictions(value, existingEntries);
            contradictions = raw.map((c) => ({
                existingKey: c.entryKey,
                description: c.description,
            }));
        }
        // Step 5: Record write timestamp if allowed
        if (allowed) {
            this.recordWrite(authority.agentId);
        }
        const reason = allowed
            ? 'Write allowed'
            : reasons.join('; ');
        return {
            allowed,
            reason,
            contradictions,
            authorityCheck,
            rateCheck,
            overwriteCheck,
        };
    }
    /**
     * Register a new authority or update an existing one
     */
    registerAuthority(authority) {
        this.authorities.set(authority.agentId, authority);
    }
    /**
     * Compute the current confidence for an entry based on decay over time.
     *
     * Uses exponential decay: confidence = initialConfidence * e^(-decayRate * ageHours)
     * where ageHours is (now - updatedAt) / 3600000
     */
    computeConfidence(entry) {
        if (entry.decayRate === 0)
            return entry.confidence;
        if (entry.decayRate >= 1)
            return 0;
        const now = Date.now();
        const ageMs = now - entry.updatedAt;
        const ageHours = ageMs / 3_600_000;
        const decayed = entry.confidence * Math.exp(-entry.decayRate * ageHours);
        return Math.max(0, Math.min(1, decayed));
    }
    /**
     * Get all entries whose TTL has been exceeded
     */
    getExpiredEntries(entries) {
        const now = Date.now();
        return entries.filter((entry) => {
            if (entry.ttlMs === null)
                return false;
            return now - entry.createdAt > entry.ttlMs;
        });
    }
    /**
     * Get entries whose decayed confidence has dropped below a threshold
     */
    getDecayedEntries(entries, threshold) {
        return entries.filter((entry) => {
            const currentConfidence = this.computeConfidence(entry);
            return currentConfidence < threshold;
        });
    }
    /**
     * Detect contradictions between a new value and existing entries.
     *
     * Uses string-based pattern matching to find conflicting statements
     * (must vs never, always vs never, require vs forbid, etc.)
     */
    detectContradictions(newValue, existingEntries) {
        const newText = stringifyForComparison(newValue);
        const contradictions = [];
        for (const entry of existingEntries) {
            const existingText = stringifyForComparison(entry.value);
            for (const pattern of CONTRADICTION_PATTERNS) {
                const newMatchesPositive = pattern.positive.test(newText) && pattern.negative.test(existingText);
                const newMatchesNegative = pattern.negative.test(newText) && pattern.positive.test(existingText);
                if (newMatchesPositive || newMatchesNegative) {
                    contradictions.push({
                        entryKey: entry.key,
                        description: pattern.description,
                    });
                    break; // Only report the first contradiction per entry
                }
            }
        }
        return contradictions;
    }
    /**
     * Mark a contradiction as resolved
     */
    resolveContradiction(entryKey, resolution) {
        this.contradictionResolutions.set(entryKey, resolution);
    }
    /**
     * Get the authority for an agent by ID
     */
    getAuthorityFor(agentId) {
        return this.authorities.get(agentId);
    }
    /**
     * Get the current rate limit status for an agent
     */
    getRateLimitStatus(agentId) {
        const authority = this.authorities.get(agentId);
        const limit = authority?.maxWritesPerMinute ?? 0;
        const now = Date.now();
        const windowMs = 60_000;
        const windowStart = now - windowMs;
        const timestamps = this.writeTimestamps.get(agentId) ?? [];
        const recentWrites = timestamps.filter((t) => t > windowStart);
        // Find the earliest write in the window to compute reset time
        const resetAt = recentWrites.length > 0
            ? recentWrites[0] + windowMs
            : now;
        return {
            writesInWindow: recentWrites.length,
            limit,
            resetAt,
        };
    }
    // ===== Accessors =====
    /** Get the default TTL in ms */
    getDefaultTtlMs() {
        return this.defaultTtlMs;
    }
    /** Get the default decay rate */
    getDefaultDecayRate() {
        return this.defaultDecayRate;
    }
    /** Check if contradiction tracking is enabled */
    isContradictionTrackingEnabled() {
        return this.enableContradictionTracking;
    }
    /** Get the contradiction resolution for an entry key */
    getContradictionResolution(entryKey) {
        return this.contradictionResolutions.get(entryKey);
    }
    // ===== Private Methods =====
    /**
     * Check whether an authority is allowed to write to a namespace
     */
    checkAuthority(authority, namespace) {
        const roleLevel = ROLE_HIERARCHY[authority.role];
        const minimumLevel = ROLE_HIERARCHY[MINIMUM_WRITE_ROLE];
        // Role check: must be at least 'worker' level
        if (roleLevel < minimumLevel) {
            return {
                passed: false,
                requiredRole: MINIMUM_WRITE_ROLE,
                actualRole: authority.role,
            };
        }
        // Namespace check: must be in allowed list, or queen can write anywhere
        if (authority.role !== 'queen' && !authority.namespaces.includes(namespace)) {
            return {
                passed: false,
                requiredRole: MINIMUM_WRITE_ROLE,
                actualRole: authority.role,
            };
        }
        return {
            passed: true,
            requiredRole: MINIMUM_WRITE_ROLE,
            actualRole: authority.role,
        };
    }
    /**
     * Check rate limit using a sliding window of write timestamps
     */
    checkRateLimit(authority) {
        const now = Date.now();
        const windowMs = 60_000;
        const windowStart = now - windowMs;
        const timestamps = this.writeTimestamps.get(authority.agentId) ?? [];
        // Prune old timestamps outside the window
        const recentWrites = timestamps.filter((t) => t > windowStart);
        this.writeTimestamps.set(authority.agentId, recentWrites);
        return {
            passed: recentWrites.length < authority.maxWritesPerMinute,
            writesInWindow: recentWrites.length,
            limit: authority.maxWritesPerMinute,
        };
    }
    /**
     * Record a write timestamp for an agent
     */
    recordWrite(agentId) {
        const timestamps = this.writeTimestamps.get(agentId) ?? [];
        timestamps.push(Date.now());
        this.writeTimestamps.set(agentId, timestamps);
    }
}
// ============================================================================
// Factory
// ============================================================================
/**
 * Create a MemoryWriteGate instance with optional configuration
 */
export function createMemoryWriteGate(config) {
    return new MemoryWriteGate(config);
}
// ============================================================================
// Helper: Create a MemoryEntry
// ============================================================================
/**
 * Create a new MemoryEntry with defaults applied
 */
export function createMemoryEntry(key, namespace, value, authority, options = {}) {
    const now = Date.now();
    return {
        key,
        namespace,
        value,
        valueHash: computeValueHash(value),
        authority,
        createdAt: now,
        updatedAt: now,
        ttlMs: options.ttlMs ?? null,
        decayRate: options.decayRate ?? 0,
        confidence: options.confidence ?? 1,
        lineage: options.lineage ?? { operation: 'create' },
        contradictions: [],
    };
}
//# sourceMappingURL=memory-gate.js.map