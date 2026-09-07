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

  it("a stale generation's crash-retry loop does not fire a false worker-crashed notification once superseded", async () => {
    const def = OrgDefSchema.parse({
      name: 'stale-gen-org',
      roles: [{ id: 'boss' }, { id: 'worker', reports_to: 'boss' }],
      run_config: { idle_minutes: 0 },
    });
    writeFileSync(join(testRoot, '.monomind', 'orgs', 'stale-gen-org.json'), JSON.stringify(def));
    // Only throws on a specific sentinel message - an ordinary delivery is
    // consumed normally, so the worker settles into a steady running
    // session (still awaiting more input) before the crash is triggered.
    const fakeRunner = {
      run: async function* (args: any) {
        for await (const m of args.prompt) {
          if (m.message.content.includes('trigger-crash')) throw new Error('simulated crash');
        }
      },
    };
    const daemon = new OrgDaemon(testRoot, {
      stopWaitMs: 100,
      crossProcess: false,
      crashBackoffsMs: [10],
      runner: fakeRunner as any,
    });
    const running = await daemon.startOrg('stale-gen-org');
    // 'worker' is lazy-spawned - a benign delivery brings it up without
    // crashing (the fake runner only throws on the sentinel message below).
    await daemon.deliver('stale-gen-org', 'boss', 'worker', 'go', 'start working');
    await new Promise((r) => setTimeout(r, 50));
    const bossAudits: string[] = [];
    running.bus.subscribe((e) => {
      if (e.type === 'audit' && e.reason === 'worker-crashed') bossAudits.push(e.msg ?? '');
    });

    // Simulate a respawn already having bumped the slot's generation to 1
    // (the real bump happens inside respawnRole, added later) - this test
    // isolates JUST the crash-retry loop's reaction to that bump.
    const slot = running.roleSlots.get('worker')!;
    slot.generation = 1;
    // Push the sentinel so the fake runner throws - the retry loop's
    // `catch` block, and its reaction to the stale generation, is what
    // we're testing.
    running.agents.get('worker')!.mailbox.push('trigger-crash');
    await new Promise((r) => setTimeout(r, 100));

    expect(bossAudits).toHaveLength(0);
    await daemon.stopOrg('stale-gen-org');
  });
});
