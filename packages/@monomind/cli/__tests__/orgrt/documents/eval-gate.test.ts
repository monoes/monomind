// packages/@monomind/cli/__tests__/orgrt/documents/eval-gate.test.ts
// P3.3: the eval-mode start gate, in a real OrgDaemon with a stub queryFn (no model).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OrgDaemon } from '../../../src/orgrt/daemon.js';
import {
  assertEvalGate,
  EVAL_BOSS_CRASH_CLOSED_BY,
  evalGateFor,
  evalGateRefusal,
} from '../../../src/orgrt/documents/eval-gate.js';
import { sectionsRaw } from '../support/sections-defs.js';

const NO_SANDBOX = { sandbox: { mode: 'off' } };
const legacyRaw = (): Record<string, any> => ({
  name: 'legacy-org',
  goal: 'g',
  run_config: { idle_minutes: 0 },
  roles: [
    { id: 'boss', title: 'Boss', type: 'boss', reports_to: null, policy: NO_SANDBOX },
    { id: 'worker', title: 'Worker', type: 'specialist', reports_to: 'boss', policy: NO_SANDBOX },
  ],
});

const queryFn = ({ prompt }: any) =>
  (async function* () {
    for await (const m of prompt) {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: `echo: ${m.message.content}` }] } };
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
    }
  })();

let root: string;
const daemons: OrgDaemon[] = [];
const mk = (raw: Record<string, any>): OrgDaemon => {
  writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
  const d = new OrgDaemon(root, {
    queryFn: queryFn as any,
    forward: false,
    stopWaitMs: 100,
    bossRestartBackoffMs: [600_000],
  });
  daemons.push(d);
  return d;
};
const runtimeOf = (name: string): Record<string, any> =>
  JSON.parse(readFileSync(join(root, '.monomind/orgs', name, 'runtime.json'), 'utf8'));

beforeEach(() => {
  root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'eval-gate-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
});
afterEach(async () => {
  await Promise.all(daemons.splice(0).map((d) => d.stopAll().catch(() => {})));
  rmSync(root, { recursive: true, force: true });
});

describe('assertEvalGate', () => {
  it('refuses a sections def without the gate, with the exact message', () => {
    const def = sectionsRaw();
    expect(() => assertEvalGate(def, 'sec-org', undefined)).toThrow(evalGateRefusal('sec-org'));
    expect(() => assertEvalGate(def, 'sec-org', {})).toThrow(evalGateRefusal('sec-org'));
    expect(() => assertEvalGate(def, 'sec-org', { evalGate: false })).toThrow(evalGateRefusal('sec-org'));
    expect(evalGateRefusal('sec-org')).toBe(
      'org "sec-org" uses sections, which are experimental and run only through the eval harness ' +
        '(run_config.experimental: "eval"); org run, org serve, schedules, auto-wake and resume cannot ' +
        'start it. Use the experimental eval path: tests/eval/org/pilot/run-org.ts',
    );
  });

  it('passes a sections def with the gate, and a legacy def with or without it', () => {
    expect(() => assertEvalGate(sectionsRaw(), 'sec-org', { evalGate: true })).not.toThrow();
    expect(() => assertEvalGate(legacyRaw(), 'legacy-org', undefined)).not.toThrow();
    expect(() => assertEvalGate(legacyRaw(), 'legacy-org', { evalGate: true })).not.toThrow();
    expect(() => assertEvalGate({ sections: {} }, 'x', undefined)).not.toThrow();
  });

  it('evalGateFor gives the gate for sections only, and nothing otherwise', () => {
    expect(evalGateFor(sectionsRaw())).toEqual({ evalGate: true });
    expect(evalGateFor(legacyRaw())).toEqual({});
    expect(evalGateFor(undefined)).toEqual({});
  });
});

describe('startOrg gate matrix (real daemon)', () => {
  it('refuses a sections org without the gate and leaves nothing running or on disk', async () => {
    const d = mk(sectionsRaw());
    await expect(d.startOrg('sec-org')).rejects.toThrow(evalGateRefusal('sec-org'));
    await expect(d.startOrg('sec-org', undefined, { autoApprove: [] })).rejects.toThrow(/eval harness/);
    expect(d.getOrg('sec-org')).toBeUndefined();
    expect(d.startingOrgs.has('sec-org')).toBe(false);
  });

  it('refuses resume the same way, even with a resume request', async () => {
    const d = mk(sectionsRaw());
    await expect(d.startOrg('sec-org', undefined, { resume: true })).rejects.toThrow(/eval harness/);
  });

  it('auto-wake of a sections org is refused (nothing starts)', async () => {
    const d = mk(sectionsRaw());
    d.autoWake('sec-org');
    await new Promise((r) => setTimeout(r, 200));
    expect(d.getOrg('sec-org')).toBeUndefined();
  });

  it('starts a sections org with the gate', async () => {
    const d = mk(sectionsRaw());
    const running = await d.startOrg('sec-org', undefined, { evalGate: true });
    expect(running.def.name).toBe('sec-org');
    expect(d.getOrg('sec-org')).toBeDefined();
  });

  it('a legacy org starts with or without the option', async () => {
    const d = mk(legacyRaw());
    await d.startOrg('legacy-org');
    await d.stopOrg('legacy-org');
    await d.startOrg('legacy-org', undefined, { evalGate: true });
    expect(d.getOrg('legacy-org')).toBeDefined();
  });
});

describe('boss crash', () => {
  it('a sections org is stopped with the distinct closedBy, never restarted', async () => {
    const d = mk(sectionsRaw());
    const running = await d.startOrg('sec-org', undefined, { evalGate: true });
    d.scheduleBossRestart('sec-org');
    expect(d.restarting.has('sec-org')).toBe(false);
    expect(d.bossRestartCounts.has('sec-org')).toBe(false);
    const stopped = (): boolean => {
      try {
        return runtimeOf('sec-org').status === 'stopped';
      } catch {
        return false;
      }
    };
    for (let i = 0; i < 500 && !(stopped() && !d.getOrg('sec-org')); i++)
      await new Promise((r) => setTimeout(r, 10));
    expect(d.getOrg('sec-org')).toBeUndefined();
    const events = running.busEvents();
    expect(events.find((e) => e.reason === 'org-stopped')?.data?.closedBy).toBe(EVAL_BOSS_CRASH_CLOSED_BY);
    expect(events.some((e) => e.reason === 'boss-restart')).toBe(false);
    const rt = runtimeOf('sec-org');
    expect(rt.status).toBe('stopped');
    expect(rt.closedBy).toBe('eval-boss-crash');
    expect(rt.checkpoint).toBeDefined();
  });

  it('a legacy org still schedules the restart and is not stopped', async () => {
    const d = mk(legacyRaw());
    const running = await d.startOrg('legacy-org');
    d.scheduleBossRestart('legacy-org');
    expect(d.restarting.has('legacy-org')).toBe(true);
    expect(d.bossRestartCounts.get('legacy-org')).toBe(1);
    expect(d.getOrg('legacy-org')).toBeDefined();
    const events = running.busEvents();
    expect(events.some((e) => e.reason === 'boss-restart')).toBe(true);
    expect(events.some((e) => e.reason === EVAL_BOSS_CRASH_CLOSED_BY)).toBe(false);
  });

  it('a legacy org stopped by hand keeps its closedBy (unchanged)', async () => {
    const d = mk(legacyRaw());
    const running = await d.startOrg('legacy-org');
    await d.stopOrg('legacy-org', { closedBy: 'org-complete' });
    expect(running.busEvents().find((e) => e.reason === 'org-stopped')?.data?.closedBy).toBe('org-complete');
  });
});
