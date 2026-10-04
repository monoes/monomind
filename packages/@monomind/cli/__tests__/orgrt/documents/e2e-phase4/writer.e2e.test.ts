// P4.12 scenario A: the single writer end to end through a real OrgDaemon (eval gate) with a scripted queryFn (no model),
// the real policy engine, the real sandbox layer and, for the shell, the real bubblewrap. The queryFn hands the test the
// options each role session was started with (canUseTool, the SDK sandbox settings), so the test calls the gate as the
// model's tool calls would. research writes `src/**` (researcher is the writer; its lead keeps no file tools and no shell);
// development (dev-lead, coder) is read-only. A second writer, a second writing section and worktree-per-role are refused
// at start; a read-only boundary that could not be qualified holds the role's start.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgDaemon } from '../../../../src/orgrt/daemon.js';
import { worktreePerRoleText } from '../../../../src/orgrt/documents/writer-text.js';
import { sandboxAvailability } from '../../../../src/orgrt/role-sandbox-restrictions.js';
import { sandboxStubs } from '../../../../src/orgrt/sandbox-stubs.js';
import { WriterPolicyEngine } from '../../../../src/orgrt/writer-engine.js';
import { sectionsRaw } from '../../support/sections-defs.js';

type Raw = Record<string, any>;
const NO_FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const oneWriter = (raw: Raw) => {
  raw.sections.research.writes = ['src/**'];
  raw.roles.find((r: Raw) => r.id === 'research-lead').policy = { denyTools: [...NO_FILE_TOOLS, 'Bash'] };
};
const HAVE_SANDBOX = sandboxAvailability().available;
const bwrapWorks = process.platform === 'linux' && spawnSync('bwrap', ['--dev-bind', '/', '/', 'true'], { encoding: 'utf8' }).status === 0;

let root: string;
const daemons: OrgDaemon[] = [];
const saved = { ...process.env };
beforeEach(() => {
  process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
  process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
  root = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'p4-writer-')));
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
      for await (const _m of prompt) yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
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

async function start(raw: Raw) {
  writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
  const s = scripted();
  const d = new OrgDaemon(root, { queryFn: s.queryFn as any, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
  daemons.push(d);
  const running = await d.startOrg(raw.name, undefined, { evalGate: true });
  const role = async (id: string) => {
    const seen = s.started(id);
    await d.deliver(raw.name, 'human', id, 'hello', 'hello');
    return seen;
  };
  return { d, running, role };
}
const gate = (o: any, tool: string, input: Record<string, unknown>) => o.canUseTool(tool, input, {});
const refusals = (running: any): any[] => running.busEvents().filter((e: any) => e.type === 'audit' && e.reason === 'writer-refused');

describe.skipIf(!HAVE_SANDBOX)('one writing section in a live org', () => {
  it('the writer writes inside writes (a real file) and is refused outside; a non-writer\'s Write, Edit, MultiEdit and NotebookEdit are refused with the core text, one writer-refused event each', async () => {
    const { running, role } = await start(sectionsRaw(oneWriter));
    const writer = await role('researcher');
    const coder = await role('coder');
    const lead = await role('dev-lead');

    // the writer: inside writes it is allowed and the file really lands; outside, refused with the scope message
    const target = join(root, 'src', 'a.ts');
    expect((await gate(writer, 'Write', { file_path: target, content: 'export const a = 1;\n' })).behavior).toBe('allow');
    writeFileSync(target, 'export const a = 1;\n'); // what the allowed tool call then does
    expect(readFileSync(target, 'utf8')).toBe('export const a = 1;\n');
    const outside = await gate(writer, 'Write', { file_path: join(root, 'docs', 'a.md'), content: 'x' });
    expect(outside.behavior).toBe('deny');
    expect(outside.message).toMatch(/REFUSED: researcher \(section research\) may write only inside its section's writes \(src\/\*\*\)/);
    expect(existsSync(join(root, 'docs', 'a.md'))).toBe(false);
    expect(refusals(running)).toHaveLength(1);
    expect(refusals(running)[0]).toMatchObject({ from: 'researcher', data: { tool: 'Write' } });

    // every non-writer: each file tool refused with the single-writer text, and one audit event per refusal
    const calls: Array<[string, Record<string, unknown>]> = [
      ['Write', { file_path: join(root, 'src', 'b.ts'), content: 'x' }],
      ['Edit', { file_path: target, old_string: 'a', new_string: 'b' }],
      ['MultiEdit', { file_path: target, edits: [{ old_string: 'a', new_string: 'b' }] }],
      ['NotebookEdit', { notebook_path: join(root, 'src', 'n.ipynb'), new_source: 'x' }],
    ];
    let expected = 1;
    for (const [id, o] of [['coder', coder], ['dev-lead', lead]] as const)
      for (const [tool, input] of calls) {
        const verdict = await gate(o, tool, { ...input });
        expect(verdict.behavior, `${id} ${tool}`).toBe('deny');
        expect(verdict.message, `${id} ${tool}`).toContain('this org has a single writer for the workspace');
        expect(verdict.message).toContain('researcher is the only role that may write the workspace');
        expected += 1;
        expect(refusals(running), `${id} ${tool}`).toHaveLength(expected);
        expect(refusals(running).at(-1)).toMatchObject({ from: id, data: { tool } });
      }
    expect(readFileSync(target, 'utf8')).toBe('export const a = 1;\n'); // nothing a non-writer asked for happened
    expect(existsSync(join(root, 'src', 'b.ts'))).toBe(false);
    // the engines: only the roles of an overlay run the writer engine
    expect(running.agents.get('coder')!.policy).toBeInstanceOf(WriterPolicyEngine);
    expect(running.agents.get('researcher')!.policy.policy.fileWrite).toEqual(['src/**']);
  }, 30_000);

  it.skipIf(!bwrapWorks)('a non-writer\'s shell redirect is stopped at the OS: the sandbox the role was started with, run under the real bubblewrap, makes the workspace read-only', async () => {
    const { role } = await start(sectionsRaw(oneWriter));
    const coder = await role('coder');
    const deny = (coder.sandbox.filesystem.denyWrite as string[]).filter((p) => existsSync(p));
    expect(coder.sandbox.enabled).toBe(true);
    expect(deny).toContain(root);
    const inSandbox = (paths: string[], script: string) =>
      spawnSync('bwrap', ['--dev-bind', '/', '/', ...paths.flatMap((p) => ['--ro-bind', p, p]), 'sh', '-c', script], { encoding: 'utf8' });
    const blocked = inSandbox(deny, `echo hi > ${root}/src/redirect.txt`);
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toMatch(/Read-only file system/);
    expect(existsSync(join(root, 'src', 'redirect.txt'))).toBe(false);
    // control: without the deny list the same redirect succeeds, so the refusal above is the sandbox's doing
    expect(inSandbox([], `echo hi > ${root}/src/redirect.txt`).status).toBe(0);
    expect(readFileSync(join(root, 'src', 'redirect.txt'), 'utf8')).toBe('hi\n');
  }, 30_000);

  it('a read-only role whose boundary falls back to an expansion is held at start with writer-boundary-unqualified, a fatal crash, never widened', async () => {
    vi.spyOn(sandboxStubs, 'missing').mockReturnValue([join(root, '.mcp.json')]);
    const { running, d } = await start(sectionsRaw(oneWriter));
    const events: any[] = [];
    running.bus.subscribe((e) => events.push(e));
    await d.deliver('sec-org', 'human', 'coder', 'hello', 'hello');
    for (let i = 0; i < 200 && !events.some((e) => e.reason === 'agent-session-crash' && e.from === 'coder'); i++) await new Promise((r) => setTimeout(r, 25));
    const held = events.find((e) => e.reason === 'writer-boundary-unqualified' && e.from === 'coder');
    expect(held).toMatchObject({ type: 'audit' });
    expect(held.msg).toMatch(/^roles\.coder: the read-only boundary for .* is not qualified \(the deny was expanded into the children of /);
    expect(events.some((e) => e.reason === 'agent-fatal' && e.from === 'coder')).toBe(true);
    expect(running.agents.get('coder')!.status).toBe('crashed');
    expect(running.agents.get('coder')!.policy.policy.sandbox).toMatchObject({ mode: 'required' }); // never relaxed to let it run
  }, 30_000);
});

describe('what the definition refuses at start (no sandbox needed)', () => {
  /** startOrg of `raw` must throw `message`; nothing of the org is left running. */
  async function refused(raw: Raw, message: string) {
    writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
    const d = new OrgDaemon(root, { queryFn: scripted().queryFn as any, forward: false, stopWaitMs: 100 });
    daemons.push(d);
    await expect(d.startOrg(raw.name, undefined, { evalGate: true })).rejects.toThrow(message);
    expect(d.getOrg(raw.name)).toBeUndefined();
  }

  it('a second writing section is refused with the text the definition always had', async () => {
    await refused(
      sectionsRaw((r) => {
        r.sections.research.writes = ['src/a'];
        r.sections.development.writes = ['src/b'];
      }),
      'sections.research, sections.development: only one section may declare writes in this build (a single writer per repository, merge_owner is not yet supported) — keep writes on one section and hand the rest off as documents',
    );
  });

  it('a second role that can change the workspace is refused, naming both roles and the remedy', async () => {
    await refused(sectionsRaw((r) => (r.sections.research.writes = ['src/**'])), 'workspace repo: 2 roles can change it, at most one may — research-lead (');
  });

  it('worktree-per-role together with writes is refused at definition', async () => {
    await refused(
      sectionsRaw((r) => {
        oneWriter(r);
        r.run_config.workspace = 'worktree-per-role';
      }),
      worktreePerRoleText(),
    );
  });
});
