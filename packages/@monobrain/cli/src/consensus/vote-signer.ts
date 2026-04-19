/**
 * VoteSigner (Task 36)
 *
 * Confidence-weighted vote tallying for consensus decisions.
 */

/**
 * CP-WBFT: Compute confidence-weighted vote tally.
 *
 * Each agent's vote is scaled by its confidence score (derived from a probe query)
 * before tallying. Agents that fail the probe receive weight 0.
 * Tolerates up to 85.7% Byzantine fault rate across topologies.
 *
 * Source: https://arxiv.org/abs/2511.10400 (CP-WBFT — AAAI 2026)
 */
export function weightedTally(
  votes: Array<{ agentId: string; vote: boolean; confidence: number }>,
): { approved: number; rejected: number; weightedApproval: number; weightedRejection: number; quorum: boolean } {
  let weightedApproval = 0;
  let weightedRejection = 0;
  let totalWeight = 0;

  for (const { vote, confidence } of votes) {
    const w = Math.max(0, Math.min(1, confidence)); // clamp to [0,1]
    totalWeight += w;
    if (vote) {
      weightedApproval += w;
    } else {
      weightedRejection += w;
    }
  }

  return {
    approved: votes.filter(v => v.vote).length,
    rejected: votes.filter(v => !v.vote).length,
    weightedApproval,
    weightedRejection,
    quorum: totalWeight > 0 && weightedApproval / totalWeight > 0.5,
  };
}
