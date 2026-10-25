import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import { captureCheckpoint } from '../../src/orgrt/checkpoint.js';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { roleResetCap } from '../../src/orgrt/role-reset.js';
import { buildOrgTools } from '../../src/orgrt/session.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';
import { waitUntil } from './support/section-budget-org.js';

/** The reply a session gives to a compaction request: the summary between the request's own markers. */
export const markedReply = (request: string, body: string): string => {
  const nonce = /<<<SUMMARY (\w+)>>>/.exec(request)?.[1] ?? 'missing';
  return `<<<SUMMARY ${nonce}>>>\n${body}\n<<<END SUMMARY ${nonce}>>>`;
};

/** Replies to the compaction request with `summary()`; every other message is a turn that says nothing. */
function summarizingRunner(summary: () => string | undefined) {
  return {
    run: async function* (args: any) {
      for await (const m of args.prompt) {
        if (String(m.message.content).includes('[system: context compaction]')) {
          const s = summary();
          if (s !== undefined) yield { type: 'assistant', text: markedReply(String(m.message.content), s) };
        }
        yield { type: 'result', subtype: 'success' };
      }
    },
  };
}

describe('org_compact_role / org_clear_role', () => {
  let testRoot: string;
  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'orgrt-reset-'));
    mkdirSync(join(testRoot, '.monomind', 'orgs'), { recursive: true });
  });
  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  async function start(
    runConfig: Record<string, unknown>,
    runner: unknown,
    name = 'reset-org',
    idle = true,
  ) {
    const def = OrgDefSchema.parse({
      name,
      roles: [{ id: 'boss' }, { id: 'worker', reports_to: 'boss' }],
      run_config: { idle_minutes: 0, respawn_start_timeout_ms: 100, ...runConfig },
    });
    writeFileSync(join(testRoot, '.monomind', 'orgs', `${name}.json`), JSON.stringify(def));
    const daemon = new OrgDaemon(testRoot, {
      stopWaitMs: 100,
      crossProcess: false,
      roleSummaryTimeoutMs: 400,
      runner: runner as any,
    });
    const running = await daemon.startOrg(name);
    await daemon.deliver(name, 'boss', 'worker', 'go', 'start working');
    // the worker took the message, and (unless the runner never ends a turn) finished its turn
    await waitUntil(() => {
      const m = running.agents.get('worker')?.mailbox;
      return !!m && m.consumedRealCount >= 1 && (!idle || !m.turnActive);
    });
    return { daemon, running, name, def };
  }

  it('cap: off unless max_role_resets is set above 0 (respawn settings do not turn it on)', () => {
    const rc = (o: Record<string, unknown>) => OrgDefSchema.parse({ name: 'x', roles: [{ id: 'a' }], run_config: o }).run_config;
    expect(roleResetCap(rc({}))).toBe(0);
    expect(roleResetCap(rc({ max_role_resets: 10 }))).toBe(10);
    expect(roleResetCap(rc({ max_role_resets: 0 }))).toBe(0);
    expect(roleResetCap(rc({ max_role_resets: 3 }))).toBe(3);
  });

  it('tools are listed only when the coordinator is given the callbacks', () => {
    const role: any = { id: 'boss' };
    const base = { role, deliver: async () => 'ok' } as any;
    const without = buildOrgTools(base).map((t) => t.name);
    expect(without).not.toContain('org_compact_role');
    expect(without).not.toContain('org_clear_role');
    const withCb = buildOrgTools({
      ...base,
      onCompactRole: async () => ({ success: true }),
      onClearRole: async () => ({ success: true }),
    }).map((t) => t.name);
    expect(withCb).toContain('org_compact_role');
    expect(withCb).toContain('org_clear_role');
  });

  it('compact: summary seeds the fresh session; generation bumps; respawn budget and tasks untouched', async () => {
    const seen: string[] = [];
    const runner = {
      run: async function* (args: any) {
        for await (const m of args.prompt) {
          const c = String(m.message.content);
          seen.push(c);
          if (c.includes('[system: context compaction]'))
            yield { type: 'assistant', text: markedReply(c, 'GOAL: ship it. OPEN: tests.') };
          yield { type: 'result', subtype: 'success' };
        }
      },
    };
    const { daemon, running, name } = await start({ max_role_resets: 10 }, runner);
    const task = running.taskDag!.add('do the thing', 'worker');
    const slot = running.roleSlots.get('worker')!;
    const oldRuntime = slot.runtime;
    const r = await daemon.compactRole(name, 'boss', { roleId: 'worker', reason: 'context heavy' });
    expect(r).toMatchObject({ success: true, roleId: 'worker', generation: 1 });
    expect(r.summaryChars).toBe('GOAL: ship it. OPEN: tests.'.length);
    expect(slot.runtime).not.toBe(oldRuntime);
    expect(slot.respawnCount).toBe(0);
    expect(slot.resetCount).toBe(1);
    expect(running.taskDag!.get(task.id)?.assignee).toBe('worker');
    await waitUntil(() => seen.some((c) => c.includes('compacted')));
    expect(seen.some((c) => c.includes('GOAL: ship it. OPEN: tests.') && c.includes('compacted'))).toBe(true);
    const audits: any[] = [];
    running.bus.subscribe((e) => e.type === 'audit' && audits.push(e));
    expect(captureCheckpoint(running).roleState.worker.resetCount).toBe(1);
    await daemon.stopOrg(name);
  });

  it('compact: an empty summary fails and leaves the old session in place', async () => {
    const { daemon, running, name } = await start(
      { max_role_resets: 10 },
      summarizingRunner(() => undefined),
    );
    const slot = running.roleSlots.get('worker')!;
    const oldRuntime = slot.runtime;
    const r = await daemon.compactRole(name, 'boss', { roleId: 'worker', reason: 'r' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no usable summary/);
    expect(slot.runtime).toBe(oldRuntime);
    expect(slot.generation).toBe(0);
    expect(slot.resetCount ?? 0).toBe(0);
    expect(running.respawning.has('worker')).toBe(false);
    await daemon.stopOrg(name);
  });

  it('rejects the coordinator, an unknown role, a non-coordinator caller and bad input', async () => {
    const { daemon, name } = await start({ max_role_resets: 10 }, summarizingRunner(() => 's'));
    expect((await daemon.compactRole(name, 'boss', { roleId: 'boss', reason: 'r' })).error).toMatch(/coordinator/);
    expect((await daemon.clearRole(name, 'boss', { roleId: 'boss', reason: 'r' })).error).toMatch(/coordinator/);
    expect((await daemon.clearRole(name, 'boss', { roleId: 'nope', reason: 'r' })).error).toMatch(/unknown/);
    expect((await daemon.clearRole(name, 'worker', { roleId: 'worker', reason: 'r' })).error).toMatch(/only the selected coordinator/);
    expect((await daemon.clearRole(name, 'boss', { roleId: 'worker' })).error).toMatch(/reason/);
    await daemon.stopOrg(name);
  });

  it('clear: rejected with the task ids while the role owns open tasks; allowed once they are done', async () => {
    const { daemon, running, name } = await start({ max_role_resets: 10 }, summarizingRunner(() => 's'));
    const task = running.taskDag!.add('open work', 'worker');
    const slot = running.roleSlots.get('worker')!;
    const rt = slot.runtime;
    const refused = await daemon.clearRole(name, 'boss', { roleId: 'worker', reason: 'done' });
    expect(refused.success).toBe(false);
    expect(refused.error).toContain(task.id);
    expect(slot.runtime).toBe(rt);
    running.taskDag!.complete(task.id, 'ok');
    const ok = await daemon.clearRole(name, 'boss', { roleId: 'worker', reason: 'done' });
    expect(ok).toMatchObject({ success: true, generation: 1 });
    expect(ok).not.toHaveProperty('summaryChars');
    expect(slot.runtime).not.toBe(rt);
    expect(slot.respawnCount).toBe(0);
    await daemon.stopOrg(name);
  });

  it('clear keeps queued messages for the fresh session', async () => {
    const seen: string[] = [];
    const runner = {
      run: async function* (args: any) {
        for await (const m of args.prompt) {
          seen.push(String(m.message.content));
          yield { type: 'result', subtype: 'success' };
        }
      },
    };
    const { daemon, running, name } = await start({ max_role_resets: 10 }, runner);
    const slot = running.roleSlots.get('worker')!;
    const r = await daemon.clearRole(name, 'boss', { roleId: 'worker', reason: 'fresh' });
    expect(r.success).toBe(true);
    expect(slot.queuedDuringSwap).toEqual([]);
    await daemon.deliver(name, 'boss', 'worker', 'next', 'after the clear');
    await waitUntil(() => seen.some((c) => c.includes('after the clear')));
    expect(seen.some((c) => c.includes('after the clear'))).toBe(true);
    await daemon.stopOrg(name);
  });

  it('rejects while the role has a turn running', async () => {
    const runner = {
      run: async function* (args: any) {
        for await (const _ of args.prompt) {
          yield { type: 'assistant', text: 'working' }; // no result: the turn stays live
          await new Promise(() => {});
        }
      },
    };
    const { daemon, running, name } = await start({ max_role_resets: 10 }, runner, 'reset-org', false);
    const slot = running.roleSlots.get('worker')!;
    expect(slot.runtime!.mailbox.turnActive).toBe(true);
    const r = await daemon.clearRole(name, 'boss', { roleId: 'worker', reason: 'r' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/turn running/);
    await daemon.stopOrg(name);
  });

  it('per-role reset cap: the (cap+1)th reset is refused, and max_role_resets 0 disables', async () => {
    const { daemon, name } = await start(
      { max_role_resets: 2 },
      summarizingRunner(() => 's'),
    );
    for (let i = 0; i < 2; i++)
      expect((await daemon.clearRole(name, 'boss', { roleId: 'worker', reason: `r${i}` })).success).toBe(true);
    const third = await daemon.clearRole(name, 'boss', { roleId: 'worker', reason: 'r3' });
    expect(third.success).toBe(false);
    expect(third.error).toMatch(/reset limit \(2\/2\)/);
    await daemon.stopOrg(name);

    const off = await start({ max_role_resets: 0 }, summarizingRunner(() => 's'), 'off-org');
    const r = await off.daemon.clearRole('off-org', 'boss', { roleId: 'worker', reason: 'r' });
    expect(r.error).toMatch(/off for this org/);
    await off.daemon.stopOrg('off-org');
  });

  it('a reset does not raise the org-wide token budget and carries spend as retired usage', async () => {
    const { daemon, running, name, def } = await start(
      { max_role_resets: 10, budget_tokens: 1000 },
      summarizingRunner(() => 's'),
    );
    running.agents.get('worker')!.policy.addUsage(300);
    const r = await daemon.clearRole(name, 'boss', { roleId: 'worker', reason: 'r' });
    expect(r.success).toBe(true);
    expect(running.def.run_config.budget_tokens).toBe(def.run_config.budget_tokens);
    expect(running.roleSlots.get('worker')!.retiredUsage.tokens).toBeGreaterThanOrEqual(300);
    await daemon.stopOrg(name);
  });

  it('audits both operations with reason and generation', async () => {
    const { daemon, running, name } = await start({ max_role_resets: 10 }, summarizingRunner(() => 'sum'));
    const audits: any[] = [];
    running.bus.subscribe((e) => {
      if (e.type === 'audit' && String(e.reason).startsWith('role-reset')) audits.push(e);
    });
    await daemon.compactRole(name, 'boss', { roleId: 'worker', reason: 'because-compact' });
    await daemon.clearRole(name, 'boss', { roleId: 'worker', reason: 'because-clear' });
    const done = audits.filter((a) => a.reason === 'role-reset');
    expect(done.map((a) => a.data.op)).toEqual(['org_compact_role', 'org_clear_role']);
    expect(done.map((a) => a.data.generation)).toEqual([1, 2]);
    expect(done.map((a) => a.data.reason)).toEqual(['because-compact', 'because-clear']);
    await daemon.stopOrg(name);
  });
});
