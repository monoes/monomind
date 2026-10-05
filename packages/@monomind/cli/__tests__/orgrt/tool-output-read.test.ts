// packages/@monomind/cli/__tests__/orgrt/tool-output-read.test.ts
//
// Found in the hardened parallel-sweep-3 trial (2026-10-05): when a Bash result is too large,
// Claude Code saves it under `<config dir>/projects/<slug>/<sessionId>/tool-results/` and tells
// the model to Read that path. The file-tool root check refused it ("path escapes every root
// this role may use"), so the role had to rerun its command. A role may read the persisted tool
// output of ITS OWN sessions, and only that: not another role's session, not the transcript or
// any other file of its own session directory, and never a write.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../../../../tests/setup/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OrgBus } from '../../src/orgrt/bus.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { runAgentSession } from '../../src/orgrt/session.js';

let cfg: string;
let work: string;
let savedEnv: string | undefined;
beforeEach(() => {
  const base = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'tool-out-'));
  cfg = join(base, 'cfg');
  work = join(base, 'work');
  mkdirSync(work, { recursive: true });
  savedEnv = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = cfg;
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = savedEnv;
  rmSync(join(cfg, '..'), { recursive: true, force: true });
});

const busDir = () => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'tool-out-bus-'));
const spill = (session: string, name = 'out.txt', slug = '-work') => {
  const dir = join(cfg, 'projects', slug, session, 'tool-results');
  mkdirSync(dir, { recursive: true });
  const f = join(dir, name);
  writeFileSync(f, 'big output');
  return f;
};
const read = (p: PolicyEngine, file: string, tool = 'Read') =>
  p.decide(tool, tool === 'Read' ? { file_path: file } : { path: file, pattern: 'x' });

describe('a role reads the persisted tool output of its own sessions', () => {
  it('is refused before the session is known and allowed after, for any slug', async () => {
    const p = new PolicyEngine('coder', {}, new OrgBus('o', 'r', busDir()), work);
    const f = spill('sess-a');
    expect((await read(p, f)).behavior).toBe('deny');
    p.noteSessionId('sess-a');
    expect((await read(p, f)).behavior).toBe('allow');
    expect((await read(p, spill('sess-a', 'x.txt', '-some-other-cwd'))).behavior).toBe('allow');
  });

  it('is allowed to a role whose read scope is narrow', async () => {
    const p = new PolicyEngine('writer', { fileRead: ['docs/**'] }, new OrgBus('o', 'r', busDir()), work);
    p.noteSessionId('sess-a');
    expect((await read(p, spill('sess-a'))).behavior).toBe('allow');
    expect((await read(p, join(work, 'src/a.ts'))).behavior).toBe('deny');
  });

  it('covers Glob and Grep of the directory, not only Read', async () => {
    const p = new PolicyEngine('coder', {}, new OrgBus('o', 'r', busDir()), work);
    p.noteSessionId('sess-a');
    const dir = join(cfg, 'projects', '-work', 'sess-a', 'tool-results');
    mkdirSync(dir, { recursive: true });
    expect((await p.decide('Grep', { path: dir, pattern: 'x' })).behavior).toBe('allow');
    expect((await p.decide('Glob', { path: dir, pattern: '*' })).behavior).toBe('allow');
  });
});

describe('and only those', () => {
  it("another session's output stays refused", async () => {
    const p = new PolicyEngine('coder', {}, new OrgBus('o', 'r', busDir()), work);
    p.noteSessionId('sess-a');
    const other = spill('sess-b');
    const d = await read(p, other);
    expect(d.behavior).toBe('deny');
    expect((d as { message: string }).message).toMatch(/escapes every root/);
  });

  it('a path that climbs out of the own session directory into another is refused', async () => {
    const p = new PolicyEngine('coder', {}, new OrgBus('o', 'r', busDir()), work);
    p.noteSessionId('sess-a');
    spill('sess-a');
    const other = spill('sess-b');
    const sneaky = join(cfg, 'projects', '-work', 'sess-a', 'tool-results', '..', '..', 'sess-b', 'tool-results', 'out.txt');
    expect(other).toContain('sess-b');
    expect((await read(p, sneaky)).behavior).toBe('deny');
  });

  it('the transcript and every other file of the own session directory stay refused', async () => {
    const p = new PolicyEngine('coder', {}, new OrgBus('o', 'r', busDir()), work);
    p.noteSessionId('sess-a');
    spill('sess-a');
    const transcript = join(cfg, 'projects', '-work', 'sess-a.jsonl');
    writeFileSync(transcript, '{}');
    const sibling = join(cfg, 'projects', '-work', 'sess-a', 'notes.txt');
    writeFileSync(sibling, 'x');
    expect((await read(p, transcript)).behavior).toBe('deny');
    expect((await read(p, sibling)).behavior).toBe('deny');
  });

  it('is never a write, and not a lookalike directory outside the config dir', async () => {
    const p = new PolicyEngine('coder', {}, new OrgBus('o', 'r', busDir()), work);
    p.noteSessionId('sess-a');
    const f = spill('sess-a');
    expect((await p.decide('Write', { file_path: f, content: 'x' })).behavior).toBe('deny');
    expect((await p.decide('Edit', { file_path: f, old_string: 'a', new_string: 'b' })).behavior).toBe('deny');
    const lookalike = join(work, 'projects', '-work', 'sess-a', 'tool-results', 'o.txt');
    mkdirSync(join(work, 'projects', '-work', 'sess-a', 'tool-results'), { recursive: true });
    writeFileSync(lookalike, 'x');
    expect((await read(p, lookalike)).behavior).toBe('allow'); // inside the workdir: allowed as any workdir file
    const outside = join(cfg, '..', 'elsewhere', 'projects', '-work', 'sess-a', 'tool-results', 'o.txt');
    mkdirSync(join(cfg, '..', 'elsewhere', 'projects', '-work', 'sess-a', 'tool-results'), { recursive: true });
    writeFileSync(outside, 'x');
    expect((await read(p, outside)).behavior).toBe('deny');
  });
});

describe('a session tells its policy which id it owns', () => {
  it('the id reported by the runner makes that session\'s tool output readable', async () => {
    const bus = new OrgBus('o', 'r', busDir());
    const policy = new PolicyEngine('coder', {}, bus, work);
    const mailbox = new Mailbox();
    mailbox.push('m0');
    const fakeQuery = ({ prompt }: any) =>
      (async function* () {
        await prompt[Symbol.asyncIterator]().next();
        yield { type: 'system', subtype: 'init', session_id: 'sess-live' };
        yield { type: 'result', subtype: 'success', session_id: 'sess-live', usage: { input_tokens: 0, output_tokens: 0 } };
        mailbox.close();
      })();
    await runAgentSession({
      org: 'o',
      role: { id: 'coder', title: 'Coder', type: 'specialist', reports_to: 'boss', responsibilities: [] } as any,
      bus,
      policy,
      mailbox,
      cwd: work,
      deliver: async () => 'delivered',
      queryFn: fakeQuery as any,
    } as any);
    expect((await read(policy, spill('sess-live'))).behavior).toBe('allow');
    expect((await read(policy, spill('sess-other'))).behavior).toBe('deny');
  });
});
