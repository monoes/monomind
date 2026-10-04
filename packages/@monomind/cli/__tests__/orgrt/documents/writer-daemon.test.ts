// packages/@monomind/cli/__tests__/orgrt/documents/writer-daemon.test.ts
// P4.4: the single writer through a real OrgDaemon (eval gate) with a scripted queryFn (no model) and the real
// policy engine and sandbox layer. The queryFn hands the test the options each role session was started with,
// canUseTool (the policy gate) and the SDK sandbox settings among them, so the test calls the gate as the model's
// tool calls would. Needs the OS sandbox to be available (the overlay makes read-only roles "required").
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgDaemon } from '../../../src/orgrt/daemon.js';
import { PolicyEngine } from '../../../src/orgrt/policy.js';
import { sandboxAvailability } from '../../../src/orgrt/role-sandbox-restrictions.js';
import { sandboxStubs } from '../../../src/orgrt/sandbox-stubs.js';
import { WriterPolicyEngine } from '../../../src/orgrt/writer-engine.js';
import { sectionsRaw } from '../support/sections-defs.js';

type Raw = Record<string, any>;
const NO_FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const oneWriter = (raw: Raw) => {
  raw.sections.research.writes = ['src/**'];
  raw.roles.find((r: Raw) => r.id === 'research-lead').policy = { denyTools: [...NO_FILE_TOOLS, 'Bash'] };
};
const HAVE_SANDBOX = sandboxAvailability().available;

let root: string;
const daemons: OrgDaemon[] = [];
const saved = { ...process.env };
beforeEach(() => {
  process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
  process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
  root = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'writer-daemon-')));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  mkdirSync(join(root, 'src'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(daemons.splice(0).map((d) => d.stopAll().catch(() => {})));
  rmSync(root, { recursive: true, force: true });
  for (const k of ['MONOMIND_SPAWN_STAGGER_MS', 'MONOMIND_MIN_FREE_MEM_MB'] as const)
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});

/** The options (canUseTool, sandbox) each role session was started with, by role id. */
function scripted() {
  const options = new Map<string, any>();
  const waiters = new Map<string, Array<() => void>>();
  const queryFn = ({ prompt, options: o }: any) =>
    (async function* () {
      const role = o.env.MONOMIND_ORG_ROLE as string;
      options.set(role, o);
      for (const w of waiters.get(role) ?? []) w();
      for await (const _m of prompt)
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
    })();
  const started = (role: string) =>
    options.has(role)
      ? Promise.resolve(options.get(role))
      : new Promise<any>((resolve, reject) => {
          waiters.set(role, [...(waiters.get(role) ?? []), () => resolve(options.get(role))]);
          setTimeout(() => reject(new Error(`role ${role} never started`)), 8000).unref?.();
        });
  return { queryFn, started };
}

async function start(raw: Raw, resume = false) {
  writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
  const s = scripted();
  const d = new OrgDaemon(root, { queryFn: s.queryFn as any, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
  daemons.push(d);
  const running = await d.startOrg(raw.name, undefined, { evalGate: true, ...(resume ? { resume: true } : {}) });
  const role = async (id: string) => {
    const seen = s.started(id);
    await d.deliver(raw.name, 'human', id, 'hello', 'hello');
    return seen;
  };
  return { d, running, role };
}

const gate = (o: any, tool: string, input: Record<string, unknown>) => o.canUseTool(tool, input, {});

describe.skipIf(!HAVE_SANDBOX)('a single-writer org through a real daemon (P4.4)', () => {
  it('the writer\'s Write inside writes is allowed and outside it refused; a non-writer\'s Write and Edit are refused', async () => {
    const { role } = await start(sectionsRaw(oneWriter));
    const writer = await role('researcher');
    const coder = await role('coder');
    const lead = await role('dev-lead');
    expect((await gate(writer, 'Write', { file_path: join(root, 'src', 'a.ts'), content: 'x' })).behavior).toBe('allow');
    const outside = await gate(writer, 'Write', { file_path: join(root, 'docs', 'a.md'), content: 'x' });
    expect(outside.behavior).toBe('deny');
    expect(outside.message).toMatch(/REFUSED: researcher \(section research\) may write only inside its section's writes \(src\/\*\*\)/);
    for (const [id, o] of [['coder', coder], ['dev-lead', lead]] as const) {
      for (const [tool, input] of [
        ['Write', { file_path: join(root, 'src', 'a.ts'), content: 'x' }],
        ['Edit', { file_path: join(root, 'src', 'a.ts'), old_string: 'a', new_string: 'b' }],
      ] as const) {
        const d = await gate(o, tool, { ...input });
        expect(d.behavior, `${id} ${tool}`).toBe('deny');
        expect(d.message, `${id} ${tool}`).toContain('this org has a single writer for the workspace');
        expect(d.message).toContain('researcher is the only role that may write the workspace');
      }
    }
  }, 30_000);

  it('records a writer-refused audit event on the bus for each refusal', async () => {
    const { role, running } = await start(sectionsRaw(oneWriter));
    const events: any[] = [];
    running.bus.subscribe((e) => events.push(e));
    const coder = await role('coder');
    await gate(coder, 'Write', { file_path: join(root, 'src', 'a.ts'), content: 'x' });
    expect(events.filter((e) => e.reason === 'writer-refused')).toMatchObject([{ type: 'audit', from: 'coder', data: { tool: 'Write' } }]);
  }, 30_000);

  it('the non-writer\'s SDK sandbox denies the real workspace as a whole; the writer role has no such deny', async () => {
    const { role } = await start(sectionsRaw(oneWriter));
    const coder = await role('coder');
    const lead = await role('research-lead');
    expect(coder.sandbox.enabled).toBe(true);
    expect(coder.sandbox.filesystem.denyWrite).toContain(root);
    // the lead of the writing section keeps its own policy: no workspace deny is added to it
    expect(lead.sandbox?.filesystem?.denyWrite ?? []).not.toContain(root);
  }, 30_000);

  it('the engines: a role with an overlay runs the writer engine, the others a plain PolicyEngine; policy equals the effective one', async () => {
    const { running, role } = await start(sectionsRaw(oneWriter));
    await role('coder');
    await role('researcher');
    const coder = running.agents.get('coder')!.policy;
    expect(coder).toBeInstanceOf(WriterPolicyEngine);
    expect(coder.policy.fileWrite).toEqual([]);
    expect(coder.policy.sandbox).toMatchObject({ mode: 'required', denyWrite: [root] });
    expect(running.agents.get('researcher')!.policy.policy.fileWrite).toEqual(['src/**']);
  }, 30_000);

  it('resume rebuilds the same overlay', async () => {
    const raw = sectionsRaw(oneWriter);
    const first = await start(raw);
    await first.role('coder');
    const before = JSON.stringify(first.running.agents.get('coder')!.policy.policy);
    await first.d.stopOrg(raw.name);
    const again = await start(raw, true);
    const coder = await again.role('coder');
    expect(JSON.stringify(again.running.agents.get('coder')!.policy.policy)).toBe(before);
    expect((await gate(coder, 'Write', { file_path: join(root, 'src', 'a.ts'), content: 'x' })).behavior).toBe('deny');
  }, 30_000);

  it('a reload that changes a read-only role\'s policy keeps the overlay (the live engine gets the effective policy)', async () => {
    const raw = sectionsRaw(oneWriter);
    const { d, running, role } = await start(raw);
    const coder = await role('coder');
    const next = sectionsRaw(oneWriter);
    next.roles.find((r: Raw) => r.id === 'coder').policy = { sandbox: { mode: 'off' }, denyTools: ['WebFetch'] };
    writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(next));
    expect(d.reloadOrgDef(raw.name).changed).toContain('role:coder:policy');
    const live = running.agents.get('coder')!.policy.policy;
    expect(live.denyTools).toEqual(['WebFetch']);
    expect(live.fileWrite).toEqual([]);
    expect(live.sandbox).toMatchObject({ mode: 'required', denyWrite: [root] });
    expect((await gate(coder, 'Write', { file_path: join(root, 'src', 'a.ts'), content: 'x' })).behavior).toBe('deny');
  }, 30_000);

  it('holds every read-only role whose boundary falls back to an expansion: audit event, a fatal crash, never widened', async () => {
    vi.spyOn(sandboxStubs, 'missing').mockReturnValue([join(root, '.mcp.json')]);
    const { running, d } = await start(sectionsRaw(oneWriter));
    const events: any[] = [];
    running.bus.subscribe((e) => events.push(e));
    await d.deliver('sec-org', 'human', 'coder', 'hello', 'hello');
    for (let i = 0; i < 200 && !events.some((e) => e.reason === 'agent-session-crash' && e.from === 'coder'); i++)
      await new Promise((r) => setTimeout(r, 25));
    const held = events.filter((e) => e.reason === 'writer-boundary-unqualified');
    expect(held.map((e) => e.from)).toContain('coder');
    const coder = held.find((e) => e.from === 'coder');
    expect(coder).toMatchObject({ type: 'audit' });
    expect(coder.msg).toMatch(/^roles\.coder: the read-only boundary for .* is not qualified \(the deny was expanded into the children of /);
    // not retried: a fatal error, then the terminal crash handling, with the same clear message
    expect(events.some((e) => e.reason === 'agent-fatal' && e.from === 'coder')).toBe(true);
    expect(events.find((e) => e.reason === 'agent-session-crash' && e.from === 'coder').msg).toContain('is not qualified');
    expect(running.agents.get('coder')!.status).toBe('crashed');
  }, 30_000);
});

describe('orgs that do not use the key run exactly as before (P4.4)', () => {
  it('a sections org without writes: plain PolicyEngine and the authored policy for every role', async () => {
    const raw = sectionsRaw();
    const { running, role } = await start(raw);
    for (const id of ['boss', 'researcher', 'coder']) await role(id);
    for (const r of running.def.roles.filter((x) => ['boss', 'researcher', 'coder'].includes(x.id))) {
      const engine = running.agents.get(r.id)!.policy;
      expect(engine.constructor).toBe(PolicyEngine);
      expect(engine.policy).toMatchObject({ ...r.policy, maxTokens: expect.any(Number) });
      expect(engine.policy.fileWrite).toEqual(['**']);
    }
    expect(existsSync(join(root, 'src'))).toBe(true);
  }, 30_000);
});
