/**
 * Proof Envelope - Cryptographic Evidence Trail
 *
 * Makes every run auditable and tamper-evident by producing a hash-chained,
 * HMAC-signed envelope for each RunEvent. Each envelope captures:
 *
 * - SHA-256 content hash of the run event
 * - Hash chain linking to the previous envelope (genesis = '0' x 64)
 * - Individual tool call hashes
 * - Memory lineage (reads/writes with value hashes)
 * - HMAC-SHA256 signature over the entire envelope body
 *
 * @module @monobrain/guidance/proof
 */
import type { RunEvent } from './types.js';
/**
 * Record of a single tool invocation with its parameters and result.
 */
export interface ToolCallRecord {
    /** Unique call identifier */
    callId: string;
    /** Name of the tool invoked */
    toolName: string;
    /** Parameters passed to the tool */
    params: Record<string, unknown>;
    /** Result returned by the tool */
    result: unknown;
    /** Timestamp of the call (epoch ms) */
    timestamp: number;
    /** Duration of the call in milliseconds */
    durationMs: number;
}
/**
 * Record of a memory read, write, or delete operation.
 */
export interface MemoryOperation {
    /** Memory key */
    key: string;
    /** Memory namespace */
    namespace: string;
    /** Type of operation */
    operation: 'read' | 'write' | 'delete';
    /** SHA-256 hash of the value */
    valueHash: string;
    /** Timestamp of the operation (epoch ms) */
    timestamp: number;
}
/**
 * Entry in the memory lineage array stored inside a ProofEnvelope.
 */
export interface MemoryLineageEntry {
    key: string;
    namespace: string;
    operation: 'read' | 'write' | 'delete';
    hash: string;
}
/**
 * Metadata attached to every proof envelope.
 */
export interface ProofEnvelopeMetadata {
    agentId: string;
    sessionId: string;
    parentEnvelopeId?: string;
}
/**
 * A cryptographically signed, hash-chained proof envelope.
 */
export interface ProofEnvelope {
    /** Unique envelope identifier */
    envelopeId: string;
    /** Reference to the RunEvent this envelope covers */
    runEventId: string;
    /** ISO 8601 timestamp of envelope creation */
    timestamp: string;
    /** SHA-256 hash of the full RunEvent */
    contentHash: string;
    /** Hash of the previous envelope in the chain (genesis = '0'.repeat(64)) */
    previousHash: string;
    /** Map of tool call ID to SHA-256(toolName + params + result) */
    toolCallHashes: Record<string, string>;
    /** SHA-256 hash of the policy bundle used */
    guidanceHash: string;
    /** Lineage of memory operations during the run */
    memoryLineage: MemoryLineageEntry[];
    /** HMAC-SHA256 signature of the envelope content */
    signature: string;
    /** Contextual metadata */
    metadata: ProofEnvelopeMetadata;
}
/**
 * Serializable chain representation for export/import.
 */
export interface SerializedProofChain {
    envelopes: ProofEnvelope[];
    createdAt: string;
    version: number;
}
/**
 * A tamper-evident, hash-chained sequence of ProofEnvelopes.
 *
 * Each envelope links to the previous one via `previousHash`, forming
 * a blockchain-like structure. Every envelope is HMAC-signed so any
 * modification to the chain can be detected.
 */
export declare class ProofChain {
    private envelopes;
    private readonly signingKey;
    constructor(signingKey: string);
    /**
     * Append a new ProofEnvelope to the chain.
     *
     * @param runEvent - The RunEvent to wrap
     * @param toolCalls - Tool call records from the run
     * @param memoryOps - Memory operations from the run
     * @param metadata - Optional metadata overrides
     * @returns The newly created and signed ProofEnvelope
     */
    append(runEvent: RunEvent, toolCalls?: ToolCallRecord[], memoryOps?: MemoryOperation[], metadata?: Partial<ProofEnvelopeMetadata>): ProofEnvelope;
    /**
     * Verify a single envelope's HMAC signature and hash chain link.
     *
     * @returns true if the signature is valid and the previousHash is correct
     */
    verify(envelope: ProofEnvelope): boolean;
    /**
     * Verify the entire chain from genesis to tip.
     *
     * Checks that every envelope:
     * 1. Has a valid HMAC signature
     * 2. Links correctly to the previous envelope's contentHash
     *
     * @returns true if the full chain is intact
     */
    verifyChain(): boolean;
    /**
     * Retrieve an envelope by its ID.
     */
    getEnvelope(id: string): ProofEnvelope | undefined;
    /**
     * Get the most recent envelope in the chain.
     */
    getChainTip(): ProofEnvelope | undefined;
    /**
     * Get the number of envelopes in the chain.
     */
    getChainLength(): number;
    /**
     * Export the chain as a serializable object.
     */
    export(): SerializedProofChain;
    /**
     * Restore the chain from a previously exported object.
     *
     * Replaces the current chain contents entirely.
     */
    import(data: SerializedProofChain): void;
    /**
     * Compute the SHA-256 content hash of a RunEvent.
     */
    private computeContentHash;
    /**
     * Compute the SHA-256 hash of a single tool call.
     *
     * Hash = SHA-256(toolName + JSON(params) + JSON(result))
     */
    private computeToolCallHash;
    /**
     * Produce the HMAC-SHA256 signature for an envelope.
     *
     * The signature covers every field except `signature` itself.
     */
    private signEnvelope;
}
/**
 * Create a new ProofChain instance.
 *
 * @param config - Configuration with a required `signingKey` for HMAC signing.
 *   Callers that previously relied on the optional signature must now provide
 *   an explicit key (see ADR-G026).
 * @returns A fresh ProofChain
 */
export declare function createProofChain(config: {
    signingKey: string;
}): ProofChain;
//# sourceMappingURL=proof.d.ts.map