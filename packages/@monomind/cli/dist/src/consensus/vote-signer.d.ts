/**
 * VoteSigner (Task 36)
 *
 * HMAC-SHA256 signing and verification for consensus votes.
 */
/**
 * Derive a signing key from a swarmId and session secret using HMAC-SHA256.
 */
export declare function deriveSigningKey(swarmId: string, sessionSecret: string): Buffer;
export declare function signVote(agentId: string, vote: unknown, decisionId: string, key: Buffer): string;
/**
 * CP-WBFT: Compute confidence-weighted vote tally.
 *
 * Each agent's vote is scaled by its confidence score (derived from a probe query)
 * before tallying. Agents that fail the probe receive weight 0.
 * Tolerates up to 85.7% Byzantine fault rate across topologies.
 *
 * Source: https://arxiv.org/abs/2511.10400 (CP-WBFT — AAAI 2026)
 */
export declare function weightedTally(votes: Array<{
    agentId: string;
    vote: boolean;
    confidence: number;
}>): {
    approved: number;
    rejected: number;
    weightedApproval: number;
    weightedRejection: number;
    quorum: boolean;
};
/**
 * Verify a vote signature using constant-time comparison.
 * Returns true when the signature is valid.
 */
export declare function verifyVote(agentId: string, vote: unknown, decisionId: string, signature: string, key: Buffer): boolean;
//# sourceMappingURL=vote-signer.d.ts.map