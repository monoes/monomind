/**
 * Artifact Ledger - Signed, Versioned Production Outputs
 *
 * Every production output (code, reports, datasets, memory deltas) is recorded
 * in a tamper-evident ledger. Each artifact captures:
 *
 * - SHA-256 content hash for integrity verification
 * - HMAC-SHA256 signature over the artifact envelope
 * - Full lineage tracking (parent artifacts, source traces, tool calls, memory reads)
 * - Multi-dimensional search (by kind, run, cell, tags, time range)
 * - Export/import for portability and replay
 *
 * @module @monobrain/guidance/artifacts
 */
/**
 * Classification of artifact output types.
 */
export type ArtifactKind = 'code' | 'report' | 'dataset' | 'model-output' | 'memory-delta' | 'config' | 'trace-export' | 'checkpoint';
/**
 * Tracks where an artifact came from - parent artifacts, source runs,
 * tool calls, and memory reads that contributed to its creation.
 */
export interface ArtifactLineage {
    /** Artifact IDs this artifact was derived from */
    parentArtifacts: string[];
    /** Run ID that produced this artifact */
    sourceRunId: string;
    /** Proof envelope ID linking to the cryptographic evidence trail */
    sourceTraceRef: string;
    /** Tool call IDs that contributed to producing this artifact */
    toolCallIds: string[];
    /** Memory keys that were consulted during production */
    memoryReads: string[];
}
/**
 * A signed, versioned production output with full lineage.
 */
export interface Artifact {
    /** Unique artifact identifier (UUID) */
    artifactId: string;
    /** Run ID that produced this artifact */
    runId: string;
    /** Agent cell that produced this artifact */
    cellId: string;
    /** Tenant that owns this artifact */
    tenantId: string;
    /** Classification of the artifact */
    kind: ArtifactKind;
    /** Human-readable name */
    name: string;
    /** Description of what this artifact contains */
    description: string;
    /** SHA-256 hash of the content */
    contentHash: string;
    /** Size of the content in bytes */
    contentSize: number;
    /** The actual artifact data (string, object, Buffer reference, etc.) */
    content: unknown;
    /** Arbitrary metadata */
    metadata: Record<string, unknown>;
    /** Provenance chain linking this artifact to its sources */
    lineage: ArtifactLineage;
    /** HMAC-SHA256 signature of the artifact envelope */
    signature: string;
    /** Creation timestamp (epoch ms) */
    createdAt: number;
    /** Searchable tags */
    tags: string[];
}
/**
 * Result of verifying an artifact's integrity.
 */
export interface ArtifactVerification {
    /** Overall verification passed */
    verified: boolean;
    /** HMAC signature matches the envelope */
    signatureValid: boolean;
    /** Content hash matches the stored content */
    contentIntact: boolean;
    /** All parent artifacts exist in the ledger */
    lineageComplete: boolean;
    /** Timestamp of this verification */
    verifiedAt: number;
}
/**
 * Search query for filtering artifacts.
 */
export interface ArtifactSearchQuery {
    /** Filter by artifact kind */
    kind?: ArtifactKind;
    /** Filter by tags (artifact must have all specified tags) */
    tags?: string[];
    /** Filter by run ID */
    runId?: string;
    /** Filter by creation time (epoch ms, inclusive lower bound) */
    since?: number;
    /** Filter by creation time (epoch ms, inclusive upper bound) */
    until?: number;
}
/**
 * Aggregate statistics about the ledger contents.
 */
export interface ArtifactStats {
    /** Total number of artifacts stored */
    totalArtifacts: number;
    /** Count by artifact kind */
    byKind: Record<ArtifactKind, number>;
    /** Total content size across all artifacts in bytes */
    totalSize: number;
}
/**
 * Serializable ledger representation for export/import.
 */
export interface SerializedArtifactLedger {
    artifacts: Artifact[];
    createdAt: string;
    version: number;
}
/**
 * Configuration for the ArtifactLedger.
 */
export interface ArtifactLedgerConfig {
    /** HMAC signing key for artifact signatures */
    signingKey?: string;
    /** Maximum number of artifacts to store (FIFO eviction) */
    maxArtifacts?: number;
}
/**
 * Parameters for recording a new artifact.
 */
export interface RecordArtifactParams {
    /** Run ID that produced this artifact */
    runId: string;
    /** Agent cell that produced this artifact */
    cellId: string;
    /** Tenant that owns this artifact */
    tenantId: string;
    /** Classification of the artifact */
    kind: ArtifactKind;
    /** Human-readable name */
    name: string;
    /** Description of what this artifact contains */
    description: string;
    /** The actual artifact data */
    content: unknown;
    /** Arbitrary metadata */
    metadata?: Record<string, unknown>;
    /** Provenance chain */
    lineage: ArtifactLineage;
    /** Searchable tags */
    tags?: string[];
}
/**
 * A tamper-evident ledger for production artifacts.
 *
 * Every artifact is signed and content-hashed on creation. The ledger
 * supports retrieval by ID, run, kind, cell, and arbitrary search queries.
 * Full lineage traversal allows tracing any artifact back through its
 * entire ancestry chain.
 */
export declare class ArtifactLedger {
    private artifacts;
    private readonly signingKey;
    private readonly maxArtifacts;
    constructor(config?: ArtifactLedgerConfig);
    /**
     * Record a new artifact in the ledger.
     *
     * Computes the content hash, signs the envelope, and stores the artifact.
     * If the ledger exceeds maxArtifacts, the oldest artifact is evicted.
     *
     * @param params - Artifact creation parameters
     * @returns The fully signed and stored Artifact
     */
    record(params: RecordArtifactParams): Artifact;
    /**
     * Verify an artifact's signature, content integrity, and lineage completeness.
     *
     * @param artifactId - The artifact to verify
     * @returns Verification result with individual check outcomes
     */
    verify(artifactId: string): ArtifactVerification;
    /**
     * Retrieve an artifact by its ID.
     *
     * @param artifactId - The artifact to retrieve
     * @returns The artifact, or undefined if not found
     */
    get(artifactId: string): Artifact | undefined;
    /**
     * Retrieve all artifacts produced by a specific run.
     *
     * @param runId - The run ID to filter by
     * @returns Artifacts matching the run, ordered by creation time
     */
    getByRun(runId: string): Artifact[];
    /**
     * Retrieve all artifacts of a specific kind.
     *
     * @param kind - The artifact kind to filter by
     * @returns Artifacts matching the kind, ordered by creation time
     */
    getByKind(kind: ArtifactKind): Artifact[];
    /**
     * Retrieve all artifacts produced by a specific agent cell.
     *
     * @param cellId - The cell ID to filter by
     * @returns Artifacts matching the cell, ordered by creation time
     */
    getByCell(cellId: string): Artifact[];
    /**
     * Traverse the full ancestry of an artifact, depth-first.
     *
     * Returns all ancestor artifacts reachable through the lineage
     * parentArtifacts chain. Handles cycles by tracking visited IDs.
     *
     * @param artifactId - The artifact whose lineage to traverse
     * @returns All ancestor artifacts in depth-first order
     */
    getLineage(artifactId: string): Artifact[];
    /**
     * Search artifacts using a multi-dimensional query.
     *
     * All specified filters are ANDed together.
     *
     * @param query - Search criteria
     * @returns Matching artifacts ordered by creation time
     */
    search(query: ArtifactSearchQuery): Artifact[];
    /**
     * Export the entire ledger as a serializable object.
     *
     * @returns Serialized ledger data suitable for JSON.stringify
     */
    export(): SerializedArtifactLedger;
    /**
     * Import a previously exported ledger, replacing all current contents.
     *
     * @param data - Serialized ledger data
     * @throws If the version is unsupported
     */
    import(data: SerializedArtifactLedger): void;
    /**
     * Get aggregate statistics about the ledger.
     *
     * @returns Counts by kind and total content size
     */
    getStats(): ArtifactStats;
    /**
     * Produce the HMAC-SHA256 signature for an artifact.
     *
     * The signature covers every field except `signature` and `content` itself
     * (content is covered by contentHash).
     */
    private signArtifact;
    /**
     * Compute the SHA-256 hash of artifact content.
     *
     * Handles strings directly and serializes everything else to JSON.
     */
    private computeContentHash;
    /**
     * Compute the byte size of artifact content.
     */
    private computeContentSize;
    /**
     * Filter artifacts and return them sorted by creation time ascending.
     */
    private filterAndSort;
    /**
     * Evict the oldest artifact when capacity is exceeded.
     */
    private evictOldest;
}
/**
 * Create a new ArtifactLedger instance.
 *
 * @param config - Optional configuration. `signingKey` sets the HMAC key,
 *                 `maxArtifacts` sets capacity before FIFO eviction.
 * @returns A fresh ArtifactLedger
 */
export declare function createArtifactLedger(config?: ArtifactLedgerConfig): ArtifactLedger;
//# sourceMappingURL=artifacts.d.ts.map