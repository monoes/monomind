import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';

describe('RunningOrg.roleSlots', () => {
  let testRoot: string;
  const orgName = 'respawn-slot-org';

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'orgrt-respawn-'));
    mkdirSync(join(testRoot, '.monomind', 'orgs'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('creates one RoleSlot per spawned role, generation 0, phase running, mirroring running.agents', async () => {
    const def = OrgDefSchema.parse({
      name: orgName,
      roles: [{ id: 'boss' }, { id: 'worker', reports_to: 'boss' }],
      run_config: { idle_minutes: 0 },
    });
    writeFileSync(join(testRoot, '.monomind', 'orgs', `${orgName}.json`), JSON.stringify(def));
    const daemon = new OrgDaemon(testRoot, { stopWaitMs: 100, crossProcess: false });
    const running = await daemon.startOrg(orgName);
    // 'worker' is lazy-spawned (non-boss roles start pending) - deliver a
    // message to it so both roles are actually running before asserting.
    await daemon.deliver(orgName, 'boss', 'worker', 'go', 'start working');
    expect(running.roleSlots.size).toBe(2);
    for (const roleId of ['boss', 'worker']) {
      const slot = running.roleSlots.get(roleId)!;
      expect(slot.generation).toBe(0);
      expect(slot.phase).toBe('running');
      expect(slot.respawnCount).toBe(0);
      expect(slot.retiredUsage).toEqual({ tokens: 0, costUsd: 0 });
      expect(slot.runtime).toBe(running.agents.get(roleId));
    }
    expect(running.bossRoleId).toBe('boss');
    await daemon.stopOrg(orgName);
  });
});
