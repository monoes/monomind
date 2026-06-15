/**
 * AuditWriter (Task 36)
 *
 * Append-only JSONL storage for consensus audit records and individual votes.
 */
import { appendFileSync, readFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { createHmac, timingSafeEqual } from 'crypto';
import { dirname, join, resolve, relative } from 'path';
import { parseJsonl } from '../utils/parse-jsonl.js';
import { deriveSigningKey, signVote, verifyVote } from './vote-signer.js';

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

export class AuditWriter {
  private readonly auditPath: string;
  private readonly votesPath: string;

  constructor(dataDir: string) {
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
  record(input: RecordInput): ConsensusAuditRecord {
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
    const signedVotes: VoteRecord[] = votes.map((v) => ({
      agentId: v.agentId,
      agentSlug: v.agentSlug,
      vote: v.vote,
      signature: signVote(v.agentId, v.vote, decisionId, key),
      votedAt: v.votedAt,
    }));

    // Compute quorum proof
    const achieved = signedVotes.length;
    const quorumProof: QuorumProof = {
      required: input.quorumRequired,
      achieved,
      threshold: input.quorumThreshold,
      satisfied: achieved >= input.quorumRequired,
    };

    // Compute duration (guard against invalid date strings)
    const startMs = new Date(input.startedAt).getTime();
    const endMs = new Date(input.completedAt).getTime();
    const durationMs = isNaN(startMs) || isNaN(endMs) ? null : endMs - startMs;

    const recordWithoutSig: ConsensusAuditRecord = {
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

    const record: ConsensusAuditRecord = { ...recordWithoutSig, recordSignature };

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
  listDecisions(swarmId?: string, limit?: number): ConsensusAuditRecord[] {
    const records = this.readLines(this.auditPath);
    const filtered = swarmId ? records.filter((r) => r.swarmId === swarmId) : records;
    // Cap at 10 000 to prevent unbounded memory return
    const effectiveLimit = limit !== undefined ? Math.min(Math.max(0, limit), 10_000) : 10_000;
    return filtered.slice(0, effectiveLimit);
  }

  /**
   * Re-verify all vote signatures in a decision.
   */
  verifyDecision(decisionId: string, sessionSecret: string): VerifyResult {
    const records = this.readLines(this.auditPath);
    const record = records.find((r) => r.decisionId === decisionId);
    if (!record) {
      return { valid: false, invalidVotes: [] };
    }
    const key = deriveSigningKey(record.swarmId, sessionSecret);
    const invalidVotes: string[] = [];
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

  private appendLine(filePath: string, data: unknown): void {
    // Audit writes must be reliable — propagate errors so callers know the audit trail
    // is incomplete (silent failure defeats tamper-evidence)
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    appendFileSync(filePath, JSON.stringify(data) + '\n', 'utf-8');
  }

  private readLines(filePath: string): ConsensusAuditRecord[] {
    if (!existsSync(filePath)) return [];
    try {
      const MAX_BYTES = 50 * 1024 * 1024;
      if (statSync(filePath).size > MAX_BYTES) {
        throw new Error(`Audit log ${filePath} exceeds 50MB — run rotation/cleanup`);
      }
      const content = readFileSync(filePath, 'utf-8');
      return parseJsonl<ConsensusAuditRecord>(content);
    } catch {
      return [];
    }
  }
}
