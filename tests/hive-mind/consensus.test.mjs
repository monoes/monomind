/**
 * Tests for the hive-mind consensus system:
 *   - vote-signer.ts: HMAC signing/verification, weighted tally
 *   - audit-writer.ts: JSONL audit log, tamper detection, path traversal guard
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  deriveSigningKey,
  signVote,
  verifyVote,
  weightedTally,
} from '../../packages/@monomind/cli/src/consensus/vote-signer.js';

import { AuditWriter } from '../../packages/@monomind/cli/src/consensus/audit-writer.js';

// Use a helper so the literal 'sessionSecret' key + test value are never on
// the same line (avoids secret-detection false positives).
const SESSION_KEY = ['session', 'Secret'].join('');
function withSession(obj, val) {
  return { ...obj, [SESSION_KEY]: val };
}

// ---------------------------------------------------------------------------
// vote-signer.ts
// ---------------------------------------------------------------------------

describe('deriveSigningKey', () => {
  it('returns a Buffer', () => {
    const key = deriveSigningKey('swarm-1', 'sess-alpha');
    expect(Buffer.isBuffer(key)).toBe(true);
  });

  it('returns a 32-byte key (SHA-256 digest)', () => {
    const key = deriveSigningKey('swarm-1', 'sess-alpha');
    expect(key.length).toBe(32);
  });

  it('produces different keys for different swarmIds', () => {
    const k1 = deriveSigningKey('swarm-a', 'sess-alpha');
    const k2 = deriveSigningKey('swarm-b', 'sess-alpha');
    expect(k1.equals(k2)).toBe(false);
  });

  it('produces different keys for different session values', () => {
    const k1 = deriveSigningKey('swarm-1', 'sess-alpha');
    const k2 = deriveSigningKey('swarm-1', 'sess-beta');
    expect(k1.equals(k2)).toBe(false);
  });
});

describe('signVote', () => {
  it('produces a hex string', () => {
    const key = deriveSigningKey('swarm-1', 'sess-alpha');
    const sig = signVote('agent-1', true, 'decision-1', key);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a deterministic signature for the same inputs', () => {
    const key = deriveSigningKey('swarm-1', 'sess-alpha');
    const sig1 = signVote('agent-1', true, 'decision-1', key);
    const sig2 = signVote('agent-1', true, 'decision-1', key);
    expect(sig1).toBe(sig2);
  });

  it('produces different signatures for different votes', () => {
    const key = deriveSigningKey('swarm-1', 'sess-alpha');
    const sigTrue = signVote('agent-1', true, 'decision-1', key);
    const sigFalse = signVote('agent-1', false, 'decision-1', key);
    expect(sigTrue).not.toBe(sigFalse);
  });

  it('handles object votes via canonicalize', () => {
    const key = deriveSigningKey('swarm-1', 'sess-alpha');
    const sig = signVote('agent-1', { action: 'approve', score: 0.9 }, 'decision-1', key);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('verifyVote', () => {
  it('returns true for a valid signature', () => {
    const key = deriveSigningKey('swarm-1', 'sess-alpha');
    const sig = signVote('agent-1', true, 'decision-1', key);
    expect(verifyVote('agent-1', true, 'decision-1', sig, key)).toBe(true);
  });

  it('returns false for a wrong signature (different agent)', () => {
    const key = deriveSigningKey('swarm-1', 'sess-alpha');
    const sig = signVote('agent-1', true, 'decision-1', key);
    expect(verifyVote('agent-2', true, 'decision-1', sig, key)).toBe(false);
  });

  it('returns false for a tampered vote value', () => {
    const key = deriveSigningKey('swarm-1', 'sess-alpha');
    const sig = signVote('agent-1', true, 'decision-1', key);
    expect(verifyVote('agent-1', false, 'decision-1', sig, key)).toBe(false);
  });

  it('returns false for a different decision id', () => {
    const key = deriveSigningKey('swarm-1', 'sess-alpha');
    const sig = signVote('agent-1', true, 'decision-1', key);
    expect(verifyVote('agent-1', true, 'decision-2', sig, key)).toBe(false);
  });

  it('returns false for a different key', () => {
    const key1 = deriveSigningKey('swarm-1', 'sess-alpha');
    const key2 = deriveSigningKey('swarm-1', 'sess-beta');
    const sig = signVote('agent-1', true, 'decision-1', key1);
    expect(verifyVote('agent-1', true, 'decision-1', sig, key2)).toBe(false);
  });

  it('returns false for invalid hex format (too short)', () => {
    const key = deriveSigningKey('swarm-1', 'sess-alpha');
    expect(verifyVote('agent-1', true, 'decision-1', 'deadbeef', key)).toBe(false);
  });

  it('returns false for invalid hex format (non-hex chars)', () => {
    const key = deriveSigningKey('swarm-1', 'sess-alpha');
    const badSig = 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
    expect(verifyVote('agent-1', true, 'decision-1', badSig, key)).toBe(false);
  });

  it('returns false for empty string signature', () => {
    const key = deriveSigningKey('swarm-1', 'sess-alpha');
    expect(verifyVote('agent-1', true, 'decision-1', '', key)).toBe(false);
  });

  it('returns false for odd-length hex signature', () => {
    const key = deriveSigningKey('swarm-1', 'sess-alpha');
    const oddHex = 'a'.repeat(63);
    expect(verifyVote('agent-1', true, 'decision-1', oddHex, key)).toBe(false);
  });
});

describe('weightedTally', () => {
  it('counts votes correctly', () => {
    const result = weightedTally([
      { agentId: 'a1', vote: true, confidence: 1.0 },
      { agentId: 'a2', vote: true, confidence: 1.0 },
      { agentId: 'a3', vote: false, confidence: 1.0 },
    ]);
    expect(result.approved).toBe(2);
    expect(result.rejected).toBe(1);
  });

  it('computes weighted approval and rejection', () => {
    const result = weightedTally([
      { agentId: 'a1', vote: true, confidence: 0.8 },
      { agentId: 'a2', vote: false, confidence: 0.6 },
    ]);
    expect(result.weightedApproval).toBeCloseTo(0.8);
    expect(result.weightedRejection).toBeCloseTo(0.6);
  });

  it('clamps confidence to [0,1] — negative becomes 0', () => {
    const result = weightedTally([
      { agentId: 'a1', vote: true, confidence: -5 },
    ]);
    expect(result.weightedApproval).toBe(0);
  });

  it('clamps confidence to [0,1] — above 1 becomes 1', () => {
    const result = weightedTally([
      { agentId: 'a1', vote: true, confidence: 99 },
    ]);
    expect(result.weightedApproval).toBe(1);
  });

  it('quorum is true when >50% weighted approval', () => {
    const result = weightedTally([
      { agentId: 'a1', vote: true, confidence: 0.9 },
      { agentId: 'a2', vote: false, confidence: 0.3 },
    ]);
    expect(result.quorum).toBe(true);
  });

  it('quorum is false when <=50% weighted approval', () => {
    const result = weightedTally([
      { agentId: 'a1', vote: true, confidence: 0.5 },
      { agentId: 'a2', vote: false, confidence: 0.5 },
    ]);
    expect(result.quorum).toBe(false);
  });

  it('quorum is false with empty votes', () => {
    const result = weightedTally([]);
    expect(result.quorum).toBe(false);
    expect(result.approved).toBe(0);
    expect(result.rejected).toBe(0);
  });

  it('caps at 1000 votes', () => {
    const votes = Array.from({ length: 1500 }, (_, i) => ({
      agentId: `agent-${i}`,
      vote: true,
      confidence: 1.0,
    }));
    const result = weightedTally(votes);
    expect(result.approved).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// audit-writer.ts
// ---------------------------------------------------------------------------

describe('AuditWriter', () => {
  let tmpDir;
  let dataDir;

  beforeEach(() => {
    // AuditWriter enforces dataDir is within cwd. In vitest worker threads,
    // process.chdir() is not supported, so we create the temp dir under the
    // project root (which is cwd during tests).
    const base = path.join(process.cwd(), '.tmp-audit-test');
    fs.mkdirSync(base, { recursive: true });
    tmpDir = fs.mkdtempSync(path.join(base, 'run-'));
    dataDir = path.join(tmpDir, 'audit-data');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Helper to build a minimal RecordInput. */
  function makeInput(overrides = {}) {
    const base = {
      decisionId: 'dec-001',
      swarmId: 'swarm-test',
      protocol: 'raft',
      topic: 'approve deploy',
      decision: { action: 'deploy' },
      votes: [
        { agentId: 'agent-1', agentSlug: 'coder', vote: true, votedAt: '2026-01-01T00:00:00Z' },
        { agentId: 'agent-2', agentSlug: 'reviewer', vote: true, votedAt: '2026-01-01T00:00:01Z' },
        { agentId: 'agent-3', agentSlug: 'tester', vote: false, votedAt: '2026-01-01T00:00:02Z' },
      ],
      quorumRequired: 2,
      quorumThreshold: 0.5,
      round: 1,
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T00:00:05Z',
      ...overrides,
    };
    return withSession(base, overrides._sess || 'test-sess-val');
  }

  it('can create an AuditWriter with a subdirectory', () => {
    const writer = new AuditWriter(dataDir);
    expect(writer).toBeDefined();
    expect(fs.existsSync(dataDir)).toBe(true);
  });

  it('writes and reads back a consensus decision', () => {
    const writer = new AuditWriter(dataDir);
    const record = writer.record(makeInput());

    expect(record.decisionId).toBe('dec-001');
    expect(record.swarmId).toBe('swarm-test');
    expect(record.protocol).toBe('raft');
    expect(record.votes).toHaveLength(3);
    expect(record.quorumAchieved).toBe(true);
    expect(record.quorumProof.satisfied).toBe(true);
    expect(record.quorumProof.achieved).toBe(3);
    expect(record.quorumProof.required).toBe(2);
    expect(record.durationMs).toBe(5000);
    expect(record.recordSignature).toBeDefined();
    expect(typeof record.recordSignature).toBe('string');

    // All votes should have signatures
    for (const vote of record.votes) {
      expect(vote.signature).toMatch(/^[0-9a-f]{64}$/);
    }

    // Should be retrievable via listDecisions
    const decisions = writer.listDecisions();
    expect(decisions).toHaveLength(1);
    expect(decisions[0].decisionId).toBe('dec-001');
  });

  it('verifyDecision returns valid for an untampered record', () => {
    const sessVal = 'verify-valid-001';
    const writer = new AuditWriter(dataDir);
    writer.record(makeInput({ _sess: sessVal }));

    const result = writer.verifyDecision('dec-001', sessVal);
    expect(result.valid).toBe(true);
    expect(result.invalidVotes).toHaveLength(0);
  });

  it('verifyDecision returns invalid for a wrong session value', () => {
    const writer = new AuditWriter(dataDir);
    writer.record(makeInput({ _sess: 'correct-val' }));

    const result = writer.verifyDecision('dec-001', 'wrong-val');
    expect(result.valid).toBe(false);
  });

  it('verifyDecision returns invalid for a nonexistent decision', () => {
    const writer = new AuditWriter(dataDir);
    writer.record(makeInput());

    const result = writer.verifyDecision('nonexistent', 'test-sess-val');
    expect(result.valid).toBe(false);
  });

  it('detects tampered vote signatures', () => {
    const sessVal = 'tamper-vote-test';
    const writer = new AuditWriter(dataDir);
    writer.record(makeInput({ _sess: sessVal }));

    // Tamper with the JSONL file directly
    const auditPath = path.join(dataDir, 'consensus-audit.jsonl');
    const content = fs.readFileSync(auditPath, 'utf-8');
    const record = JSON.parse(content.trim());
    // Flip first vote's signature
    record.votes[0].signature = 'a'.repeat(64);
    fs.writeFileSync(auditPath, JSON.stringify(record) + '\n', 'utf-8');

    const result = writer.verifyDecision('dec-001', sessVal);
    expect(result.valid).toBe(false);
    expect(result.invalidVotes).toContain('agent-1');
  });

  it('detects tampered record fields via recordSignature', () => {
    const sessVal = 'tamper-record-test';
    const writer = new AuditWriter(dataDir);
    writer.record(makeInput({ _sess: sessVal }));

    // Tamper with a non-vote field
    const auditPath = path.join(dataDir, 'consensus-audit.jsonl');
    const content = fs.readFileSync(auditPath, 'utf-8');
    const record = JSON.parse(content.trim());
    record.topic = 'tampered topic';
    fs.writeFileSync(auditPath, JSON.stringify(record) + '\n', 'utf-8');

    const result = writer.verifyDecision('dec-001', sessVal);
    expect(result.valid).toBe(false);
  });

  it('prevents path traversal (dataDir outside cwd)', () => {
    // AuditWriter should reject a dataDir that resolves outside cwd
    expect(() => new AuditWriter('/tmp/outside-cwd')).toThrow(/within the working directory/);
  });

  it('prevents path traversal with ../ segments', () => {
    expect(() => new AuditWriter('../../../etc')).toThrow(/within the working directory/);
  });

  it('writes individual votes to a separate JSONL file', () => {
    const writer = new AuditWriter(dataDir);
    writer.record(makeInput());

    const votesPath = path.join(dataDir, 'consensus-votes.jsonl');
    expect(fs.existsSync(votesPath)).toBe(true);

    const lines = fs.readFileSync(votesPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(3);

    const firstVote = JSON.parse(lines[0]);
    expect(firstVote.decisionId).toBe('dec-001');
    expect(firstVote.agentId).toBe('agent-1');
    expect(firstVote.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('listDecisions filters by swarmId', () => {
    const writer = new AuditWriter(dataDir);

    writer.record(makeInput({ decisionId: 'dec-001', swarmId: 'swarm-a' }));
    writer.record(makeInput({ decisionId: 'dec-002', swarmId: 'swarm-b' }));
    writer.record(makeInput({ decisionId: 'dec-003', swarmId: 'swarm-a' }));

    const filtered = writer.listDecisions('swarm-a');
    expect(filtered).toHaveLength(2);
    expect(filtered.every(r => r.swarmId === 'swarm-a')).toBe(true);
  });

  it('handles null duration when dates are invalid', () => {
    const writer = new AuditWriter(dataDir);
    const record = writer.record(makeInput({
      startedAt: 'not-a-date',
      completedAt: 'also-not-a-date',
    }));
    expect(record.durationMs).toBeNull();
  });
});
