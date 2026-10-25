import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { buildOrgTools } from '../../src/orgrt/session.js';
import { roleResetsEnabled } from '../../src/orgrt/role-slot.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';

type Mode = 'summary' | 'empty' | 'silent';

describe('org_compact_role / org_clear_role', () => {
  let testRoot: string;
  // Every prompt the (single) worker session ever receives, across generations.
  const received: string[] = [];
  let mode: Mode = 'summary';
  let busy: Promise<void> | undefined;

  // One turn per mailbox message: the worker answers a summary request with
  // `mode`, anything else with a plain reply; each turn ends with a result.
  const runner = {
    run: async function* (args: any) {
      for await (const m of args.prompt) {
        const content: string = m.message.content;
        received.push(content);
        if (content.startsWith('[system: context summary request]')) {
          if (mode === 'silent') {
            await busy;
          } else if (mode === 'summary') {
            yield { type: 'assistant', text: 'SUMMARY: goal is X; file /a/b.ts is half done' };
          }
        } else {
          await busy;
          yield { type: 'assistant', text: 'ok' };
        }
        yield { type: 'result', subtype: 'success' };
      }
    },
  };

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), 'orgrt-reset-'));
    mkdirSync(join(testRoot, '.monomind', 'orgs'), { recursive: true });
    received.length = 0;
    mode = 'summary';
    busy = undefined;
  });
  afterEach(() => rmSync(testRoot, { recursive: true, force: true }));

  async function start(name: string, runConfig: Record<string, unknown> = {}) {
    const def = OrgDefSchema.parse({
      name,
      roles: [{ id: 'boss' }, { id: 'worker', reports_to: 'boss' }],
      run_config: {
        idle_minutes: 0,
        max_role_resets: 10,
        respawn_start_timeout_ms: 100,
        respawn_drain_timeout_ms: 300,
        ...runConfig,
      },
    });
    writeFileSync(join(testRoot, '.monomind', 'orgs', `${name}.json`), JSON.stringify(def));
    const daemon = new OrgDaemon(testRoot, {
      stopWaitMs: 100,
      crossProcess: false,
      runner: runner as any,
    });
    const running = await daemon.startOrg(name);
    await daemon.deliver(name, 'boss', 'worker', 'go', 'start working');
    await new Promise((r) => setTimeout(r, 50));
    return { daemon, running, def };
  }

  it('does not consume max_role_respawns', async () => {
    const { daemon, running } = await start('count-org', { max_role_respawns: 2 });
    const r = await daemon.clearRole('count-org', 'boss', { roleId: 'worker', reason: 'done' });
    expect(r.success).toBe(true);
    const slot = running.roleSlots.get('worker')!;
    expect(slot.respawnCount).toBe(0);
    expect(slot.resetCount).toBe(1);
    await daemon.stopOrg('count-org');
  });

  it('is off unless max_role_resets is set above 0', () => {
    expect(roleResetsEnabled({})).toBe(false);
    expect(roleResetsEnabled({ max_role_resets: 0 })).toBe(false);
    expect(roleResetsEnabled({ max_role_resets: 3 })).toBe(true);
    expect(OrgDefSchema.parse({ name: 'd', roles: [{ id: 'boss' }] }).run_config.max_role_resets).toBeUndefined();
  });

  it('clear: fresh generation, queued messages and task ownership survive', async () => {
    const { daemon, running } = await start('clear-org');
    const oldRuntime = running.agents.get('worker')!;
    const task = running.taskDag!.add('t', 'worker');
    running.taskDag!.complete(task.id, 'done');
    busy = new Promise((r) => setTimeout(r, 0));
    const r = await daemon.clearRole('clear-org', 'boss', { roleId: 'worker', reason: 'finished' });
    expect(r).toMatchObject({ success: true, roleId: 'worker', generation: 1, summaryChars: 0 });
    const slot = running.roleSlots.get('worker')!;
    expect(slot.runtime).not.toBe(oldRuntime);
    expect(running.agents.get('worker')).toBe(slot.runtime);
    expect(running.taskDag!.get(task.id)?.assignee).toBe('worker');
    const audits = running.busEvents().filter((e) => e.type === 'audit');
    const cleared = audits.find((e) => e.reason === 'role-cleared')!;
    expect(cleared.msg).toContain('generation 1');
    expect((cleared.data as any).reason).toBe('finished');
    await daemon.stopOrg('clear-org');
  });

  it('clear is rejected, naming the task ids, while the role owns open tasks', async () => {
    const { daemon, running } = await start('open-org');
    const t = running.taskDag!.add('still going', 'worker');
    const oldRuntime = running.roleSlots.get('worker')!.runtime;
    const r = await daemon.clearRole('open-org', 'boss', { roleId: 'worker', reason: 'x' });
    expect(r.success).toBe(false);
    expect(r.error).toContain(t.id);
    expect(running.roleSlots.get('worker')!.runtime).toBe(oldRuntime);
    expect(running.roleSlots.get('worker')!.resetCount ?? 0).toBe(0);
    await daemon.stopOrg('open-org');
  });

  it('compact: asks the old session for a summary and seeds the fresh one with it', async () => {
    const { daemon, running } = await start('compact-org');
    const r = await daemon.compactRole('compact-org', 'boss', { roleId: 'worker', reason: 'big' });
    expect(r.success).toBe(true);
    expect(r.generation).toBe(1);
    expect(r.summaryChars).toBeGreaterThan(0);
    const worker = received;
    expect(worker.some((m) => m.startsWith('[system: context summary request]'))).toBe(true);
    const seed = worker.find((m) => m.startsWith('[system: context compacted'))!;
    expect(seed).toContain('SUMMARY: goal is X');
    expect(running.busEvents().some((e) => e.type === 'audit' && e.reason === 'role-compacted')).toBe(true);
    await daemon.stopOrg('compact-org');
  });

  it.each(['empty', 'silent'] as const)(
    'compact with a %s summary fails and leaves the old session untouched',
    async (m) => {
      const { daemon, running } = await start(`fail-${m}-org`);
      const slot = running.roleSlots.get('worker')!;
      const oldRuntime = slot.runtime;
      mode = m;
      if (m === 'silent') busy = new Promise((r) => setTimeout(r, 600));
      const r = await daemon.compactRole(`fail-${m}-org`, 'boss', { roleId: 'worker', reason: 'x' });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/summary|time/i);
      expect(slot.runtime).toBe(oldRuntime);
      expect(slot.generation).toBe(0);
      expect(slot.phase).toBe('running');
      expect(slot.resetCount ?? 0).toBe(0);
      expect(running.respawning.has('worker')).toBe(false);
      await daemon.stopOrg(`fail-${m}-org`);
    },
  );

  it('rejects the coordinator, a non-coordinator caller, and unknown roles', async () => {
    const { daemon } = await start('reject-org');
    const call = (caller: string, roleId: string) =>
      daemon.clearRole('reject-org', caller, { roleId, reason: 'x' });
    expect((await call('boss', 'boss')).error).toMatch(/coordinator/);
    expect((await call('worker', 'worker')).error).toMatch(/only the selected coordinator/);
    expect((await call('boss', 'nobody')).error).toMatch(/unknown/);
    expect((await daemon.compactRole('reject-org', 'boss', { roleId: 'boss', reason: 'x' })).success).toBe(false);
    await daemon.stopOrg('reject-org');
  });

  it('rejects a role with a turn running, and one already being replaced', async () => {
    const { daemon, running } = await start('busy-org');
    const slot = running.roleSlots.get('worker')!;
    busy = new Promise((r) => setTimeout(r, 400));
    await daemon.deliver('busy-org', 'boss', 'worker', 'go', 'long job');
    await new Promise((r) => setTimeout(r, 30));
    const r = await daemon.clearRole('busy-org', 'boss', { roleId: 'worker', reason: 'x' });
    expect(r.error).toMatch(/turn running/);
    running.respawning.add('worker');
    const r2 = await daemon.clearRole('busy-org', 'boss', { roleId: 'worker', reason: 'x' });
    expect(r2.error).toMatch(/already undergoing replacement/);
    running.respawning.delete('worker');
    slot.phase = 'removed';
    expect((await daemon.clearRole('busy-org', 'boss', { roleId: 'worker', reason: 'x' })).error).toMatch(/removed/);
    slot.phase = 'running';
    await daemon.stopOrg('busy-org');
  });

  it('caps resets per role with max_role_resets', async () => {
    const { daemon } = await start('cap-org', { max_role_resets: 2 });
    const clear = () => daemon.clearRole('cap-org', 'boss', { roleId: 'worker', reason: 'x' });
    expect((await clear()).success).toBe(true);
    expect((await clear()).success).toBe(true);
    const third = await clear();
    expect(third.success).toBe(false);
    expect(third.error).toMatch(/reset limit \(2\/2\)/);
    await daemon.stopOrg('cap-org');
  });

  it('a reset keeps spend: the org-wide budget is not raised', async () => {
    const { daemon, running } = await start('budget-org');
    const slot = running.roleSlots.get('worker')!;
    slot.runtime!.policy.setUsage(1234);
    const before = slot.runtime!.policy.budgetedUsage;
    const r = await daemon.clearRole('budget-org', 'boss', { roleId: 'worker', reason: 'x' });
    expect(r.success).toBe(true);
    expect(slot.retiredUsage.tokens).toBe(before);
    expect(slot.runtime!.policy.policy.maxTokens).toBeLessThanOrEqual(
      running.def.run_config.budget_tokens!,
    );
    await daemon.stopOrg('budget-org');
  });

  it('wires the tools for the selected coordinator only', () => {
    const noop = async () => ({});
    const boss = buildOrgTools({
      role: { id: 'boss' },
      deliver: async () => 'ok',
      onCompactRole: noop,
      onClearRole: noop,
    } as any).map((t) => t.name);
    expect(boss).toContain('org_compact_role');
    expect(boss).toContain('org_clear_role');
    const worker = buildOrgTools({ role: { id: 'worker' }, deliver: async () => 'ok' } as any).map(
      (t) => t.name,
    );
    expect(worker).not.toContain('org_compact_role');
    expect(worker).not.toContain('org_clear_role');
  });

  it('the coordinator session gets the handlers; workers and max_role_resets 0 do not', async () => {
    const { daemon, running } = await start('wire-org');
    const tools = buildOrgTools({
      role: running.def.roles[0],
      deliver: async () => 'ok',
      onCompactRole: (c: string, a: any) => daemon.compactRole('wire-org', c, a),
      onClearRole: (c: string, a: any) => daemon.clearRole('wire-org', c, a),
    } as any);
    const clear = tools.find((t) => t.name === 'org_clear_role')!;
    const out = JSON.parse((await clear.handler({ roleId: 'worker', reason: 'r' })).text);
    expect(out.success).toBe(true);
    await daemon.stopOrg('wire-org');
  });
});
