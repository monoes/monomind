import { describe, it, expect } from 'vitest';
import {
  CHECKPOINT_VERSION,
  captureCheckpoint,
  generateChecksum,
  migrateCheckpoint,
  type OrgCheckpoint,
  type RoleCheckpoint,
} from '../../src/orgrt/checkpoint.js';

function v1RoleState(): Omit<
  RoleCheckpoint,
  'generation' | 'respawnCount' | 'effectiveRoleOverrides' | 'queuedDuringSwap' | 'retiredUsage'
> {
  return {
    mailboxQueue: ['hello'],
    mailboxClosed: false,
    tokensUsed: 42,
    costUsd: 0.1,
    status: 'running',
  };
}

function v1Checkpoint(): OrgCheckpoint {
  const partial = {
    version: 1,
    status: 'running' as const,
    run: 'run-1',
    pid: 123,
    updated: new Date(0).toISOString(),
    roleState: { boss: v1RoleState() as RoleCheckpoint },
    pendingRoles: [],
  };
  return { ...partial, checksum: generateChecksum(partial) };
}

describe('migrateCheckpoint', () => {
  it('returns the checkpoint unchanged when already current', () => {
    const cp = captureCheckpoint({
      def: { run_config: {} },
      run: 'r',
      agents: new Map(),
    } as any);
    expect(migrateCheckpoint(cp)).toBe(cp);
  });

  it('migrates a v1 checkpoint to CHECKPOINT_VERSION with safe respawn defaults', () => {
    const migrated = migrateCheckpoint(v1Checkpoint());
    expect(migrated).not.toBeNull();
    expect(migrated!.version).toBe(CHECKPOINT_VERSION);
    const boss = migrated!.roleState.boss;
    expect(boss.generation).toBe(0);
    expect(boss.respawnCount).toBe(0);
    expect(boss.effectiveRoleOverrides).toEqual({});
    expect(boss.queuedDuringSwap).toEqual([]);
    expect(boss.retiredUsage).toEqual({ tokens: 0, costUsd: 0 });
    // Old fields preserved verbatim.
    expect(boss.mailboxQueue).toEqual(['hello']);
    expect(boss.tokensUsed).toBe(42);
  });

  it('rejects a v1 checkpoint whose checksum does not match its own stored state', () => {
    const tampered = v1Checkpoint();
    tampered.roleState.boss.tokensUsed = 999; // mutate after checksum was computed
    expect(migrateCheckpoint(tampered)).toBeNull();
  });

  it('rejects an unknown/newer version it does not know how to migrate from', () => {
    const cp = v1Checkpoint();
    (cp as any).version = 999;
    expect(migrateCheckpoint(cp)).toBeNull();
  });
});
