/**
 * AuditWriter (Task 36)
 *
 * Append-only JSONL storage for consensus audit records and individual votes.
 */
import type { ConsensusAuditRecord, ConsensusProtocol } from '../../../../@monoes/shared/src/types/consensus-audit.js';
/** Input for recording a consensus decision */
export interface RecordInput {
    decisionId: string;
    swarmId: string;
    protocol: ConsensusProtocol;
    topic: string;
    decision: unknown;
    votes: Array<{
        agentId: string;
        agentSlug: string;
        vote: unknown;
        votedAt: string;
    }>;
    quorumRequired: number;
    quorumThreshold: number;
    round: number;
    startedAt: string;
    completedAt: string;
    sessionSecret: string;
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
    verifyDecision(decisionId: string, sessionSecret: string): {
        valid: boolean;
        invalidVotes: string[];
    };
    private appendLine;
    private readLines;
}
//# sourceMappingURL=audit-writer.d.ts.map