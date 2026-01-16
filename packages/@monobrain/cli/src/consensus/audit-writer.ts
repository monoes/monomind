/**
 * AuditWriter (Task 36)
 *
 * Append-only JSONL storage for consensus audit records and individual votes.
 */

import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { deriveSigningKey, signVote, verifyVote } from './vote-signer.js';
import type {
  ConsensusAuditRecord,
  ConsensusProtocol,
  QuorumProof,
  VoteRecord,
} from '../../../../@monobrain/shared/src/types/consensus-audit.js';

/** Input for recording a consensus decision */
export interface RecordInput {
  decisionId: string;
  swarmId: string;
  protocol: ConsensusProtocol;
  topic: string;
  decision: unknown;
  votes: Array<{ agentId: string; agentSlug: string; vote: unknown; votedAt: string }>;
  quorumRequired: number;
  quorumThreshold: number;
  round: number;
  startedAt: string;
  completedAt: string;
  sessionSecret: string;
}

export class AuditWriter {
  private readonly auditPath: string;
  private readonly votesPath: string;

  constructor(dataDir: string) {
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    this.auditPath = join(dataDir, 'consensus-audit.jsonl');
    this.votesPath = join(dataDir, 'consensus-votes.jsonl');
  }

  /**
   * Record a consensus decision: sign all votes, compute quorum proof,
   * and persist both the audit record and individual votes to JSONL.
   */
  record(input: RecordInput): ConsensusAuditRecord {
    const key = deriveSigningKey(input.swarmId, input.sessionSecret);

    // Sign each vote
    const signedVotes: VoteRecord[] = input.votes.map((v) => ({
      agentId: v.agentId,
      agentSlug: v.agentSlug,
      vote: v.vote,
      signature: signVote(v.agentId, v.vote, input.decisionId, key),
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

    // Compute duration
    const durationMs =
      new Date(input.completedAt).getTime() - new Date(input.startedAt).getTime();

    const record: ConsensusAuditRecord = {
      decisionId: input.decisionId,
      swarmId: input.swarmId,
      protocol: input.protocol,
      topic: input.topic,
      decision: input.decision,
      votes: signedVotes,
      quorumProof,
      quorumAchieved: quorumProof.satisfied,
      round: input.round,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      durationMs,
    };

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
    const records = this.readLines<ConsensusAuditRecord>(this.auditPath);
    const filtered = swarmId ? records.filter((r) => r.swarmId === swarmId) : records;
    return limit !== undefined ? filtered.slice(0, limit) : filtered;
  }

  /**
   * Re-verify all vote signatures in a decision.
   */
  verifyDecision(
    decisionId: string,
    sessionSecret: string,
  ): { valid: boolean; invalidVotes: string[] } {
    const records = this.readLines<ConsensusAuditRecord>(this.auditPath);
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

    return { valid: invalidVotes.length === 0, invalidVotes };
  }

  // ── helpers ──

  private appendLine(filePath: string, data: unknown): void {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    appendFileSync(filePath, JSON.stringify(data) + '\n', 'utf-8');
  }

  private readLines<T>(filePath: string): T[] {
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, 'utf-8').trim();
    if (!content) return [];
    return content.split('\n').map((line) => JSON.parse(line) as T);
  }
}
