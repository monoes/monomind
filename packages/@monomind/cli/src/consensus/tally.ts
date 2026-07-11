/**
 * Confidence-weighted vote tally for multi-agent voting.
 *
 * This is plain vote counting across subagents of one process — not a
 * distributed consensus protocol. Each vote carries a confidence weight
 * in [0,1]; quorum passes when weighted approval exceeds half the total weight.
 */

/** Cap votes array to prevent OOM. */
const MAX_VOTES = 1000;

export function weightedTally(
  votes: Array<{ agentId: string; vote: boolean; confidence: number }>,
): { approved: number; rejected: number; weightedApproval: number; weightedRejection: number; quorum: boolean } {
  // Cap votes array to prevent OOM from an oversized input.
  const safeVotes = votes.length > MAX_VOTES ? votes.slice(0, MAX_VOTES) : votes;
  let weightedApproval = 0;
  let weightedRejection = 0;
  let totalWeight = 0;

  for (const { vote, confidence } of safeVotes) {
    const w = Math.max(0, Math.min(1, confidence)); // clamp to [0,1]
    totalWeight += w;
    if (vote) {
      weightedApproval += w;
    } else {
      weightedRejection += w;
    }
  }

  return {
    approved: safeVotes.filter(v => v.vote).length,
    rejected: safeVotes.filter(v => !v.vote).length,
    weightedApproval,
    weightedRejection,
    quorum: totalWeight > 0 && weightedApproval / totalWeight > 0.5,
  };
}
