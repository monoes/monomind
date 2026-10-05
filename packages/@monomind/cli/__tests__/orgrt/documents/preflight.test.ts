// packages/@monomind/cli/__tests__/orgrt/documents/preflight.test.ts
// GA row R6 (spec 9.3; 6.14 role replacement, 7.3 pending probes): environment
// probes that validation cannot run must pass before a sections org starts,
// resumes or replaces a role. Outside the eval harness a host without the
// sandbox or the authority mask is refused (the read boundary would rest on
// file-tool rules alone); in eval mode it is a warning. A replacement keeps its
// role's effective configuration: runtime, model and provider changes need a
// stop and restart.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OrgDaemon } from '../../../src/orgrt/daemon.js';
import { hostPreflight, setHostProbes } from '../../../src/orgrt/documents/preflight.js';
import { sectionsRaw } from '../support/sections-defs.js';

const OK = { available: true };
const NO = (why: string) => ({ available: false, reason: why });
const evalDef = () => sectionsRaw() as any;
const prodDef = () => {
  const d = sectionsRaw() as any;
  delete d.run_config.experimental;
  return d;
};
const legacy = () => ({ name: 'l', goal: 'g', roles: (sectionsRaw() as any).roles }) as any;

describe('hostPreflight', () => {
  it('has nothing to say about an org without sections', () => {
    expect(hostPreflight(legacy(), { mask: NO('x'), sandbox: NO('y') })).toEqual({ ok: true, refusals: [], warnings: [] });
  });

  it('outside the eval harness refuses a host without the authority mask or the sandbox', () => {
    const r = hostPreflight(prodDef(), { mask: NO('no bwrap'), sandbox: NO('socat missing') });
    expect(r.ok).toBe(false);
    expect(r.refusals.join('\n')).toMatch(/authority mask.*no bwrap/);
    expect(r.refusals.join('\n')).toMatch(/sandbox.*socat missing/);
  });

  it('passes a host that has both', () => {
    expect(hostPreflight(prodDef(), { mask: OK, sandbox: OK })).toEqual({ ok: true, refusals: [], warnings: [] });
  });

  it('in an eval org the same gaps are warnings, not refusals', () => {
    const r = hostPreflight(evalDef(), { mask: NO('no bwrap'), sandbox: NO('socat missing') });
    expect(r.ok).toBe(true);
    expect(r.warnings.join('\n')).toMatch(/authority mask/);
  });

  it('refuses a runtime without a copy-inventory entry outside the eval harness', () => {
    const d = prodDef();
    d.roles.find((r: any) => r.id === 'coder').runtime = 'no-such-runtime';
    const r = hostPreflight(d, { mask: OK, sandbox: OK });
    expect(r.ok).toBe(false);
    expect(r.refusals.join('\n')).toMatch(/coder.*no-such-runtime/);
  });

  it('lets an unverified runtime start, with a warning that names it', () => {
    const d = prodDef();
    d.roles.find((r: any) => r.id === 'coder').runtime = 'qwen';
    const r = hostPreflight(d, { mask: OK, sandbox: OK });
    expect(r.ok).toBe(true);
    expect(r.warnings.join('\n')).toMatch(/coder.*qwen.*not probed/);
  });

  it('lets a codex, pi, opencode, crush or antigravity role start on a protected host', () => {
    for (const rt of ['codex', 'pi', 'pi-rpc', 'opencode', 'crush', 'antigravity']) {
      const d = prodDef();
      d.roles.find((r: any) => r.id === 'coder').runtime = rt;
      expect(hostPreflight(d, { mask: OK, sandbox: OK }), rt).toEqual({ ok: true, refusals: [], warnings: [] });
    }
  });
});

describe('start, resume and replacement (real daemon)', () => {
  let root: string;
  const daemons: OrgDaemon[] = [];
  beforeEach(() => {
    root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'preflight-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  });
  afterEach(async () => {
    setHostProbes(undefined);
    await Promise.all(daemons.splice(0).map((d) => d.stopAll().catch(() => {})));
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  const queryFn = ({ prompt }: any) =>
    (async function* () {
      for await (const m of prompt) {
        yield { type: 'assistant', message: { content: [{ type: 'text', text: `echo: ${m.message.content}` }] } };
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
      }
    })();
  const mk = (raw: Record<string, any>): OrgDaemon => {
    writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
    const d = new OrgDaemon(root, { queryFn: queryFn as any, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
    daemons.push(d);
    return d;
  };

  it('refuses to start a non-eval sections org on an unprotected host, and takes no lock', async () => {
    setHostProbes({ mask: NO('no bwrap'), sandbox: OK });
    const raw = prodDef();
    const d = mk(raw);
    await expect(d.startOrg('sec-org', undefined, { evalGate: true })).rejects.toThrow(/authority mask/);
    expect(d.getOrg('sec-org')).toBeUndefined();
    expect(d.daemonLocks.size).toBe(0);
  });

  it('starts an eval org on an unprotected host (a warning only)', async () => {
    setHostProbes({ mask: NO('no bwrap'), sandbox: NO('no socat') });
    const d = mk(evalDef());
    await d.startOrg('sec-org', undefined, { evalGate: true });
    expect(d.getOrg('sec-org')).toBeDefined();
  });

  /** An eval org, started, then made to look like one after the gate flips. */
  async function startedLikeAfterFlip() {
    setHostProbes({ mask: OK, sandbox: OK });
    const raw = evalDef();
    raw.run_config.max_role_respawns = 3;
    const d = mk(raw);
    const running = await d.startOrg('sec-org', undefined, { evalGate: true });
    await d.deliver('sec-org', 'boss', 'coder', 's', 'start');
    for (let i = 0; i < 100 && !running.roleSlots.get('coder'); i++) await new Promise((r) => setTimeout(r, 25));
    delete (running.def.run_config as any).experimental;
    return { d, running };
  }
  const again = { roleId: 'coder', reason: 'test', briefing: 'again' };

  it('refuses a runtime, model or provider change on replacement', async () => {
    const { d } = await startedLikeAfterFlip();
    for (const change of [{ model: 'other-model' }, { runtime: 'codex' }, { providerName: 'p' }]) {
      const r = await d.respawnRole('sec-org', 'boss', { ...again, ...change });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/stop and restart/);
    }
  });

  it('refuses a same-configuration replacement on an unprotected host, without spending an attempt', async () => {
    const { d, running } = await startedLikeAfterFlip();
    setHostProbes({ mask: NO('no bwrap'), sandbox: OK });
    const r = await d.respawnRole('sec-org', 'boss', again);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/authority mask/);
    expect(running.roleSlots.get('coder')?.respawnCount).toBe(0);
  });

  it('a crashed role is not restarted on an unprotected host, and the audit says why', async () => {
    setHostProbes({ mask: OK, sandbox: OK });
    const raw = evalDef();
    const crashing = ({ prompt }: any) =>
      (async function* () {
        for await (const m of prompt) {
          if (String(m.message.content).includes('CRASH')) throw new Error('boom');
          yield { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } };
          yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
        }
      })();
    writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
    const d = new OrgDaemon(root, { queryFn: crashing as any, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
    daemons.push(d);
    const running = await d.startOrg('sec-org', undefined, { evalGate: true });
    await d.deliver('sec-org', 'boss', 'coder', 's', 'warm up');
    delete (running.def.run_config as any).experimental;
    setHostProbes({ mask: NO('no bwrap'), sandbox: OK });
    await d.deliver('sec-org', 'boss', 'coder', 's', 'CRASH now');
    const events = () => running.busEvents();
    for (let i = 0; i < 200 && !events().some((e: any) => e.reason === 'replacement-refused'); i++)
      await new Promise((r) => setTimeout(r, 25));
    expect(events().some((e: any) => e.reason === 'replacement-refused')).toBe(true);
    expect(events().some((e: any) => e.reason === 'agent-restart' && e.from === 'coder')).toBe(false);
  });
});
