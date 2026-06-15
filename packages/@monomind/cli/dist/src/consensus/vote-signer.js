/**
 * VoteSigner (Task 36)
 *
 * HMAC-SHA256 signing and verification for consensus votes.
 */
import { createHmac, timingSafeEqual } from 'crypto';
/** Max depth for canonicalize() to prevent stack overflow on deeply nested objects. */
const MAX_CANONICALIZE_DEPTH = 32;
/** Cap string inputs to prevent OOM when hashing very long strings. */
const MAX_INPUT_LEN = 1024;
/** Cap votes array to prevent OOM in weightedTally. */
const MAX_VOTES = 1000;
/**
 * Derive a signing key from a swarmId and session secret using HMAC-SHA256.
 */
export function deriveSigningKey(swarmId, sessionSecret) {
    return createHmac('sha256', sessionSecret.slice(0, MAX_INPUT_LEN)).update(swarmId.slice(0, MAX_INPUT_LEN)).digest();
}
/**
 * Sign a vote, producing a hex-encoded HMAC-SHA256 signature.
 */
function canonicalize(val, depth = 0) {
    // Guard against deeply-nested objects that would overflow the call stack.
    if (depth > MAX_CANONICALIZE_DEPTH)
        return '"[MaxDepth]"';
    if (val === null || typeof val !== 'object')
        return JSON.stringify(val);
    if (Array.isArray(val))
        return '[' + val.map(item => canonicalize(item, depth + 1)).join(',') + ']';
    const sorted = Object.keys(val).sort().map(k => JSON.stringify(k) + ':' + canonicalize(val[k], depth + 1));
    return '{' + sorted.join(',') + '}';
}
export function signVote(agentId, vote, decisionId, key) {
    // Cap string fields to prevent OOM when hashing attacker-supplied inputs.
    const safeAgentId = agentId.slice(0, MAX_INPUT_LEN);
    const safeDecisionId = decisionId.slice(0, MAX_INPUT_LEN);
    const payload = JSON.stringify({ agentId: safeAgentId, vote: canonicalize(vote), decisionId: safeDecisionId });
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
export function weightedTally(votes) {
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
        }
        else {
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
/**
 * Verify a vote signature using constant-time comparison.
 * Returns true when the signature is valid.
 */
export function verifyVote(agentId, vote, decisionId, signature, key) {
    // Guard: odd-length or non-hex signature string causes Buffer.from to throw.
    if (!/^[0-9a-fA-F]{64}$/.test(signature))
        return false;
    const expected = signVote(agentId, vote, decisionId, key);
    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length)
        return false;
    return timingSafeEqual(sigBuf, expBuf);
}
//# sourceMappingURL=vote-signer.js.map