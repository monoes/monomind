/**
 * T3 — OrgCheckpoint capture/validate/restore round-trip
 *
 * Coverage gap: checkpoint.ts is the org-runtime state machine — a bad
 * checkpoint silently loses org progress (mailbox queue, token usage,
 * session id) on resume. The original code had 0 tests; captureCheckpoint
 * and validateCheckpoint were faith claims. This test exercises the
 * actual state transfer.
 */
import { describe, expect, it } from 'vitest';
import {
  CHECKPOINT_TTL_MS,
  CHECKPOINT_VERSION,
  captureCheckpoint,
  isCheckpointExpired,
  type OrgCheckpoint,
  validateCheckpoint,
} from '../../packages/@monomind/cli/src/orgrt/checkpoint.js';

// Minimal RunningOrg stub — captureCheckpoint only touches the fields it
// reads, so we can build a tight fake instead of standing up a real daemon.
function makeFakeOrg(overrides: Record<string, unknown> = {}) {
  const agents = new Map<string, any>();
  agents.set('boss', {
    mailbox: { serialize: () => ({ queue: ['hello', 'world'] }), isClosed: false },
    policy: { usage: 1234, addUsage: () => {} },
    metrics: { costUsd: 0.42 },
    lastMessageId: 'msg-7',
    status: 'running' as const,
    error: undefined,
    scrollback: { snapshot: () => ['line A', 'line B'] },
  });
  return {
    def: { name: 'demo' },
    run: 'run-001',
    agents,
    pendingRoles: new Map([
      ['writer', {}],
      ['reviewer', {}],
    ]),
    bus: { emit: () => {} },
    ...overrides,
  } as any;
}

describe('T3 — OrgCheckpoint round-trip', () => {
  it('captureCheckpoint produces a schema-valid checkpoint', () => {
    const cp = captureCheckpoint(makeFakeOrg());
    expect(cp.version).toBe(CHECKPOINT_VERSION);
    expect(cp.status).toBe('running');
    expect(cp.run).toBe('run-001');
    expect(cp.pid).toBe(process.pid);
    expect(cp.roleState.boss).toBeDefined();
    expect(cp.roleState.boss.mailboxQueue).toEqual(['hello', 'world']);
    expect(cp.roleState.boss.tokensUsed).toBe(1234);
    expect(cp.roleState.boss.costUsd).toBeCloseTo(0.42);
    expect(cp.roleState.boss.scrollback).toEqual(['line A', 'line B']);
    expect(cp.pendingRoles).toEqual(['writer', 'reviewer']);
    expect(cp.checksum).toBeTruthy();
  });

  it('validateCheckpoint accepts an untampered capture', () => {
    const cp = captureCheckpoint(makeFakeOrg());
    expect(validateCheckpoint(cp)).toBe(true);
  });

  it('validateCheckpoint rejects a tampered roleState', () => {
    const cp = captureCheckpoint(makeFakeOrg());
    cp.roleState.boss.tokensUsed = 999_999; // bump after checksum
    expect(validateCheckpoint(cp)).toBe(false);
  });

  it('validateCheckpoint rejects a tampered pendingRoles list', () => {
    const cp = captureCheckpoint(makeFakeOrg());
    cp.pendingRoles.push('sneaky');
    expect(validateCheckpoint(cp)).toBe(false);
  });

  it('R6: validateCheckpoint rejects a checkpoint missing the version field', () => {
    const cp = captureCheckpoint(makeFakeOrg());
    const { version, ...noVersion } = cp as any;
    expect(validateCheckpoint(noVersion)).toBe(false);
  });

  it('R6: validateCheckpoint rejects an old-version checkpoint', () => {
    const cp = captureCheckpoint(makeFakeOrg());
    const old = { ...cp, version: 0 } as OrgCheckpoint;
    expect(validateCheckpoint(old)).toBe(false);
  });

  it('isCheckpointExpired returns false for a fresh checkpoint', () => {
    const cp = captureCheckpoint(makeFakeOrg());
    expect(isCheckpointExpired(cp)).toBe(false);
  });

  it('isCheckpointExpired returns true past the TTL', () => {
    const cp = captureCheckpoint(makeFakeOrg());
    // Backdate the updated timestamp beyond the TTL.
    (cp as any).updated = new Date(Date.now() - CHECKPOINT_TTL_MS - 1).toISOString();
    expect(isCheckpointExpired(cp)).toBe(true);
  });

  it('capture → serialize → parse → validate survives JSON round-trip', () => {
    const cp = captureCheckpoint(makeFakeOrg());
    const round = JSON.parse(JSON.stringify(cp)) as OrgCheckpoint;
    expect(validateCheckpoint(round)).toBe(true);
  });
});
