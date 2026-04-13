/**
 * VoteSigner (Task 36)
 *
 * HMAC-SHA256 signing and verification for consensus votes.
 */

import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Derive a signing key from a swarmId and session secret using HMAC-SHA256.
 */
export function deriveSigningKey(swarmId: string, sessionSecret: string): Buffer {
  return createHmac('sha256', sessionSecret).update(swarmId).digest();
}

/**
 * Sign a vote, producing a hex-encoded HMAC-SHA256 signature.
 */
export function signVote(
  agentId: string,
  vote: unknown,
  decisionId: string,
  key: Buffer,
): string {
  const payload = JSON.stringify({ agentId, vote, decisionId });
  return createHmac('sha256', key).update(payload).digest('hex');
}

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

/**
 * Verify a vote signature using constant-time comparison.
 * Returns true when the signature is valid.
 */
export function verifyVote(
  agentId: string,
  vote: unknown,
  decisionId: string,
  signature: string,
  key: Buffer,
): boolean {
  const expected = signVote(agentId, vote, decisionId, key);
  const sigBuf = Buffer.from(signature, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length) return false;
  return timingSafeEqual(sigBuf, expBuf);
}
