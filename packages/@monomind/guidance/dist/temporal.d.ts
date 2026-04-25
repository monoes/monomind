/**
 * Temporal Assertions and Validity Windows
 *
 * Bitemporal semantics for knowledge: distinguishes *assertion time* (when
 * something was recorded) from *validity time* (when the fact is/was/will be
 * true in the real world).
 *
 * The system tracks two independent timelines:
 * - Assertion time: when the assertion was recorded and when it was retracted
 * - Validity time: when the fact becomes true (validFrom) and stops being true
 *   (validUntil)
 *
 * Every assertion carries `validFrom`, `validUntil`, `assertedAt`, and
 * `supersededBy` fields. Status is computed dynamically from the current clock
 * and the assertion's lifecycle flags (retraction, supersession, expiration).
 *
 * TemporalStore:
 * - Creates assertions with explicit validity windows
 * - Retrieves assertions active at any point in time (past, present, future)
 * - Supports supersession chains (old fact replaced by new fact)
 * - Soft-delete via retraction (preserves full history)
 * - Conflict detection: finds multiple active assertions in the same namespace
 * - Export/import for persistence
 *
 * TemporalReasoner:
 * - High-level queries: whatWasTrue, whatIsTrue, whatWillBeTrue
 * - Change detection since a given timestamp
 * - Conflict detection at a point in time
 * - Forward projection of assertion validity
 *
 * @module @monobrain/guidance/temporal
 */
/**
 * Computed lifecycle status of a temporal assertion.
 *
 * - future: the validity window has not yet opened (validFrom > now)
 * - active: the assertion is currently valid (validFrom <= now < validUntil)
 * - expired: the validity window has closed (validUntil <= now)
 * - superseded: replaced by a newer assertion
 * - retracted: explicitly withdrawn (soft-deleted, history preserved)
 */
export type TemporalStatus = 'future' | 'active' | 'expired' | 'superseded' | 'retracted';
/**
 * The temporal window describing when a fact is valid and when it was recorded.
 */
export interface ValidityWindow {
    /** Unix timestamp (ms) when the fact becomes true in the real world */
    validFrom: number;
    /** Unix timestamp (ms) when the fact stops being true, or null for indefinite */
    validUntil: number | null;
    /** Unix timestamp (ms) when the assertion was recorded in the system */
    assertedAt: number;
    /** Unix timestamp (ms) when the assertion was retracted, or null if still standing */
    retractedAt: number | null;
}
/**
 * A single temporal assertion: a claim with an explicit validity window,
 * supersession chain, confidence, and provenance metadata.
 */
export interface TemporalAssertion {
    /** Unique assertion identifier (UUID v4) */
    id: string;
    /** The claim being asserted, in natural language */
    claim: string;
    /** Namespace for grouping related assertions */
    namespace: string;
    /** The temporal validity window */
    window: ValidityWindow;
    /** Computed lifecycle status (derived from window + retraction + supersession) */
    status: TemporalStatus;
    /** ID of the assertion that replaced this one, or null */
    supersededBy: string | null;
    /** ID of the assertion that this one replaces, or null */
    supersedes: string | null;
    /** Confidence in the assertion (0.0 - 1.0) */
    confidence: number;
    /** Who or what made this assertion */
    source: string;
    /** Searchable tags */
    tags: string[];
    /** Arbitrary metadata */
    metadata: Record<string, unknown>;
}
/**
 * Query options for filtering temporal assertions.
 */
export interface TemporalQuery {
    /** Filter by namespace */
    namespace?: string;
    /** Return only assertions active at this point in time */
    pointInTime?: number;
    /** Filter by status (any match) */
    status?: TemporalStatus[];
    /** Filter by source */
    source?: string;
    /** Filter by tags (all must be present) */
    tags?: string[];
}
/**
 * Configuration for the TemporalStore.
 */
export interface TemporalConfig {
    /** Maximum number of assertions to store (default 100000) */
    maxAssertions: number;
    /** Interval (ms) for auto-expire status checks (default 60000) */
    autoExpireCheckIntervalMs: number;
}
/**
 * A full timeline for an assertion: its predecessors and successors in the
 * supersession chain.
 */
export interface TemporalTimeline {
    /** The assertion at the center of the timeline */
    assertion: TemporalAssertion;
    /** Assertions that were replaced leading up to this one (oldest first) */
    predecessors: TemporalAssertion[];
    /** Assertions that replaced this one (newest last) */
    successors: TemporalAssertion[];
}
/**
 * A detected change in the temporal store since a given timestamp.
 */
export interface TemporalChange {
    /** The assertion that changed */
    assertion: TemporalAssertion;
    /** The kind of change */
    changeType: 'asserted' | 'superseded' | 'retracted' | 'expired';
    /** When the change occurred (assertion time, retraction time, etc.) */
    changedAt: number;
}
/**
 * Optional parameters when creating a new assertion.
 */
export interface AssertOptions {
    /** Custom assertion ID (default: auto-generated UUID) */
    id?: string;
    /** Confidence in the assertion (0.0 - 1.0, default 1.0) */
    confidence?: number;
    /** Who or what is making this assertion (default 'system') */
    source?: string;
    /** Searchable tags */
    tags?: string[];
    /** Arbitrary metadata */
    metadata?: Record<string, unknown>;
}
/**
 * Serializable representation for export/import.
 */
export interface SerializedTemporalStore {
    /** All assertions */
    assertions: TemporalAssertion[];
    /** When the export was created */
    createdAt: string;
    /** Schema version */
    version: number;
}
/**
 * In-memory store for temporal assertions with bitemporal semantics.
 *
 * Assertions are indexed by ID and support supersession chains, retraction,
 * temporal queries (what was active at time T), and conflict detection.
 * Status is computed dynamically from the assertion's window and lifecycle
 * flags; callers never set status directly.
 */
export declare class TemporalStore {
    private readonly config;
    private readonly assertions;
    constructor(config?: Partial<TemporalConfig>);
    /**
     * Create a new temporal assertion.
     *
     * Records a claim with an explicit validity window. The assertion's status
     * is computed automatically from the window and the current time.
     *
     * @param claim - The fact being asserted
     * @param namespace - Grouping namespace
     * @param window - Validity window (validFrom and validUntil)
     * @param opts - Optional parameters (confidence, source, tags, metadata)
     * @returns The newly created TemporalAssertion
     */
    assert(claim: string, namespace: string, window: {
        validFrom: number;
        validUntil: number | null;
    }, opts?: AssertOptions): TemporalAssertion;
    /**
     * Retrieve an assertion by ID.
     *
     * The returned assertion has its status recomputed against the current time.
     *
     * @param id - The assertion ID
     * @returns The assertion, or undefined if not found
     */
    get(id: string): TemporalAssertion | undefined;
    /**
     * Get all assertions that were active at a specific point in time.
     *
     * An assertion is considered "active at time T" if:
     * - Its validity window contains T (validFrom <= T and (validUntil is null or T < validUntil))
     * - It has not been retracted
     * - It has not been superseded
     *
     * @param pointInTime - The reference time (ms epoch)
     * @param namespace - Optional namespace filter
     * @returns Active assertions at the specified time
     */
    getActiveAt(pointInTime: number, namespace?: string): TemporalAssertion[];
    /**
     * Get all assertions active right now.
     *
     * Convenience wrapper around `getActiveAt(Date.now())`.
     *
     * @param namespace - Optional namespace filter
     * @returns Currently active assertions
     */
    getCurrentTruth(namespace?: string): TemporalAssertion[];
    /**
     * Get the full history of a claim: all assertions (past and present) that
     * share the same claim text and namespace, regardless of status.
     *
     * Results are ordered by assertedAt ascending (oldest first), giving a
     * timeline of how the claim evolved.
     *
     * @param claim - The claim text to search for
     * @param namespace - The namespace to search in
     * @returns All matching assertions, oldest first
     */
    getHistory(claim: string, namespace: string): TemporalAssertion[];
    /**
     * Query assertions with multiple optional filters.
     *
     * All specified filters are ANDed together. Results are ordered by
     * assertedAt descending (newest first).
     *
     * @param opts - Query filter options
     * @returns Matching assertions
     */
    query(opts?: TemporalQuery): TemporalAssertion[];
    /**
     * Supersede an existing assertion with a new one.
     *
     * Marks the old assertion as superseded and creates a new assertion that
     * declares it replaces the old one. The supersession chain is bidirectional:
     * oldAssertion.supersededBy = newAssertion.id
     * newAssertion.supersedes = oldAssertion.id
     *
     * @param oldId - ID of the assertion to supersede
     * @param newClaim - The replacement claim text
     * @param newWindow - The validity window for the replacement
     * @param opts - Optional parameters for the new assertion
     * @returns The new assertion, or undefined if the old one was not found
     */
    supersede(oldId: string, newClaim: string, newWindow: {
        validFrom: number;
        validUntil: number | null;
    }, opts?: AssertOptions): TemporalAssertion | undefined;
    /**
     * Retract an assertion (soft delete).
     *
     * The assertion is marked with a retractedAt timestamp and its status
     * becomes 'retracted'. The assertion remains in the store for historical
     * queries but is excluded from active truth queries.
     *
     * @param id - The assertion to retract
     * @param _reason - Optional reason for retraction (stored in metadata)
     * @returns The retracted assertion, or undefined if not found
     */
    retract(id: string, _reason?: string): TemporalAssertion | undefined;
    /**
     * Get the full supersession timeline for an assertion.
     *
     * Follows the supersedes/supersededBy chain in both directions to build
     * the complete lineage: all predecessors (oldest first) and all successors
     * (newest last). Handles cycles by tracking visited IDs.
     *
     * @param id - The assertion to build a timeline for
     * @returns The timeline, or undefined if not found
     */
    getTimeline(id: string): TemporalTimeline | undefined;
    /**
     * Detect conflicting assertions: multiple assertions active at the same
     * time in the same namespace.
     *
     * Returns groups of assertions that are simultaneously active, which may
     * indicate contradictions that need resolution.
     *
     * @param namespace - The namespace to check
     * @param pointInTime - The reference time (defaults to now)
     * @returns Array of assertions that are concurrently active (empty if no conflicts)
     */
    reconcile(namespace: string, pointInTime?: number): TemporalAssertion[];
    /**
     * Export all assertions for persistence.
     *
     * @returns Serializable store representation
     */
    exportAssertions(): SerializedTemporalStore;
    /**
     * Import previously exported assertions, replacing all current contents.
     *
     * @param data - Serialized store data
     * @throws If the version is unsupported
     */
    importAssertions(data: SerializedTemporalStore): void;
    /**
     * Remove expired assertions whose validity ended before the given timestamp.
     *
     * Only assertions with status 'expired' and validUntil before the cutoff
     * are removed. Retracted and superseded assertions are preserved for
     * historical traceability.
     *
     * @param beforeTimestamp - Remove assertions that expired before this time
     * @returns Number of assertions pruned
     */
    pruneExpired(beforeTimestamp: number): number;
    /**
     * Get the number of stored assertions.
     */
    get size(): number;
    /**
     * Get the current configuration.
     */
    getConfig(): TemporalConfig;
    /**
     * Remove all assertions from the store.
     */
    clear(): void;
    /**
     * Enforce the maximum assertion capacity by pruning the oldest expired
     * assertions first.
     */
    private enforceCapacity;
}
/**
 * High-level temporal reasoning over a TemporalStore.
 *
 * Provides semantic queries like "what was true at time T", "what will be
 * true at time T", change detection, conflict detection, and forward
 * projection of assertion validity.
 */
export declare class TemporalReasoner {
    private readonly store;
    constructor(store: TemporalStore);
    /**
     * What was true at a past point in time?
     *
     * Returns all assertions that were active (valid, not retracted, not
     * superseded) at the specified historical moment.
     *
     * @param namespace - The namespace to query
     * @param pointInTime - The historical moment (ms epoch)
     * @returns Assertions that were active at that time
     */
    whatWasTrue(namespace: string, pointInTime: number): TemporalAssertion[];
    /**
     * What is true right now?
     *
     * Returns all currently active assertions in the given namespace.
     *
     * @param namespace - The namespace to query
     * @returns Currently active assertions
     */
    whatIsTrue(namespace: string): TemporalAssertion[];
    /**
     * What will be true at a future point in time?
     *
     * Returns assertions whose validity window includes the specified future
     * time and that have not been retracted or superseded.
     *
     * @param namespace - The namespace to query
     * @param futureTime - The future moment (ms epoch)
     * @returns Assertions that will be active at that time
     */
    whatWillBeTrue(namespace: string, futureTime: number): TemporalAssertion[];
    /**
     * Detect changes in a namespace since a given timestamp.
     *
     * Returns a list of changes ordered by their change time, including:
     * - New assertions created after the timestamp
     * - Assertions superseded after the timestamp
     * - Assertions retracted after the timestamp
     * - Assertions that expired after the timestamp
     *
     * @param namespace - The namespace to check
     * @param sinceTimestamp - Only include changes after this time (ms epoch)
     * @returns List of detected changes
     */
    hasChanged(namespace: string, sinceTimestamp: number): TemporalChange[];
    /**
     * Detect conflicting (contradictory) assertions active at the same time
     * in the same namespace.
     *
     * Returns all concurrently active assertions if there are two or more.
     * An empty array means no conflicts.
     *
     * @param namespace - The namespace to check
     * @param pointInTime - The reference time (defaults to now)
     * @returns Conflicting assertions, or empty if no conflicts
     */
    conflictsAt(namespace: string, pointInTime?: number): TemporalAssertion[];
    /**
     * Project an assertion forward: will it still be valid at a future time?
     *
     * Checks whether the assertion's validity window includes the future
     * timestamp and the assertion has not been retracted or superseded.
     *
     * @param assertionId - The assertion to project
     * @param futureTimestamp - The future time to check (ms epoch)
     * @returns true if the assertion will be active at the future time
     */
    projectForward(assertionId: string, futureTimestamp: number): boolean;
}
/**
 * Create a TemporalStore with optional configuration.
 *
 * @param config - Partial configuration; unspecified values use defaults
 * @returns A fresh TemporalStore
 */
export declare function createTemporalStore(config?: Partial<TemporalConfig>): TemporalStore;
/**
 * Create a TemporalReasoner backed by the given store.
 *
 * @param store - The TemporalStore to reason over
 * @returns A fresh TemporalReasoner
 */
export declare function createTemporalReasoner(store: TemporalStore): TemporalReasoner;
//# sourceMappingURL=temporal.d.ts.map