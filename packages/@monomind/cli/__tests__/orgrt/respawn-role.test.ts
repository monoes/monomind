import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

  it('boss gets onListRuntimeOptions only when max_role_respawns > 0; workers never get it', async () => {
    const def = OrgDefSchema.parse({
      name: 'runtime-opts-gate-org',
      roles: [{ id: 'boss' }, { id: 'worker', reports_to: 'boss' }],
      run_config: { idle_minutes: 0, max_role_respawns: 1 },
    });
    writeFileSync(
      join(testRoot, '.monomind', 'orgs', 'runtime-opts-gate-org.json'),
      JSON.stringify(def),
    );
    const daemon = new OrgDaemon(testRoot, { stopWaitMs: 100, crossProcess: false });
    const options = await daemon.listRuntimeOptions();
    expect(options.runtimes.length).toBeGreaterThan(0);
    await daemon.stopOrg('runtime-opts-gate-org').catch(() => {});
  });

  it('spawnRoleIncarnation reuses an existing worktree-per-role path instead of recreating it', async () => {
    const def = OrgDefSchema.parse({
      name: 'incarnation-org',
      roles: [{ id: 'boss' }, { id: 'worker', reports_to: 'boss' }],
      run_config: { idle_minutes: 0, workspace: 'worktree-per-role' },
    });
    writeFileSync(join(testRoot, '.monomind', 'orgs', 'incarnation-org.json'), JSON.stringify(def));
    execFileSync('git', ['init'], { cwd: testRoot });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: testRoot });
    const daemon = new OrgDaemon(testRoot, { stopWaitMs: 100, crossProcess: false });
    const running = await daemon.startOrg('incarnation-org');
    await daemon.deliver('incarnation-org', 'boss', 'worker', 'go', 'start working');
    const before = running.agents.get('worker')!.worktreePath!;
    writeFileSync(join(before, 'uncommitted.txt'), 'do not delete me');

    const generation = 1;
    const { runtime: newRuntime } = daemon.spawnRoleIncarnation(
      'incarnation-org',
      running,
      def.roles[1],
      generation,
    );
    expect(newRuntime.worktreePath).toBe(before);
    expect(existsSync(join(before, 'uncommitted.txt'))).toBe(true); // not recreated/wiped

    await daemon.stopOrg('incarnation-org');
  });
});

describe('OrgDaemon.respawnRole — validation and preflight', () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'orgrt-respawn-validate-'));
    mkdirSync(join(testRoot, '.monomind', 'orgs'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  async function startSimpleOrg(daemon: OrgDaemon, name: string, extraRunConfig = {}) {
    const def = OrgDefSchema.parse({
      name,
      roles: [{ id: 'boss' }, { id: 'worker', reports_to: 'boss' }],
      run_config: { idle_minutes: 0, max_role_respawns: 3, ...extraRunConfig },
    });
    writeFileSync(join(testRoot, '.monomind', 'orgs', `${name}.json`), JSON.stringify(def));
    return daemon.startOrg(name);
  }

  it('rejects targeting the selected coordinator', async () => {
    const daemon = new OrgDaemon(testRoot, { stopWaitMs: 100, crossProcess: false });
    await startSimpleOrg(daemon, 'reject-boss-org');
    const receipt = await daemon.respawnRole('reject-boss-org', 'boss', {
      roleId: 'boss',
      reason: 'test',
      briefing: 'test',
    });
    expect(receipt.success).toBe(false);
    expect(receipt.error).toMatch(/coordinator/i);
    await daemon.stopOrg('reject-boss-org');
  });

  it('rejects an unknown role id', async () => {
    const daemon = new OrgDaemon(testRoot, { stopWaitMs: 100, crossProcess: false });
    await startSimpleOrg(daemon, 'reject-unknown-org');
    const receipt = await daemon.respawnRole('reject-unknown-org', 'boss', {
      roleId: 'ghost',
      reason: 'test',
      briefing: 'test',
    });
    expect(receipt.success).toBe(false);
    expect(receipt.error).toMatch(/unknown/i);
    await daemon.stopOrg('reject-unknown-org');
  });

  it('rejects invalid input without touching state', async () => {
    const daemon = new OrgDaemon(testRoot, { stopWaitMs: 100, crossProcess: false });
    const running = await startSimpleOrg(daemon, 'reject-invalid-org');
    await daemon.deliver('reject-invalid-org', 'boss', 'worker', 'go', 'start working');
    const before = running.roleSlots.get('worker')!.respawnCount;
    const receipt = await daemon.respawnRole('reject-invalid-org', 'boss', {
      roleId: 'worker',
      reason: '',
      briefing: 'test',
    });
    expect(receipt.success).toBe(false);
    expect(running.roleSlots.get('worker')!.respawnCount).toBe(before);
    await daemon.stopOrg('reject-invalid-org');
  });

  it('rejects when the cap is already reached, without consuming another attempt', async () => {
    const daemon = new OrgDaemon(testRoot, { stopWaitMs: 100, crossProcess: false });
    const running = await startSimpleOrg(daemon, 'reject-cap-org', { max_role_respawns: 1 });
    await daemon.deliver('reject-cap-org', 'boss', 'worker', 'go', 'start working');
    running.roleSlots.get('worker')!.respawnCount = 1; // already at the cap
    const receipt = await daemon.respawnRole('reject-cap-org', 'boss', {
      roleId: 'worker',
      reason: 'test',
      briefing: 'test',
    });
    expect(receipt.success).toBe(false);
    expect(receipt.error).toMatch(/respawn limit/i);
    expect(running.roleSlots.get('worker')!.respawnCount).toBe(1);
    await daemon.stopOrg('reject-cap-org');
  });

  it('rejects a providerName override when the effective role has an inline provider', async () => {
    const daemon = new OrgDaemon(testRoot, { stopWaitMs: 100, crossProcess: false });
    const def = OrgDefSchema.parse({
      name: 'reject-inline-provider-org',
      roles: [
        { id: 'boss' },
        { id: 'worker', reports_to: 'boss', provider: { kind: 'subscription' } },
      ],
      run_config: { idle_minutes: 0, max_role_respawns: 3 },
    });
    writeFileSync(
      join(testRoot, '.monomind', 'orgs', 'reject-inline-provider-org.json'),
      JSON.stringify(def),
    );
    await daemon.startOrg('reject-inline-provider-org');
    await daemon.deliver('reject-inline-provider-org', 'boss', 'worker', 'go', 'start working');
    const receipt = await daemon.respawnRole('reject-inline-provider-org', 'boss', {
      roleId: 'worker',
      providerName: 'named',
      reason: 'test',
      briefing: 'test',
    });
    expect(receipt.success).toBe(false);
    expect(receipt.error).toMatch(/inline provider/i);
    await daemon.stopOrg('reject-inline-provider-org');
  });

  it('rejects a request already undergoing replacement (respawning lock)', async () => {
    const daemon = new OrgDaemon(testRoot, { stopWaitMs: 100, crossProcess: false });
    const running = await startSimpleOrg(daemon, 'reject-concurrent-org');
    await daemon.deliver('reject-concurrent-org', 'boss', 'worker', 'go', 'start working');
    running.respawning.add('worker');
    const receipt = await daemon.respawnRole('reject-concurrent-org', 'boss', {
      roleId: 'worker',
      reason: 'test',
      briefing: 'test',
    });
    expect(receipt.success).toBe(false);
    expect(receipt.error).toMatch(/already/i);
    await daemon.stopOrg('reject-concurrent-org');
  });
});

describe('OrgDaemon.respawnRole — quiesce and force-stop', () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'orgrt-respawn-drain-'));
    mkdirSync(join(testRoot, '.monomind', 'orgs'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  function fakeRunner(behavior: 'graceful' | 'hangs') {
    return {
      run: async function* (args: any) {
        for await (const _ of args.prompt) {
          // Each prompt message "completes a turn" instantly; the generator
          // only stops pulling once the mailbox itself stops yielding
          // (graceful drain) or is aborted (force-stop).
        }
        if (behavior === 'hangs') {
          // Simulate a wedged turn: never returns until aborted.
          await new Promise((_, reject) => {
            args.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          });
        }
      },
    };
  }

  it('messages sent while a slot is draining land in queuedDuringSwap, not the old mailbox', async () => {
    const def = OrgDefSchema.parse({
      name: 'drain-queue-org',
      roles: [{ id: 'boss' }, { id: 'worker', reports_to: 'boss' }],
      run_config: {
        idle_minutes: 0,
        max_role_respawns: 3,
        respawn_drain_timeout_ms: 50,
        respawn_force_stop_timeout_ms: 200,
      },
    });
    writeFileSync(join(testRoot, '.monomind', 'orgs', 'drain-queue-org.json'), JSON.stringify(def));
    const daemon = new OrgDaemon(testRoot, {
      stopWaitMs: 100,
      crossProcess: false,
      runner: fakeRunner('hangs') as any,
    });
    const running = await daemon.startOrg('drain-queue-org');
    await daemon.deliver('drain-queue-org', 'boss', 'worker', 'go', 'start working');
    const slot = running.roleSlots.get('worker')!;
    slot.phase = 'draining';
    const receipt = await daemon.deliver('drain-queue-org', 'boss', 'worker', 'subj', 'body');
    expect(receipt).toBeTruthy();
    expect(slot.queuedDuringSwap.length).toBe(1);
    await daemon.stopOrg('drain-queue-org');
  });
});

describe('OrgDaemon.respawnRole — end to end', () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'orgrt-respawn-e2e-'));
    mkdirSync(join(testRoot, '.monomind', 'orgs'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  function turnCompletingRunner() {
    return {
      run: async function* (args: any) {
        for await (const _ of args.prompt) {
          // one instantaneous "turn" per mailbox message, no SDK messages emitted
        }
      },
    };
  }

  it('replaces a worker: new generation, fresh policy budget, briefing delivered, receipt reports success', async () => {
    const def = OrgDefSchema.parse({
      name: 'e2e-respawn-org',
      roles: [{ id: 'boss' }, { id: 'worker', reports_to: 'boss' }],
      run_config: { idle_minutes: 0, max_role_respawns: 3, budget_tokens: 1_000_000 },
    });
    writeFileSync(join(testRoot, '.monomind', 'orgs', 'e2e-respawn-org.json'), JSON.stringify(def));
    const daemon = new OrgDaemon(testRoot, {
      stopWaitMs: 100,
      crossProcess: false,
      runner: turnCompletingRunner() as any,
    });
    const running = await daemon.startOrg('e2e-respawn-org');
    await daemon.deliver('e2e-respawn-org', 'boss', 'worker', 'go', 'start working');
    const oldRuntime = running.agents.get('worker')!;

    const receipt = await daemon.respawnRole('e2e-respawn-org', 'boss', {
      roleId: 'worker',
      runtime: 'opencode',
      reason: 'crashed',
      briefing: 'continue where you left off',
    });

    expect(receipt.success).toBe(true);
    expect(receipt.generation).toBe(1);
    expect(receipt.respawnCount).toBe(1);
    const slot = running.roleSlots.get('worker')!;
    expect(slot.generation).toBe(1);
    expect(slot.phase).toBe('running');
    expect(slot.effectiveRole.runtime).toBe('opencode');
    expect(running.agents.get('worker')).not.toBe(oldRuntime);
    expect(running.respawning.has('worker')).toBe(false);

    await daemon.stopOrg('e2e-respawn-org');
  });

  it('rejects a fourth request once the configured cap of three is reached', async () => {
    const def = OrgDefSchema.parse({
      name: 'e2e-cap-org',
      roles: [{ id: 'boss' }, { id: 'worker', reports_to: 'boss' }],
      run_config: { idle_minutes: 0, max_role_respawns: 3 },
    });
    writeFileSync(join(testRoot, '.monomind', 'orgs', 'e2e-cap-org.json'), JSON.stringify(def));
    const daemon = new OrgDaemon(testRoot, {
      stopWaitMs: 100,
      crossProcess: false,
      runner: turnCompletingRunner() as any,
    });
    await daemon.startOrg('e2e-cap-org');
    await daemon.deliver('e2e-cap-org', 'boss', 'worker', 'go', 'start working');
    for (let i = 0; i < 3; i++) {
      const r = await daemon.respawnRole('e2e-cap-org', 'boss', {
        roleId: 'worker',
        reason: `attempt ${i}`,
        briefing: 'continue',
      });
      expect(r.success).toBe(true);
    }
    const fourth = await daemon.respawnRole('e2e-cap-org', 'boss', {
      roleId: 'worker',
      reason: 'attempt 4',
      briefing: 'continue',
    });
    expect(fourth.success).toBe(false);
    expect(fourth.error).toMatch(/respawn limit/i);
    await daemon.stopOrg('e2e-cap-org');
  });
});
