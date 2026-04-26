/**
 * Tests for Consensus Proof + Voting Audit Log (Task 36).
 *
 * Uses vitest globals (describe, it, expect, beforeEach, afterEach, vi).
 * Temp directories via mkdtempSync / rmSync from 'fs'.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  deriveSigningKey,
  signVote,
  verifyVote,
} from '../../packages/@monomind/cli/src/consensus/vote-signer.js';
import { AuditWriter } from '../../packages/@monomind/cli/src/consensus/audit-writer.js';
import type { RecordInput } from '../../packages/@monomind/cli/src/consensus/audit-writer.js';

function makeInput(overrides: Partial<RecordInput> = {}): RecordInput {
  return {
    decisionId: overrides.decisionId ?? 'dec-1',
    swarmId: overrides.swarmId ?? 'swarm-1',
    protocol: overrides.protocol ?? 'raft',
    topic: overrides.topic ?? 'leader-election',
    decision: overrides.decision ?? { leader: 'agent-1' },
    votes: overrides.votes ?? [
      { agentId: 'agent-1', agentSlug: 'coder', vote: 'approve', votedAt: '2026-04-07T10:00:01Z' },
      { agentId: 'agent-2', agentSlug: 'tester', vote: 'approve', votedAt: '2026-04-07T10:00:02Z' },
      { agentId: 'agent-3', agentSlug: 'reviewer', vote: 'reject', votedAt: '2026-04-07T10:00:03Z' },
    ],
    quorumRequired: overrides.quorumRequired ?? 2,
    quorumThreshold: overrides.quorumThreshold ?? 0.67,
    round: overrides.round ?? 1,
    startedAt: overrides.startedAt ?? '2026-04-07T10:00:00Z',
    completedAt: overrides.completedAt ?? '2026-04-07T10:00:05Z',
    sessionSecret: overrides.sessionSecret ?? 'test-secret-key',
  };
}

describe('VoteSigner', () => {
  const swarmId = 'swarm-1';
  const secret = 'my-secret';
  const key = deriveSigningKey(swarmId, secret);

  it('deriveSigningKey is deterministic', () => {
    const key1 = deriveSigningKey(swarmId, secret);
    const key2 = deriveSigningKey(swarmId, secret);
    expect(key1.equals(key2)).toBe(true);
  });

  it('signVote produces deterministic output', () => {
    const sig1 = signVote('agent-1', 'approve', 'dec-1', key);
    const sig2 = signVote('agent-1', 'approve', 'dec-1', key);
    expect(sig1).toBe(sig2);
    expect(typeof sig1).toBe('string');
    expect(sig1.length).toBeGreaterThan(0);
  });

  it('verifyVote returns true for valid signature', () => {
    const sig = signVote('agent-1', 'approve', 'dec-1', key);
    expect(verifyVote('agent-1', 'approve', 'dec-1', sig, key)).toBe(true);
  });

  it('verifyVote returns false for tampered vote', () => {
    const sig = signVote('agent-1', 'approve', 'dec-1', key);
    expect(verifyVote('agent-1', 'reject', 'dec-1', sig, key)).toBe(false);
  });

  it('verifyVote returns false for different decisionId', () => {
    const sig = signVote('agent-1', 'approve', 'dec-1', key);
    expect(verifyVote('agent-1', 'approve', 'dec-999', sig, key)).toBe(false);
  });
});

describe('AuditWriter', () => {
  let tmpDir: string;
  let writer: AuditWriter;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'consensus-audit-test-'));
    writer = new AuditWriter(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('record() persists audit record to JSONL', () => {
    const input = makeInput();
    writer.record(input);

    const auditPath = join(tmpDir, 'consensus-audit.jsonl');
    const lines = readFileSync(auditPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);

    const record = JSON.parse(lines[0]);
    expect(record.decisionId).toBe('dec-1');
    expect(record.swarmId).toBe('swarm-1');
    expect(record.protocol).toBe('raft');
    expect(record.votes).toHaveLength(3);
  });

  it('record() persists individual votes to JSONL', () => {
    const input = makeInput();
    writer.record(input);

    const votesPath = join(tmpDir, 'consensus-votes.jsonl');
    const lines = readFileSync(votesPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(3);

    const vote = JSON.parse(lines[0]);
    expect(vote.decisionId).toBe('dec-1');
    expect(vote.agentId).toBe('agent-1');
    expect(typeof vote.signature).toBe('string');
  });

  it('quorumProof.satisfied is true when votes >= required', () => {
    const input = makeInput({ quorumRequired: 2 }); // 3 votes >= 2
    const record = writer.record(input);
    expect(record.quorumProof.satisfied).toBe(true);
    expect(record.quorumProof.achieved).toBe(3);
    expect(record.quorumProof.required).toBe(2);
    expect(record.quorumAchieved).toBe(true);
  });

  it('quorumProof.satisfied is false when votes < required', () => {
    const input = makeInput({
      quorumRequired: 5, // 3 votes < 5
      votes: [
        { agentId: 'agent-1', agentSlug: 'coder', vote: 'approve', votedAt: '2026-04-07T10:00:01Z' },
      ],
    });
    const record = writer.record(input);
    expect(record.quorumProof.satisfied).toBe(false);
    expect(record.quorumProof.achieved).toBe(1);
    expect(record.quorumAchieved).toBe(false);
  });

  it('record computes correct durationMs', () => {
    const input = makeInput({
      startedAt: '2026-04-07T10:00:00Z',
      completedAt: '2026-04-07T10:00:05Z',
    });
    const record = writer.record(input);
    expect(record.durationMs).toBe(5000);
  });

  it('listDecisions returns records for specific swarm', () => {
    writer.record(makeInput({ decisionId: 'dec-1', swarmId: 'swarm-A' }));
    writer.record(makeInput({ decisionId: 'dec-2', swarmId: 'swarm-B' }));
    writer.record(makeInput({ decisionId: 'dec-3', swarmId: 'swarm-A' }));

    const results = writer.listDecisions('swarm-A');
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.decisionId)).toEqual(['dec-1', 'dec-3']);
  });

  it('listDecisions returns all records when no swarmId', () => {
    writer.record(makeInput({ decisionId: 'dec-1', swarmId: 'swarm-A' }));
    writer.record(makeInput({ decisionId: 'dec-2', swarmId: 'swarm-B' }));

    const results = writer.listDecisions();
    expect(results).toHaveLength(2);
  });

  it('verifyDecision returns valid:true when all signatures correct', () => {
    const input = makeInput();
    writer.record(input);

    const result = writer.verifyDecision('dec-1', 'test-secret-key');
    expect(result.valid).toBe(true);
    expect(result.invalidVotes).toHaveLength(0);
  });

  it('verifyDecision identifies tampered votes', () => {
    const input = makeInput();
    writer.record(input);

    // Tamper with a vote signature in the JSONL file
    const auditPath = join(tmpDir, 'consensus-audit.jsonl');
    const content = readFileSync(auditPath, 'utf-8');
    const record = JSON.parse(content.trim());
    record.votes[1].vote = 'TAMPERED';
    writeFileSync(auditPath, JSON.stringify(record) + '\n', 'utf-8');

    const result = writer.verifyDecision('dec-1', 'test-secret-key');
    expect(result.valid).toBe(false);
    expect(result.invalidVotes).toContain('agent-2');
  });
});
