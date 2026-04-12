/**
 * Deterministic Tool Gateway
 *
 * Extends EnforcementGates with idempotency, schema validation,
 * and budget metering. Every tool call passes through a deterministic
 * pipeline: idempotency check -> schema validation -> budget check ->
 * enforcement gates -> allow/deny.
 *
 * @module @monobrain/guidance/gateway
 */
import { EnforcementGates } from './gates.js';
import type { GateConfig } from './types.js';
/**
 * Schema definition for a tool's parameters
 */
export interface ToolSchema {
    /** Tool name this schema applies to */
    toolName: string;
    /** Parameters that must be present */
    requiredParams: string[];
    /** Parameters that may be present */
    optionalParams: string[];
    /** Expected type for each parameter */
    paramTypes: Record<string, 'string' | 'number' | 'boolean' | 'object' | 'array'>;
    /** Maximum total serialized size of all parameters in bytes */
    maxParamSize: number;
    /** Optional whitelist of allowed values per parameter */
    allowedValues?: Record<string, unknown[]>;
}
/**
 * Multi-dimensional budget tracking
 */
export interface Budget {
    tokenBudget: {
        used: number;
        limit: number;
    };
    toolCallBudget: {
        used: number;
        limit: number;
    };
    storageBudget: {
        usedBytes: number;
        limitBytes: number;
    };
    timeBudget: {
        usedMs: number;
        limitMs: number;
    };
    costBudget: {
        usedUsd: number;
        limitUsd: number;
    };
}
/**
 * Record of a previous tool call for idempotency
 */
export interface IdempotencyRecord {
    /** SHA-256 of tool name + sorted params */
    key: string;
    /** Tool that was called */
    toolName: string;
    /** Hash of the parameters */
    paramsHash: string;
    /** Cached result from the call */
    result: unknown;
    /** When the call was recorded */
    timestamp: number;
    /** Time-to-live in milliseconds */
    ttlMs: number;
}
/**
 * Decision returned by the gateway for each tool call evaluation
 */
export interface GatewayDecision {
    /** Whether the call is allowed */
    allowed: boolean;
    /** Human-readable reason for the decision */
    reason: string;
    /** Which gate produced the decision (or 'none' if allowed) */
    gate: string;
    /** Evidence of what was checked */
    evidence: Record<string, unknown>;
    /** Whether an idempotency cache hit occurred */
    idempotencyHit: boolean;
    /** Cached result if idempotency hit */
    cachedResult?: unknown;
    /** Remaining budget after this decision */
    budgetRemaining?: Budget;
}
export interface ToolGatewayConfig {
    /** Tool schemas for validation */
    schemas?: ToolSchema[];
    /** Budget limits (partial; defaults to Infinity for unset dimensions) */
    budget?: Partial<Budget>;
    /** Default TTL for idempotency records in milliseconds */
    idempotencyTtlMs?: number;
    /** Maximum idempotency cache entries (default 10000) */
    maxCacheSize?: number;
    /** If true, evidence must be non-empty for allow decisions */
    requireEvidence?: boolean;
    /** Gate configuration passed through to EnforcementGates */
    gateConfig?: Partial<GateConfig>;
}
export declare class DeterministicToolGateway {
    private readonly gates;
    private readonly schemas;
    private budget;
    private readonly idempotencyTtlMs;
    private readonly maxCacheSize;
    private readonly requireEvidence;
    private readonly idempotencyCache;
    private lastCleanupTime;
    private static readonly CLEANUP_INTERVAL_MS;
    constructor(config?: ToolGatewayConfig);
    /**
     * Evaluate whether a tool call should be allowed.
     *
     * Pipeline:
     * 1. Check idempotency cache
     * 2. Validate params against schema
     * 3. Check budget
     * 4. Run EnforcementGates checks
     * 5. Return decision with remaining budget
     */
    evaluate(toolName: string, params: Record<string, unknown>, context?: Record<string, unknown>): GatewayDecision;
    /**
     * Record a completed tool call.
     * Updates budgets and stores the result in the idempotency cache.
     */
    recordCall(toolName: string, params: Record<string, unknown>, result: unknown, durationMs: number, tokenCount?: number): void;
    /**
     * Validate tool parameters against the registered schema.
     * Returns valid:true if no schema is registered for the tool.
     */
    validateSchema(toolName: string, params: Record<string, unknown>): {
        valid: boolean;
        errors: string[];
    };
    /**
     * Check whether all budget dimensions are within limits.
     */
    checkBudget(): {
        withinBudget: boolean;
        budgetStatus: Budget;
    };
    /**
     * Compute a deterministic idempotency key from tool name and params.
     * Uses SHA-256 of `toolName:sortedParamsJSON`.
     */
    getIdempotencyKey(toolName: string, params: Record<string, unknown>): string;
    /**
     * Reset all budget counters to zero.
     */
    resetBudget(): void;
    /**
     * Get a snapshot of the current budget.
     */
    getBudget(): Budget;
    /**
     * Get all idempotency records (including expired ones not yet cleaned).
     */
    getCallHistory(): IdempotencyRecord[];
    /**
     * Access the underlying EnforcementGates instance.
     */
    getGates(): EnforcementGates;
    /**
     * Remove expired idempotency records (batched on interval to avoid per-call overhead).
     */
    private maybeCleanExpiredIdempotency;
    /**
     * Compute a deterministic SHA-256 key from tool name and sorted params.
     */
    private computeIdempotencyKey;
    /**
     * Compute a SHA-256 hash of params only (for the IdempotencyRecord).
     */
    private computeParamsHash;
    /**
     * Recursively sort object keys for deterministic serialization.
     */
    private sortObject;
    /**
     * Determine the type string for a parameter value.
     */
    private getParamType;
    /**
     * Create a deep clone of the current budget.
     */
    private cloneBudget;
    /**
     * Merge a partial budget config with defaults.
     */
    private mergeBudget;
    private cloneDefaultBudget;
    /**
     * Find which budget dimensions have been exceeded.
     */
    private findExceededBudgets;
}
/**
 * Create a DeterministicToolGateway instance
 */
export declare function createToolGateway(config?: ToolGatewayConfig): DeterministicToolGateway;
//# sourceMappingURL=gateway.d.ts.map