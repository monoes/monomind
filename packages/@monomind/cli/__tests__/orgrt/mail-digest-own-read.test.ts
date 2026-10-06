// A sections org digests a long message: the recipient gets the first 1 KB inline and a pointer to the full text
// in `<orgDir>/mail/<recipient>/<id>.md`. Found in the growth-org test run (2026-10-06): brand-reviewer's 5 KB
// review reached content-writer cut after item 1, and content-writer's Read of the pointed-to file was refused
// ("outside read scope") because its fileRead allowlist did not include the org's mail directory, so the review
// had to be resent. A role may read ITS OWN digests, and only those: never another role's directory, never a
// write, never something outside the directory (a link out, a sibling with the same prefix).
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OrgBus } from '../../src/orgrt/bus.js';
import { mailDirFor } from '../../src/orgrt/documents/mail-isolation.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import { Mailbox } from '../../src/orgrt/mailbox.js';
import { runAgentSession } from '../../src/orgrt/session.js';
import { validSectionsRaw } from './support/sections-defs.js';

let base: string;
let orgDir: string;
let work: string;
beforeEach(() => {
  base = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'mail-own-'));
  orgDir = join(base, '.monomind', 'orgs', 'o');
  work = join(base, 'work');
  mkdirSync(work, { recursive: true });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const digest = (role: string, id = 'm1') => {
  const dir = mailDirFor(orgDir, role);
  mkdirSync(dir, { recursive: true });
  const f = join(dir, `${id}.md`);
  writeFileSync(f, 'the full review');
  return f;
};
const engine = () => new PolicyEngine('writer', { fileRead: ['docs/**'] }, new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'mo-bus-'))), work);
const read = (p: PolicyEngine, file: string, tool = 'Read') =>
  p.decide(tool, tool === 'Read' ? { file_path: file } : { path: file, pattern: 'x' });

describe('a role reads the full text of the long messages digested for it', () => {
  it('is refused before the directory is granted and allowed after, with a narrow read scope', async () => {
    const p = engine();
    const f = digest('writer');
    expect((await read(p, f)).behavior).toBe('deny');
    p.noteOwnMailDir(mailDirFor(orgDir, 'writer'));
    expect((await read(p, f)).behavior).toBe('allow');
    expect((await read(p, f, 'Grep')).behavior).toBe('allow');
  });

  it("never opens another role's digests, a write, or a path outside the directory", async () => {
    const p = engine();
    p.noteOwnMailDir(mailDirFor(orgDir, 'writer'));
    expect((await read(p, digest('reviewer'))).behavior).toBe('deny'); // another role's directory
    expect((await read(p, digest('writer-2'))).behavior).toBe('deny'); // shared-prefix sibling
    const own = digest('writer', 'm2');
    expect((await p.decide('Write', { file_path: own, content: 'x' })).behavior).toBe('deny');
    expect((await p.decide('Edit', { file_path: own, old_string: 'a', new_string: 'b' })).behavior).toBe('deny');
    const secret = join(base, 'secret.txt');
    writeFileSync(secret, 'nope');
    symlinkSync(secret, join(mailDirFor(orgDir, 'writer'), 'link.md'));
    expect((await read(p, join(mailDirFor(orgDir, 'writer'), 'link.md'))).behavior).toBe('deny');
  });
});

describe('a sections session tells its policy which digest directory is its own', () => {
  it('makes the role’s own digests readable and no other role’s', async () => {
    const def: any = validSectionsRaw();
    const bus = new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'mo-bus-')));
    const policy = new PolicyEngine('researcher', { fileRead: ['docs/**'] }, bus, work);
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
      role: def.roles.find((r: any) => r.id === 'researcher'),
      def,
      orgDir,
      bus,
      policy,
      mailbox,
      cwd: work,
      deliver: async () => 'delivered',
      queryFn: fakeQuery as any,
    } as any);
    expect((await read(policy, digest('researcher'))).behavior).toBe('allow');
    expect((await read(policy, digest('coder'))).behavior).toBe('deny');
  });
});
