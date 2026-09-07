import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureCheckpoint } from '../../src/orgrt/checkpoint.js';
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

  it('org-wide budget accounting includes retired usage from replaced incarnations', async () => {
    const def = OrgDefSchema.parse({
      name: 'retired-usage-org',
      roles: [{ id: 'boss' }, { id: 'worker', reports_to: 'boss' }],
      run_config: { idle_minutes: 0, budget_tokens: 100 },
    });
    writeFileSync(
      join(testRoot, '.monomind', 'orgs', 'retired-usage-org.json'),
      JSON.stringify(def),
    );
    const daemon = new OrgDaemon(testRoot, { stopWaitMs: 100, crossProcess: false });
    const running = await daemon.startOrg('retired-usage-org');
    await daemon.deliver('retired-usage-org', 'boss', 'worker', 'go', 'start working');
    // Simulate 90 tokens already retired from a previous incarnation of "worker".
    running.roleSlots.get('worker')!.retiredUsage.tokens = 90;
    let orgBudgetExhausted = false;
    running.bus.subscribe((e) => {
      if (e.type === 'status' && e.reason === 'org-budget-exhausted') orgBudgetExhausted = true;
    });
    // 15 more live tokens pushes the effective total (90 retired + 15 live = 105) over 100.
    running.agents.get('worker')!.policy.addUsage(15);
    running.bus.emit({ type: 'usage', from: 'worker', data: { tokens: 15 } });
    await new Promise((r) => setTimeout(r, 10));
    expect(orgBudgetExhausted).toBe(true);
    await daemon.stopOrg('retired-usage-org');
  });

  it('captureCheckpoint reflects real generation/respawnCount/retiredUsage from roleSlots', async () => {
    const def = OrgDefSchema.parse({
      name: 'capture-slot-org',
      roles: [{ id: 'boss' }, { id: 'worker', reports_to: 'boss' }],
      run_config: { idle_minutes: 0 },
    });
    writeFileSync(join(testRoot, '.monomind', 'orgs', 'capture-slot-org.json'), JSON.stringify(def));
    const daemon = new OrgDaemon(testRoot, { stopWaitMs: 100, crossProcess: false });
    const running = await daemon.startOrg('capture-slot-org');
    await daemon.deliver('capture-slot-org', 'boss', 'worker', 'go', 'start working');
    const slot = running.roleSlots.get('worker')!;
    slot.generation = 2;
    slot.respawnCount = 2;
    slot.retiredUsage = { tokens: 500, costUsd: 0.02 };
    const cp = captureCheckpoint(running);
    expect(cp.roleState.worker.generation).toBe(2);
    expect(cp.roleState.worker.respawnCount).toBe(2);
    expect(cp.roleState.worker.retiredUsage).toEqual({ tokens: 500, costUsd: 0.02 });
    await daemon.stopOrg('capture-slot-org');
  });

  it('resume seeds roleSlots generation/respawnCount/retiredUsage/effectiveRole from the checkpoint', async () => {
    const def = OrgDefSchema.parse({
      name: 'resume-slot-org',
      roles: [{ id: 'boss' }, { id: 'worker', reports_to: 'boss', adapter_config: { model: 'v1' } }],
      run_config: { idle_minutes: 0 },
    });
    writeFileSync(join(testRoot, '.monomind', 'orgs', 'resume-slot-org.json'), JSON.stringify(def));
    const daemon = new OrgDaemon(testRoot, { stopWaitMs: 100, crossProcess: false });
    let running = await daemon.startOrg('resume-slot-org');
    await daemon.deliver('resume-slot-org', 'boss', 'worker', 'go', 'start working');
    const slot = running.roleSlots.get('worker')!;
    slot.generation = 3;
    slot.respawnCount = 3;
    slot.retiredUsage = { tokens: 777, costUsd: 0.5 };
    slot.effectiveRole = { ...slot.effectiveRole, adapter_config: { model: 'v2' } };
    await daemon.stopOrg('resume-slot-org');

    running = await daemon.startOrg('resume-slot-org', undefined, { resume: true });
    const resumedSlot = running.roleSlots.get('worker')!;
    expect(resumedSlot.generation).toBe(3);
    expect(resumedSlot.respawnCount).toBe(3);
    expect(resumedSlot.retiredUsage).toEqual({ tokens: 777, costUsd: 0.5 });
    expect(resumedSlot.effectiveRole.adapter_config?.model).toBe('v2');
    await daemon.stopOrg('resume-slot-org');
  });
});
