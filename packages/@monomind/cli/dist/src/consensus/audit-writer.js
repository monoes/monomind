/**
 * AuditWriter (Task 36)
 *
 * Append-only JSONL storage for consensus audit records and individual votes.
 */
import { appendFileSync, readFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { createHmac, timingSafeEqual } from 'crypto';
import { dirname, join, resolve, relative } from 'path';
import { parseJsonl } from '../utils/parse-jsonl.js';
// ─── HMAC tamper-detection helpers (private) ─────────────────────────────────
// These sign each vote entry in the audit log so verifyIntegrity() can detect
// after-the-fact edits to the JSONL file. They are log tamper-detection, not an
// inter-agent trust mechanism — all signing happens inside this one process.
/** Max depth for canonicalize() to prevent stack overflow on deeply nested objects. */
const MAX_CANONICALIZE_DEPTH = 32;
/** Cap string inputs to prevent OOM when hashing very long strings. */
const MAX_INPUT_LEN = 1024;
/** Derive a signing key from a swarmId and session secret using HMAC-SHA256. */
function deriveSigningKey(swarmId, sessionSecret) {
    return createHmac('sha256', sessionSecret.slice(0, MAX_INPUT_LEN)).update(swarmId.slice(0, MAX_INPUT_LEN)).digest();
}
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
/** Sign a vote entry, producing a hex-encoded HMAC-SHA256 signature. */
function signVote(agentId, vote, decisionId, key) {
    // Cap string fields to prevent OOM when hashing attacker-supplied inputs.
    const safeAgentId = agentId.slice(0, MAX_INPUT_LEN);
    const safeDecisionId = decisionId.slice(0, MAX_INPUT_LEN);
    const payload = JSON.stringify({ agentId: safeAgentId, vote: canonicalize(vote), decisionId: safeDecisionId });
    return createHmac('sha256', key).update(payload).digest('hex');
}
/** Verify a vote entry signature using constant-time comparison. */
function verifyVote(agentId, vote, decisionId, signature, key) {
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
export class AuditWriter {
    auditPath;
    votesPath;
    constructor(dataDir) {
        const resolved = resolve(dataDir);
        const cwd = process.cwd();
        const rel = relative(cwd, resolved);
        if (rel.startsWith('..') || resolve(rel) === resolve('/')) {
            throw new Error(`AuditWriter: dataDir must be within the working directory: ${dataDir}`);
        }
        if (!existsSync(resolved)) {
            mkdirSync(resolved, { recursive: true });
        }
        this.auditPath = join(resolved, 'consensus-audit.jsonl');
        this.votesPath = join(resolved, 'consensus-votes.jsonl');
    }
    /**
     * Record a consensus decision: sign all votes, compute quorum proof,
     * and persist both the audit record and individual votes to JSONL.
     */
    record(input) {
        // Cap string fields to prevent unbounded JSONL writes (OOM)
        const MAX_STR = 256;
        const decisionId = String(input.decisionId ?? '').slice(0, MAX_STR);
        const swarmId = String(input.swarmId ?? '').slice(0, MAX_STR);
        const topic = String(input.topic ?? '').slice(0, MAX_STR);
        const sessionSecret = String(input.sessionSecret ?? '').slice(0, MAX_STR);
        // Cap votes array to prevent JSONL record inflation
        const MAX_VOTES = 500;
        const votes = Array.isArray(input.votes) ? input.votes.slice(0, MAX_VOTES) : [];
        const key = deriveSigningKey(swarmId, sessionSecret);
        // Sign each vote
        const signedVotes = votes.map((v) => ({
            agentId: v.agentId,
            agentSlug: v.agentSlug,
            vote: v.vote,
            signature: signVote(v.agentId, v.vote, decisionId, key),
            votedAt: v.votedAt,
        }));
        // Compute quorum proof
        const achieved = signedVotes.length;
        const quorumProof = {
            required: input.quorumRequired,
            achieved,
            threshold: input.quorumThreshold,
            satisfied: achieved >= input.quorumRequired,
        };
        // Compute duration (guard against invalid date strings)
        const startMs = new Date(input.startedAt).getTime();
        const endMs = new Date(input.completedAt).getTime();
        const durationMs = isNaN(startMs) || isNaN(endMs) ? null : endMs - startMs;
        const recordWithoutSig = {
            decisionId,
            swarmId,
            protocol: input.protocol,
            topic,
            decision: input.decision,
            votes: signedVotes,
            quorumProof,
            quorumAchieved: quorumProof.satisfied,
            round: input.round,
            startedAt: input.startedAt,
            completedAt: input.completedAt,
            durationMs,
        };
        // Sign the full outer record so decision, quorumProof, and metadata are tamper-evident.
        // Previously only individual votes were signed; this extends coverage to all fields.
        const recordSignature = createHmac('sha256', key)
            .update(JSON.stringify(recordWithoutSig))
            .digest('hex');
        const record = { ...recordWithoutSig, recordSignature };
        // Persist audit record
        this.appendLine(this.auditPath, record);
        // Persist individual votes
        for (const vote of signedVotes) {
            this.appendLine(this.votesPath, { decisionId: input.decisionId, ...vote });
        }
        return record;
    }
    /**
     * List consensus decisions, optionally filtered by swarmId.
     */
    listDecisions(swarmId, limit) {
        const records = this.readLines(this.auditPath);
        const filtered = swarmId ? records.filter((r) => r.swarmId === swarmId) : records;
        // Cap at 10 000 to prevent unbounded memory return
        const effectiveLimit = limit !== undefined ? Math.min(Math.max(0, limit), 10_000) : 10_000;
        return filtered.slice(0, effectiveLimit);
    }
    /**
     * Re-verify all vote signatures in a decision.
     */
    verifyDecision(decisionId, sessionSecret) {
        const records = this.readLines(this.auditPath);
        const record = records.find((r) => r.decisionId === decisionId);
        if (!record) {
            return { valid: false, invalidVotes: [] };
        }
        const key = deriveSigningKey(record.swarmId, sessionSecret);
        const invalidVotes = [];
        for (const vote of record.votes) {
            const ok = verifyVote(vote.agentId, vote.vote, decisionId, vote.signature, key);
            if (!ok) {
                invalidVotes.push(vote.agentId);
            }
        }
        // Verify the outer record signature for tamper-evidence
        const { recordSignature, ...recordWithoutSig } = record;
        const expectedSig = createHmac('sha256', key)
            .update(JSON.stringify(recordWithoutSig))
            .digest('hex');
        const expBuf = Buffer.from(expectedSig, 'hex');
        const gotBuf = Buffer.from(typeof recordSignature === 'string' ? recordSignature : '', 'hex');
        const recordTampered = gotBuf.length !== expBuf.length || !timingSafeEqual(gotBuf, expBuf);
        return { valid: invalidVotes.length === 0 && !recordTampered, invalidVotes };
    }
    // ── helpers ──
    appendLine(filePath, data) {
        // Audit writes must be reliable — propagate errors so callers know the audit trail
        // is incomplete (silent failure defeats tamper-evidence)
        const dir = dirname(filePath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        appendFileSync(filePath, JSON.stringify(data) + '\n', 'utf-8');
    }
    readLines(filePath) {
        if (!existsSync(filePath))
            return [];
        try {
            const MAX_BYTES = 50 * 1024 * 1024;
            if (statSync(filePath).size > MAX_BYTES) {
                throw new Error(`Audit log ${filePath} exceeds 50MB — run rotation/cleanup`);
            }
            const content = readFileSync(filePath, 'utf-8');
            return parseJsonl(content);
        }
        catch {
            return [];
        }
    }
}
//# sourceMappingURL=audit-writer.js.map