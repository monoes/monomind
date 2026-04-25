/**
 * Consensus Audit Types (Task 36)
 *
 * Types for consensus proof, voting records, and audit logging.
 */

/** Supported consensus protocols */
export type ConsensusProtocol = 'byzantine' | 'raft' | 'gossip' | 'crdt' | 'quorum';

/** A single vote cast by an agent */
export interface VoteRecord {
  agentId: string;
  agentSlug: string;
  vote: unknown;
  signature: string;
  votedAt: string;
}

/** Proof that quorum was (or was not) achieved */
export interface QuorumProof {
  required: number;
  achieved: number;
  threshold: number;
  satisfied: boolean;
}

/** Full audit record for a consensus decision */
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
  durationMs: number;
}
