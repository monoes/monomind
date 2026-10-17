// A role's large tool results are saved under `<orgDir>/tool-results/<role>/` and
// the transcript keeps a 1.5 KB digest that points there. Found in the reputation-panel
// runs (2026-10-17): every web role had an explicit narrow fileRead, so its Read of the
// saved page was refused ("outside read scope") and it worked from the first 1.5 KB of
// each page. A role may read ITS OWN saved results, and only those: never another role's
// folder, never a write, never something outside the folder (a link out, a sibling).
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { runAgentSession } from '../../src/orgrt/session.js';
import { toolSpillDirFor } from '../../src/orgrt/tool-spill.js';

let base: string;
let orgDir: string;
let work: string;
beforeEach(() => {
  base = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'spill-own-'));
  orgDir = join(base, '.monomind', 'orgs', 'o');
  work = join(base, 'work');
  mkdirSync(work, { recursive: true });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const saved = (role: string, name = 'toolu_1.txt') => {
  const dir = toolSpillDirFor(orgDir, role);
  mkdirSync(dir, { recursive: true });
  const f = join(dir, name);
  writeFileSync(f, 'the full page');
  return f;
};
const engine = () =>
  new PolicyEngine(
    'collector',
    { fileRead: ['work/**'] },
    new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'mo-bus-'))),
    work,
  );
const read = (p: PolicyEngine, file: string, tool = 'Read') =>
  p.decide(tool, tool === 'Read' ? { file_path: file } : { path: file, pattern: 'x' });

describe('toolSpillDirFor', () => {
  it('is <base>/tool-results/<role>, with the role id made path-safe', () => {
    expect(toolSpillDirFor('/s', 'collector-negative')).toBe('/s/tool-results/collector-negative');
    expect(toolSpillDirFor('/s', 'a/b c')).toBe('/s/tool-results/a_b_c');
  });
});

describe('a role reads the full text of its own saved tool results', () => {
  it('is refused before the folder is granted and allowed after, with a narrow read scope', async () => {
    const p = engine();
    const f = saved('collector');
    expect((await read(p, f)).behavior).toBe('deny');
    p.noteOwnToolSpillDir(toolSpillDirFor(orgDir, 'collector'));
    expect((await read(p, f)).behavior).toBe('allow');
    expect((await read(p, f, 'Grep')).behavior).toBe('allow');
  });

  it("never opens another role's folder, a write, or a path outside the folder", async () => {
    const p = engine();
    p.noteOwnToolSpillDir(toolSpillDirFor(orgDir, 'collector'));
    expect((await read(p, saved('reviewer'))).behavior).toBe('deny'); // another role's folder
    expect((await read(p, saved('collector-2'))).behavior).toBe('deny'); // shared-prefix sibling
    const own = saved('collector', 'toolu_2.txt');
    expect((await p.decide('Write', { file_path: own, content: 'x' })).behavior).toBe('deny');
    expect(
      (await p.decide('Edit', { file_path: own, old_string: 'a', new_string: 'b' })).behavior,
    ).toBe('deny');
    const secret = join(base, 'secret.txt');
    writeFileSync(secret, 'nope');
    const link = join(toolSpillDirFor(orgDir, 'collector'), 'link.txt');
    symlinkSync(secret, link);
    expect((await read(p, link)).behavior).toBe('deny');
  });
});

describe('a session tells its policy which saved-results folder is its own', () => {
  it("makes the role's own saved results readable and no other role's", async () => {
    const bus = new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'mo-bus-')));
    const policy = new PolicyEngine('collector', { fileRead: ['work/**'] }, bus, work);
    const mailbox = new Mailbox();
    mailbox.push('m0');
    const fakeQuery = ({ prompt }: any) =>
      (async function* () {
        await prompt[Symbol.asyncIterator]().next();
        yield { type: 'system', subtype: 'init', session_id: 'sess-live' };
        yield {
          type: 'result',
          subtype: 'success',
          session_id: 'sess-live',
          usage: { input_tokens: 0, output_tokens: 0 },
        };
        mailbox.close();
      })();
    await runAgentSession({
      org: 'o',
      role: {
        id: 'collector',
        title: 'C',
        type: 'specialist',
        reports_to: 'boss',
        responsibilities: [],
      } as any,
      orgDir,
      bus,
      policy,
      mailbox,
      cwd: work,
      deliver: async () => 'delivered',
      queryFn: fakeQuery as any,
    } as any);
    expect((await read(policy, saved('collector'))).behavior).toBe('allow');
    expect((await read(policy, saved('reviewer'))).behavior).toBe('deny');
  });
});
