/** Supported consensus protocols. */
export type ConsensusProtocol = 'byzantine' | 'raft' | 'gossip' | 'crdt' | 'quorum';
/** A single signed vote cast by an agent. */
export interface VoteRecord {
    agentId: string;
    agentSlug: string;
    vote: unknown;
    signature: string;
    votedAt: string;
}
/** Proof that quorum was (or was not) achieved. */
export interface QuorumProof {
    required: number;
    achieved: number;
    threshold: number;
    satisfied: boolean;
}
/** Full audit record for a consensus decision. */
export interface ConsensusAuditRecord {
    decisionId: string;
    swarmId: string;
    protocol: ConsensusProtocol;
    topic: string;
    decision: unknown;
    votes: VoteRecord[];
    quorumProof: QuorumProof;
    quorumAchieved: boolean;
    round: number;
    startedAt: string;
    completedAt: string;
    durationMs: number | null;
    /** HMAC-SHA256 over the full record (all fields above), keyed by the session secret. */
    recordSignature?: string;
}
/** An unsigned vote supplied to {@link AuditWriter.record}. */
export type UnsignedVote = Omit<VoteRecord, 'signature'>;
/** Input to {@link AuditWriter.record}. */
export interface RecordInput {
    decisionId: string;
    swarmId: string;
    protocol: ConsensusProtocol;
    topic: string;
    decision: unknown;
    votes: UnsignedVote[];
    quorumRequired: number;
    quorumThreshold: number;
    round: number;
    startedAt: string;
    completedAt: string;
    sessionSecret: string;
}
/** Result of re-verifying a stored consensus decision. */
export interface VerifyResult {
    valid: boolean;
    invalidVotes: string[];
}
export declare class AuditWriter {
    private readonly auditPath;
    private readonly votesPath;
    constructor(dataDir: string);
    /**
     * Record a consensus decision: sign all votes, compute quorum proof,
     * and persist both the audit record and individual votes to JSONL.
     */
    record(input: RecordInput): ConsensusAuditRecord;
    /**
     * List consensus decisions, optionally filtered by swarmId.
     */
    listDecisions(swarmId?: string, limit?: number): ConsensusAuditRecord[];
    /**
     * Re-verify all vote signatures in a decision.
     */
    verifyDecision(decisionId: string, sessionSecret: string): VerifyResult;
    private appendLine;
    private readLines;
}
//# sourceMappingURL=audit-writer.d.ts.map