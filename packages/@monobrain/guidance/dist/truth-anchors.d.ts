/**
 * Truth Anchor System
 *
 * Immutable, externally-signed facts that anchor the system to reality
 * beyond tool outputs and internal memory.
 *
 * A Truth Anchor is a fact that:
 * - Is immutable once recorded (cannot be overwritten or decayed)
 * - Is externally signed (by a human, hardware sensor, or external authority)
 * - Supersedes any internal belief that contradicts it
 * - Can be referenced but never mutated
 * - Has a verifiable signature chain
 *
 * TruthAnchorStore:
 * - Creates and signs new truth anchors with HMAC-SHA256
 * - Append-only storage (anchors are never mutated after creation)
 * - Retrieval by ID, time range, kind, attester, or tags
 * - Signature verification for individual anchors or the full store
 * - Supersession chain: new anchors can declare they supersede old ones
 * - Export/import for persistence and transfer
 * - Max 50,000 anchors with LRU eviction of expired ones only
 *
 * TruthResolver:
 * - Resolves conflicts between internal beliefs and truth anchors
 * - Memory conflict resolution (truth anchor always wins)
 * - Decision conflict resolution (constrains proposed actions)
 * - Topic-based ground truth retrieval with fuzzy tag matching
 *
 * @module @monobrain/guidance/truth-anchors
 */
/**
 * The kind of external source that attested to a truth anchor.
 */
export type TruthSourceKind = 'human-attestation' | 'hardware-signal' | 'regulatory-input' | 'external-observation' | 'signed-document' | 'consensus-result';
/**
 * An immutable, externally-signed fact anchored to the system.
 *
 * Once created, a TruthAnchor is never mutated. It can only be
 * superseded by a new anchor that references the old one.
 */
export interface TruthAnchor {
    /** Unique identifier (UUID v4) */
    id: string;
    /** The kind of external source that attested to this fact */
    kind: TruthSourceKind;
    /** The fact being asserted, in natural language */
    claim: string;
    /** Supporting data or evidence for the claim */
    evidence: string;
    /** Who or what signed this anchor (human ID, sensor ID, authority ID) */
    attesterId: string;
    /** HMAC-SHA256 signature over the canonical anchor content */
    signature: string;
    /** Unix timestamp (ms) when the anchor was created */
    timestamp: number;
    /** Unix timestamp (ms) when the fact became true */
    validFrom: number;
    /** Unix timestamp (ms) when the fact expires, or null for indefinite */
    validUntil: number | null;
    /** IDs of anchors that this anchor supersedes */
    supersedes: string[];
    /** Searchable tags for topic-based retrieval */
    tags: string[];
    /** Arbitrary metadata attached to the anchor */
    metadata: Record<string, unknown>;
}
/**
 * Configuration for the TruthAnchorStore.
 */
export interface TruthAnchorConfig {
    /** HMAC-SHA256 signing key */
    signingKey: string;
    /** Maximum number of anchors to retain (default 50,000) */
    maxAnchors: number;
}
/**
 * Parameters for creating a new truth anchor.
 */
export interface AnchorParams {
    kind: TruthSourceKind;
    claim: string;
    evidence: string;
    attesterId: string;
    validFrom?: number;
    validUntil?: number | null;
    supersedes?: string[];
    tags?: string[];
    metadata?: Record<string, unknown>;
}
/**
 * Query options for filtering truth anchors.
 */
export interface TruthAnchorQuery {
    /** Filter by source kind */
    kind?: TruthSourceKind;
    /** Filter by attester ID */
    attesterId?: string;
    /** Filter by tags (anchor must have at least one matching tag) */
    tags?: string[];
    /** Only return anchors valid at this timestamp */
    validAt?: number;
}
/**
 * Result of verifying all anchors in the store.
 */
export interface VerifyAllResult {
    /** Number of anchors with valid signatures */
    valid: number;
    /** IDs of anchors with invalid signatures */
    invalid: string[];
}
/**
 * Result of resolving a conflict between an internal belief and truth anchors.
 */
export interface ConflictResolution {
    /** Whether a truth anchor overrides the internal belief */
    truthWins: boolean;
    /** The truth anchor that overrides, if any */
    anchor?: TruthAnchor;
    /** Human-readable explanation of the resolution */
    reason: string;
}
/**
 * Append-only store for truth anchors.
 *
 * Anchors are immutable once created. The store provides signing,
 * verification, querying, supersession, and capacity management
 * with LRU eviction of expired anchors only.
 */
export declare class TruthAnchorStore {
    private readonly config;
    private readonly anchors;
    private readonly indexById;
    constructor(config?: Partial<TruthAnchorConfig>);
    /**
     * Create and sign a new truth anchor.
     *
     * The anchor is appended to the store and can never be mutated.
     * If the store exceeds capacity, expired anchors are evicted
     * starting from the oldest.
     */
    anchor(params: AnchorParams): TruthAnchor;
    /**
     * Retrieve a truth anchor by its ID.
     *
     * Returns undefined if the anchor does not exist.
     */
    get(id: string): TruthAnchor | undefined;
    /**
     * Get all anchors that are valid at the given timestamp.
     *
     * An anchor is active when:
     * - `validFrom <= timestamp`
     * - `validUntil` is null (indefinite) or `validUntil > timestamp`
     *
     * Defaults to the current time if no timestamp is provided.
     */
    getActive(timestamp?: number): TruthAnchor[];
    /**
     * Query anchors with optional filters.
     *
     * All provided filters are ANDed together. An anchor must match
     * every specified filter to be included in the result.
     */
    query(opts: TruthAnchorQuery): TruthAnchor[];
    /**
     * Verify the HMAC-SHA256 signature of a single anchor.
     *
     * Recomputes the signature from the anchor's content and compares
     * it to the stored signature. Returns true if they match.
     */
    verify(id: string): boolean;
    /**
     * Verify all anchors in the store.
     *
     * Returns a summary with the count of valid anchors and the
     * IDs of any anchors whose signatures do not match.
     */
    verifyAll(): VerifyAllResult;
    /**
     * Create a new anchor that supersedes an existing one.
     *
     * The old anchor remains in the store (immutable) but the new
     * anchor's `supersedes` array includes the old anchor's ID.
     * This creates a verifiable supersession chain.
     *
     * Throws if the old anchor ID does not exist.
     */
    supersede(oldId: string, params: AnchorParams): TruthAnchor;
    /**
     * Resolve a claim against an internal belief.
     *
     * Searches for active truth anchors whose claim matches the
     * provided claim text. If a matching truth anchor exists and
     * is currently valid, it wins over the internal belief.
     *
     * Returns the truth anchor if it exists, otherwise returns
     * undefined (meaning the internal belief stands).
     */
    resolve(claim: string, _internalBelief: string): TruthAnchor | undefined;
    /**
     * Export all anchors for persistence or transfer.
     *
     * Returns a shallow copy of the anchor array. The individual
     * anchor objects are returned as-is since they are immutable.
     */
    exportAnchors(): TruthAnchor[];
    /**
     * Import anchors from an external source.
     *
     * Imported anchors are appended to the store. Duplicate IDs
     * (anchors already in the store) are silently skipped.
     * Capacity enforcement runs after import.
     */
    importAnchors(anchors: TruthAnchor[]): void;
    /**
     * Get the total number of anchors in the store.
     */
    get size(): number;
    /**
     * Enforce the maximum anchor capacity.
     *
     * Only expired anchors are evicted, starting from the oldest.
     * If no expired anchors can be evicted and the store is still
     * over capacity, the oldest expired anchors are removed first.
     * Active (non-expired) anchors are never evicted.
     */
    private enforceCapacity;
}
/**
 * Resolves conflicts between internal system beliefs and externally
 * anchored truth.
 *
 * The fundamental principle: truth anchors always win. If a valid,
 * active truth anchor contradicts an internal belief, the anchor
 * takes precedence.
 */
export declare class TruthResolver {
    private readonly store;
    constructor(store: TruthAnchorStore);
    /**
     * Check if any active truth anchor contradicts a memory value.
     *
     * Searches by namespace and key as tags, and by the memory value
     * as a claim. If a truth anchor exists that covers the same topic,
     * it wins over the internal memory.
     */
    resolveMemoryConflict(memoryKey: string, memoryValue: string, namespace: string): ConflictResolution;
    /**
     * Check if any active truth anchor constrains a proposed action.
     *
     * Searches for anchors whose claims or tags relate to the proposed
     * action and its context. Returns a conflict resolution indicating
     * whether the action is constrained.
     */
    resolveDecisionConflict(proposedAction: string, context: Record<string, unknown>): ConflictResolution;
    /**
     * Get all active truth anchors relevant to a topic.
     *
     * Uses fuzzy tag matching: a tag matches the topic if either
     * the tag contains the topic or the topic contains the tag
     * (case-insensitive). Also matches against the claim text.
     */
    getGroundTruth(topic: string): TruthAnchor[];
}
/**
 * Create a TruthAnchorStore with the given configuration.
 *
 * @param config - Must include `signingKey`. `maxAnchors` defaults to 50,000.
 */
export declare function createTruthAnchorStore(config?: Partial<TruthAnchorConfig>): TruthAnchorStore;
/**
 * Create a TruthResolver backed by the given store.
 */
export declare function createTruthResolver(store: TruthAnchorStore): TruthResolver;
//# sourceMappingURL=truth-anchors.d.ts.map