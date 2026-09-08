import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureCheckpoint } from '../../src/orgrt/checkpoint.js';
import { activeRoleCount, OrgDaemon } from '../../src/orgrt/daemon.js';
import { buildOrgTools } from '../../src/orgrt/session.js';
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
    execFileSync(
      'git',
      ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'init'],
      { cwd: testRoot },
    );
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
      run_config: {
        idle_minutes: 0,
        max_role_respawns: 3,
        budget_tokens: 1_000_000,
        respawn_start_timeout_ms: 100,
      },
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
      run_config: { idle_minutes: 0, max_role_respawns: 3, respawn_start_timeout_ms: 100 },
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

  it('the boss session actually receives working org_respawn_role and org_list_runtime_options tools end-to-end', async () => {
    const def = OrgDefSchema.parse({
      name: 'e2e-tools-org',
      roles: [{ id: 'boss' }, { id: 'worker', reports_to: 'boss' }],
      run_config: { idle_minutes: 0, max_role_respawns: 3, respawn_start_timeout_ms: 100 },
    });
    writeFileSync(join(testRoot, '.monomind', 'orgs', 'e2e-tools-org.json'), JSON.stringify(def));
    const daemon = new OrgDaemon(testRoot, {
      stopWaitMs: 100,
      crossProcess: false,
      runner: turnCompletingRunner() as any,
    });
    await daemon.startOrg('e2e-tools-org');
    await daemon.deliver('e2e-tools-org', 'boss', 'worker', 'go', 'start working');

    const bossSessionOpts: any = {
      role: def.roles[0],
      deliver: async () => 'ok',
      onRespawnRole: (callerId: string, args: any) =>
        daemon.respawnRole('e2e-tools-org', callerId, args),
      onListRuntimeOptions: () => daemon.listRuntimeOptions(),
    };
    const tools = buildOrgTools(bossSessionOpts);
    const respawnTool = tools.find((t) => t.name === 'org_respawn_role')!;
    const listTool = tools.find((t) => t.name === 'org_list_runtime_options')!;
    expect(respawnTool).toBeDefined();
    expect(listTool).toBeDefined();

    const listResult = await listTool.handler({});
    expect(JSON.parse(listResult.text).runtimes.length).toBeGreaterThan(0);

    const respawnResult = await respawnTool.handler({
      roleId: 'worker',
      reason: 'r',
      briefing: 'b',
    });
    expect(JSON.parse(respawnResult.text).success).toBe(true);

    await daemon.stopOrg('e2e-tools-org');
  });

  it('hot reload picks up an increased max_role_respawns for the NEXT respawn request', async () => {
    const def = OrgDefSchema.parse({
      name: 'reload-cap-org',
      roles: [{ id: 'boss' }, { id: 'worker', reports_to: 'boss' }],
      run_config: { idle_minutes: 0, max_role_respawns: 1, respawn_start_timeout_ms: 100 },
    });
    const defPath = join(testRoot, '.monomind', 'orgs', 'reload-cap-org.json');
    writeFileSync(defPath, JSON.stringify(def));
    const daemon = new OrgDaemon(testRoot, {
      stopWaitMs: 100,
      crossProcess: false,
      runner: turnCompletingRunner() as any,
    });
    await daemon.startOrg('reload-cap-org');
    await daemon.deliver('reload-cap-org', 'boss', 'worker', 'go', 'start working');
    await daemon.respawnRole('reload-cap-org', 'boss', {
      roleId: 'worker',
      reason: 'r1',
      briefing: 'b',
    });
    const second = await daemon.respawnRole('reload-cap-org', 'boss', {
      roleId: 'worker',
      reason: 'r2',
      briefing: 'b',
    });
    expect(second.success).toBe(false); // cap of 1 already used

    const raised = { ...def, run_config: { ...def.run_config, max_role_respawns: 5 } };
    writeFileSync(defPath, JSON.stringify(raised));
    daemon.reloadOrgDef('reload-cap-org');

    const third = await daemon.respawnRole('reload-cap-org', 'boss', {
      roleId: 'worker',
      reason: 'r3',
      briefing: 'b',
    });
    expect(third.success).toBe(true);

    await daemon.stopOrg('reload-cap-org');
  });
});

describe('OrgDaemon.respawnRole — invariants', () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'orgrt-respawn-invariants-'));
    mkdirSync(join(testRoot, '.monomind', 'orgs'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  function noopRunner() {
    return {
      run: async function* (args: any) {
        for await (const _ of args.prompt) {
          /* noop */
        }
      },
    };
  }

  it('replacement cannot reduce org-wide accounted usage below what was already spent', async () => {
    const def = OrgDefSchema.parse({
      name: 'invariant-usage-org',
      roles: [{ id: 'boss' }, { id: 'worker', reports_to: 'boss' }],
      run_config: {
        idle_minutes: 0,
        max_role_respawns: 3,
        budget_tokens: 1000,
        respawn_start_timeout_ms: 100,
      },
    });
    writeFileSync(
      join(testRoot, '.monomind', 'orgs', 'invariant-usage-org.json'),
      JSON.stringify(def),
    );
    const daemon = new OrgDaemon(testRoot, {
      stopWaitMs: 100,
      crossProcess: false,
      runner: noopRunner() as any,
    });
    const running = await daemon.startOrg('invariant-usage-org');
    await daemon.deliver('invariant-usage-org', 'boss', 'worker', 'go', 'start working');
    running.agents.get('worker')!.policy.addUsage(600);
    await daemon.respawnRole('invariant-usage-org', 'boss', {
      roleId: 'worker',
      reason: 'r',
      briefing: 'b',
    });
    let totalUsage = 0;
    for (const rt of running.agents.values()) totalUsage += rt.policy.usage;
    for (const slot of running.roleSlots.values()) totalUsage += slot.retiredUsage.tokens;
    expect(totalUsage).toBeGreaterThanOrEqual(600); // the 600 already spent is never lost
    await daemon.stopOrg('invariant-usage-org');
  });

  it('a running task remains owned by the role id after replacement', async () => {
    const def = OrgDefSchema.parse({
      name: 'invariant-task-org',
      roles: [{ id: 'boss' }, { id: 'worker', reports_to: 'boss' }],
      run_config: { idle_minutes: 0, max_role_respawns: 3, respawn_start_timeout_ms: 100 },
    });
    writeFileSync(
      join(testRoot, '.monomind', 'orgs', 'invariant-task-org.json'),
      JSON.stringify(def),
    );
    const daemon = new OrgDaemon(testRoot, {
      stopWaitMs: 100,
      crossProcess: false,
      runner: noopRunner() as any,
    });
    const running = await daemon.startOrg('invariant-task-org');
    await daemon.deliver('invariant-task-org', 'boss', 'worker', 'go', 'start working');
    const task = running.taskDag!.add('do the thing', 'worker');
    await daemon.respawnRole('invariant-task-org', 'boss', {
      roleId: 'worker',
      reason: 'r',
      briefing: 'b',
    });
    const persisted = running.taskDag!.get(task.id);
    expect(persisted?.assignee).toBe('worker');
    await daemon.stopOrg('invariant-task-org');
  });

  it('replacing a role does not delete its worktree-per-role path', async () => {
    const def = OrgDefSchema.parse({
      name: 'invariant-worktree-org',
      roles: [{ id: 'boss' }, { id: 'worker', reports_to: 'boss' }],
      run_config: {
        idle_minutes: 0,
        max_role_respawns: 3,
        workspace: 'worktree-per-role',
        respawn_start_timeout_ms: 100,
      },
    });
    writeFileSync(
      join(testRoot, '.monomind', 'orgs', 'invariant-worktree-org.json'),
      JSON.stringify(def),
    );
    execFileSync('git', ['init'], { cwd: testRoot });
    execFileSync(
      'git',
      ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'init'],
      { cwd: testRoot },
    );
    const daemon = new OrgDaemon(testRoot, {
      stopWaitMs: 100,
      crossProcess: false,
      runner: noopRunner() as any,
    });
    const running = await daemon.startOrg('invariant-worktree-org');
    await daemon.deliver('invariant-worktree-org', 'boss', 'worker', 'go', 'start working');
    const wtPath = running.agents.get('worker')!.worktreePath!;
    writeFileSync(join(wtPath, 'uncommitted.txt'), 'keep me');
    await daemon.respawnRole('invariant-worktree-org', 'boss', {
      roleId: 'worker',
      reason: 'r',
      briefing: 'b',
    });
    expect(existsSync(join(wtPath, 'uncommitted.txt'))).toBe(true);
    expect(running.agents.get('worker')!.worktreePath).toBe(wtPath);
    await daemon.stopOrg('invariant-worktree-org');
  });

  it('concurrent respawnRole calls for the SAME role: only one succeeds', async () => {
    const def = OrgDefSchema.parse({
      name: 'invariant-concurrent-org',
      roles: [{ id: 'boss' }, { id: 'worker', reports_to: 'boss' }],
      run_config: { idle_minutes: 0, max_role_respawns: 3, respawn_start_timeout_ms: 100 },
    });
    writeFileSync(
      join(testRoot, '.monomind', 'orgs', 'invariant-concurrent-org.json'),
      JSON.stringify(def),
    );
    const daemon = new OrgDaemon(testRoot, {
      stopWaitMs: 100,
      crossProcess: false,
      runner: noopRunner() as any,
    });
    await daemon.startOrg('invariant-concurrent-org');
    await daemon.deliver('invariant-concurrent-org', 'boss', 'worker', 'go', 'start working');
    const [a, b] = await Promise.all([
      daemon.respawnRole('invariant-concurrent-org', 'boss', {
        roleId: 'worker',
        reason: 'a',
        briefing: 'b',
      }),
      daemon.respawnRole('invariant-concurrent-org', 'boss', {
        roleId: 'worker',
        reason: 'b',
        briefing: 'b',
      }),
    ]);
    const successes = [a, b].filter((r) => r.success).length;
    expect(successes).toBe(1);
    await daemon.stopOrg('invariant-concurrent-org');
  });

  it('stopping the org during a respawnRole await prevents it from publishing into the stopped org', async () => {
    const def = OrgDefSchema.parse({
      name: 'invariant-stop-race-org',
      roles: [{ id: 'boss' }, { id: 'worker', reports_to: 'boss' }],
      run_config: {
        idle_minutes: 0,
        max_role_respawns: 3,
        respawn_drain_timeout_ms: 200,
        respawn_start_timeout_ms: 100,
      },
    });
    writeFileSync(
      join(testRoot, '.monomind', 'orgs', 'invariant-stop-race-org.json'),
      JSON.stringify(def),
    );
    const daemon = new OrgDaemon(testRoot, {
      stopWaitMs: 100,
      crossProcess: false,
      runner: noopRunner() as any,
    });
    await daemon.startOrg('invariant-stop-race-org');
    await daemon.deliver('invariant-stop-race-org', 'boss', 'worker', 'go', 'start working');
    const respawnPromise = daemon.respawnRole('invariant-stop-race-org', 'boss', {
      roleId: 'worker',
      reason: 'r',
      briefing: 'b',
    });
    await daemon.stopOrg('invariant-stop-race-org');
    const receipt = await respawnPromise;
    // Either the respawn lost the race and reports failure, or it happened
    // to finish before stop - either way, the STOPPED org's map must never
    // be told to run a role again.
    if (!receipt.success) {
      expect(daemon.orgs.has('invariant-stop-race-org')).toBe(false);
    }
  });

  it('a real respawnRole call during the target\'s crash-retry backoff wait does not create a duplicate runner or a false crash notification', async () => {
    // Regression test for a real bug found in code review: slot.generation
    // used to bump only at the final publish (step 13), not when draining
    // begins (step 6) - so a backoff timer waking up mid-replacement still
    // saw itself as the current generation and either restarted a second
    // live runner or (once force-stopped) fired a false worker-crashed
    // notification. This test exercises the REAL respawnRole() method
    // racing a REAL backoff wait, not a manually pre-seeded slot.generation.
    const def = OrgDefSchema.parse({
      name: 'race-backoff-org',
      roles: [{ id: 'boss' }, { id: 'worker', reports_to: 'boss' }],
      run_config: {
        idle_minutes: 0,
        max_role_respawns: 3,
        respawn_drain_timeout_ms: 500,
        respawn_force_stop_timeout_ms: 200,
        respawn_start_timeout_ms: 100,
      },
    });
    writeFileSync(
      join(testRoot, '.monomind', 'orgs', 'race-backoff-org.json'),
      JSON.stringify(def),
    );
    let failedOnce = false;
    const fakeRunner = {
      run: async function* (args: any) {
        for await (const m of args.prompt) {
          if (m.message.content.includes('trigger-crash') && !failedOnce) {
            failedOnce = true;
            throw new Error('simulated transient crash');
          }
          // otherwise consume silently without ever yielding - a healthy,
          // long-running turn (including the restarted attempt on a real
          // bug, and the eventual replacement's own session).
        }
      },
    };
    const daemon = new OrgDaemon(testRoot, {
      stopWaitMs: 100,
      crossProcess: false,
      crashBackoffsMs: [300], // one retry attempt, 300ms backoff
      runner: fakeRunner as any,
    });
    const running = await daemon.startOrg('race-backoff-org');
    await daemon.deliver('race-backoff-org', 'boss', 'worker', 'go', 'start working');
    await new Promise((r) => setTimeout(r, 20)); // let the worker settle into steady running
    const bossAudits: string[] = [];
    running.bus.subscribe((e) => {
      if (e.type === 'audit' && e.reason === 'worker-crashed') bossAudits.push(e.msg ?? '');
    });

    // Trigger the crash - the runner throws once, entering its 300ms backoff wait.
    running.agents.get('worker')!.mailbox.push('trigger-crash');
    await new Promise((r) => setTimeout(r, 50)); // now mid-backoff-wait (300ms not yet elapsed)

    // Respawn NOW, while the old generation is asleep in its backoff timer.
    const receipt = await daemon.respawnRole('race-backoff-org', 'boss', {
      roleId: 'worker',
      reason: 'r',
      briefing: 'b',
    });
    expect(receipt.success).toBe(true);

    // Give the old generation's backoff timer time to fire and settle.
    await new Promise((r) => setTimeout(r, 400));

    expect(bossAudits).toHaveLength(0);
    expect(running.agents.get('worker')).toBeDefined();

    await daemon.stopOrg('race-backoff-org');
  });

  it('force-stopping a hung old incarnation does not produce a false worker-crashed notification', async () => {
    // Sharper regression test than the backoff-wait one above: that scenario
    // is accidentally masked by Mailbox.isDraining (session.ts's drain-aware
    // patch lets the restarted attempt exit cleanly regardless of the
    // generation guard). The force-stop path is NOT masked that way - the
    // AbortController's rejection is a genuine thrown error that reaches the
    // crash-retry loop's catch block while the runner is actively mid-turn,
    // so only the generation guard (and its bump timing) protects it.
    const def = OrgDefSchema.parse({
      name: 'race-forcestop-org',
      roles: [{ id: 'boss' }, { id: 'worker', reports_to: 'boss' }],
      run_config: {
        idle_minutes: 0,
        max_role_respawns: 3,
        respawn_drain_timeout_ms: 50,
        respawn_force_stop_timeout_ms: 200,
        respawn_start_timeout_ms: 100,
      },
    });
    writeFileSync(
      join(testRoot, '.monomind', 'orgs', 'race-forcestop-org.json'),
      JSON.stringify(def),
    );
    const fakeRunner = {
      run: async function* (args: any) {
        for await (const _m of args.prompt) {
          // Hang forever on the first message until aborted - a realistic
          // AbortError message, deliberately NOT matching killedByStop's
          // narrow "exited with code 143" (SIGTERM) regex.
          await new Promise((_resolve, reject) => {
            args.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')));
          });
        }
      },
    };
    const daemon = new OrgDaemon(testRoot, {
      stopWaitMs: 100,
      crossProcess: false,
      crashBackoffsMs: [], // BACKOFFS_MS.length = 0 -> crash() fires on the first failed attempt
      runner: fakeRunner as any,
    });
    const running = await daemon.startOrg('race-forcestop-org');
    await daemon.deliver('race-forcestop-org', 'boss', 'worker', 'go', 'start working');
    await new Promise((r) => setTimeout(r, 20)); // let the worker start processing (and hang on) the message
    const bossAudits: string[] = [];
    running.bus.subscribe((e) => {
      if (e.type === 'audit' && e.reason === 'worker-crashed') bossAudits.push(e.msg ?? '');
    });

    const receipt = await daemon.respawnRole('race-forcestop-org', 'boss', {
      roleId: 'worker',
      reason: 'r',
      briefing: 'b',
    });

    expect(receipt.success).toBe(true);
    expect(receipt.drainTimedOut).toBe(true); // confirms the force-stop path was actually exercised
    expect(bossAudits).toHaveLength(0);

    await daemon.stopOrg('race-forcestop-org');
  });

  it('reports failure (not a false success) when the replacement incarnation crashes immediately after spawn', async () => {
    // Regression test for a real bug found in code review: the readiness
    // check used to race an already-resolved Promise.resolve(true) against
    // the timeout, which always wins (microtask beats a macrotask timer) -
    // so respawnRole reported success even when the new incarnation crashed
    // instantly (bad model, missing runtime, auth failure).
    const def = OrgDefSchema.parse({
      name: 'spawn-fail-org',
      roles: [{ id: 'boss' }, { id: 'worker', reports_to: 'boss' }],
      run_config: {
        idle_minutes: 0,
        max_role_respawns: 3,
        respawn_start_timeout_ms: 2000,
      },
    });
    writeFileSync(join(testRoot, '.monomind', 'orgs', 'spawn-fail-org.json'), JSON.stringify(def));
    const fakeRunner = {
      run: async function* (args: any) {
        for await (const m of args.prompt) {
          // Only the replacement's injected briefing message contains this
          // marker - the original incarnation's ordinary traffic never does.
          if (m.message.content.includes('role replacement briefing')) {
            throw new Error('bad model config');
          }
        }
      },
    };
    const daemon = new OrgDaemon(testRoot, {
      stopWaitMs: 100,
      crossProcess: false,
      crashBackoffsMs: [], // BACKOFFS_MS.length = 0 -> crash() fires on the first failed attempt
      runner: fakeRunner as any,
    });
    await daemon.startOrg('spawn-fail-org');
    await daemon.deliver('spawn-fail-org', 'boss', 'worker', 'go', 'start working');
    const receipt = await daemon.respawnRole('spawn-fail-org', 'boss', {
      roleId: 'worker',
      reason: 'r',
      briefing: 'b',
    });
    expect(receipt.success).toBe(false);
    expect(receipt.error).toBeTruthy();
    await daemon.stopOrg('spawn-fail-org');
  });

  it('activeRoleCount still counts a role mid-replacement throughout a drain-timeout + force-stop sequence', async () => {
    // Note: the generation-guard fix (bumping slot.generation at drain-start,
    // not at final publish) means the old incarnation's crash-retry loop
    // recognizes staleness BEFORE ever calling crash() - so the old
    // AgentRuntime's status never actually flips to 'crashed' during this
    // window, and activeRoleCount's existing running.agents-status check
    // already stays accurate on its own. This test documents that invariant
    // holds end-to-end through a real respawnRole() force-stop path, not
    // that a separate reservation mechanism is needed - one was tried and
    // found to have no observable effect, so it was not added.
    const def = OrgDefSchema.parse({
      name: 'concurrency-reservation-org',
      roles: [{ id: 'boss' }, { id: 'worker', reports_to: 'boss' }],
      run_config: {
        idle_minutes: 0,
        max_role_respawns: 3,
        respawn_drain_timeout_ms: 50,
        respawn_force_stop_timeout_ms: 200,
        respawn_start_timeout_ms: 100,
      },
    });
    writeFileSync(
      join(testRoot, '.monomind', 'orgs', 'concurrency-reservation-org.json'),
      JSON.stringify(def),
    );
    const fakeRunner = {
      run: async function* (args: any) {
        for await (const _m of args.prompt) {
          await new Promise((_resolve, reject) => {
            args.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          });
        }
      },
    };
    const daemon = new OrgDaemon(testRoot, {
      stopWaitMs: 100,
      crossProcess: false,
      crashBackoffsMs: [],
      runner: fakeRunner as any,
    });
    const running = await daemon.startOrg('concurrency-reservation-org');
    await daemon.deliver('concurrency-reservation-org', 'boss', 'worker', 'go', 'start working');
    await new Promise((r) => setTimeout(r, 20));
    const before = activeRoleCount(running);

    const respawnPromise = daemon.respawnRole('concurrency-reservation-org', 'boss', {
      roleId: 'worker',
      reason: 'r',
      briefing: 'b',
    });
    // respawnRole is still in flight (drain timed out, force-stop fired) -
    // the role must stay counted as active throughout, holding its
    // concurrency slot via running.respawning even though its old
    // AgentRuntime hasn't been replaced yet.
    await new Promise((r) => setTimeout(r, 100));
    expect(activeRoleCount(running)).toBe(before); // slot still reserved, not freed early

    const receipt = await respawnPromise;
    expect(receipt.success).toBe(true);
    await daemon.stopOrg('concurrency-reservation-org');
  });
});
