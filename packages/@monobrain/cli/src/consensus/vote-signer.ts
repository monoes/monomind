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
