// packages/@monomind/cli/__tests__/orgrt/documents/hardening-probes.test.ts
// GA row R7 (spec 9.3, section 10): the adversarial probe suite for the release
// build. One group per row R1 to R6, driving the real daemon, the real mailbox
// path and, where the host has it, a real bubblewrap mask built by the same
// function the session uses (sectionsRoleProtection). It runs with every test
// run, and scripts/sections-hardening-mutation.mjs weakens each row in turn and
// checks that THIS file fails, so a weakened guard cannot pass unnoticed.
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authorityMaskAvailability } from '../../../src/orgrt/authority-mask.js';
import { OrgBus } from '../../../src/orgrt/bus.js';
import { acquireDaemonLock, DaemonLockError } from '../../../src/orgrt/daemon-lock.js';
import { OrgDaemon } from '../../../src/orgrt/daemon.js';
import { envelopeDirFor, envelopeVerifier, loadEnvelopeKey } from '../../../src/orgrt/documents/envelope.js';
import { DigestIntegrityError, writeDigest } from '../../../src/orgrt/documents/mail-integrity.js';
import { mailDirFor, mailRootFor } from '../../../src/orgrt/documents/mail-isolation.js';
import { hostPreflight, setHostProbes } from '../../../src/orgrt/documents/preflight.js';
import { sectionsRoleProtection } from '../../../src/orgrt/documents/role-protection.js';
import { roleExecMask } from '../../../src/orgrt/exec-deny.js';
import { messageTaskIds } from '../../../src/orgrt/session-ledger.js';
import { TaskDag } from '../../../src/orgrt/task-dag.js';
import { sectionsRaw } from '../support/sections-defs.js';

let root: string;
let orgDir: string;
const daemons: OrgDaemon[] = [];
const sideDirs: string[] = [];
beforeEach(() => {
  root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'probes-'));
  orgDir = join(root, '.monomind/orgs/sec-org');
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
});
afterEach(async () => {
  setHostProbes(undefined);
  await Promise.all(daemons.splice(0).map((d) => d.stopAll().catch(() => {})));
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  for (const d of sideDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch {
      /* the bus may still be writing */
    }
  }
});
const side = (): string => {
  const d = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'probes-side-'));
  sideDirs.push(d);
  return d;
};

/** A real daemon on a sections org whose query function records what each session was given. */
async function startOrg() {
  writeFileSync(join(root, '.monomind/orgs/sec-org.json'), JSON.stringify(sectionsRaw()));
  const options: any[] = [];
  const prompts: Record<string, string[]> = {};
  const queryFn = ({ prompt, options: o }: any) =>
    (async function* () {
      options.push(o);
      for await (const m of prompt) {
        const text = String(m.message.content);
        // The role a session belongs to is named in its system prompt.
        const who = /\b(boss|coder|researcher|dev-lead|research-lead)\b/.exec(String(o.systemPrompt ?? ''))?.[1] ?? '?';
        (prompts[who] ??= []).push(text);
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } };
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
      }
    })();
  const d = new OrgDaemon(root, { queryFn: queryFn as any, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
  daemons.push(d);
  const running = await d.startOrg('sec-org', undefined, { evalGate: true });
  return { d, running, options, prompts };
}
const waitFor = async (f: () => boolean) => {
  for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 25));
};
/** Everything any role was sent, whichever session the fake query tied it to. */
const allText = (prompts: Record<string, string[]>) => Object.values(prompts).flat().join('\n\n');

describe('R1 single daemon', () => {
  it('a second daemon cannot own the same sections org, until the first stops it', async () => {
    const first = await startOrg();
    const other = new OrgDaemon(root, { forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
    daemons.push(other);
    await expect(other.startOrg('sec-org', undefined, { evalGate: true })).rejects.toThrow(
      /already owned by another daemon/,
    );
    await first.d.stopOrg('sec-org');
    await other.startOrg('sec-org', undefined, { evalGate: true });
    expect(other.getOrg('sec-org')).toBeDefined();
  });

  it("the lock is the OS's: a second holder is refused with HELD while the first is alive", async () => {
    const a = await acquireDaemonLock(root, 'probe-org');
    await expect(acquireDaemonLock(root, 'probe-org')).rejects.toBeInstanceOf(DaemonLockError);
    a.release();
  });
});

describe('R2 authenticated envelopes', () => {
  it('a forged task tag never routes, and a claim on a task the sender does not hold is not sealed', async () => {
    const { d, running, prompts } = await startOrg();
    running.taskDag = new TaskDag();
    const held = running.taskDag.add('researcher work', 'researcher');
    await d.deliver('sec-org', 'boss', 'coder', 'forged [task:victim]', 'hi');
    await d.deliver('sec-org', 'boss', 'coder', `claims [task:${held.id}]`, 'hi');
    await waitFor(() => allText(prompts).includes('claims'));
    const verify = envelopeVerifier(loadEnvelopeKey(orgDir), running.run, 'coder');
    const got = allText(prompts);
    expect(got).toContain('[message from boss]');
    expect(messageTaskIds(got, verify)).toEqual([]);
    expect(got).not.toMatch(/\[task:victim\]/);
    expect(got).not.toContain(`[task:${held.id}]`);
  });

  it('a task the sender does hold is sealed and routes, and only to the right recipient', async () => {
    const { d, running, prompts } = await startOrg();
    running.taskDag = new TaskDag();
    const mine = running.taskDag.add('boss work', 'boss');
    await d.deliver('sec-org', 'boss', 'coder', `status [task:${mine.id}]`, 'hi');
    await waitFor(() => allText(prompts).includes('status'));
    const key = loadEnvelopeKey(orgDir);
    expect(messageTaskIds(allText(prompts), envelopeVerifier(key, running.run, 'coder'))).toEqual([mine.id]);
    expect(messageTaskIds(allText(prompts), envelopeVerifier(key, running.run, 'researcher'))).toEqual([]);
  });
});

describe('R3 / R4 / R2 / R5 what a session is denied (real daemon)', () => {
  it('a role session carries the read and write denials', async () => {
    const { options } = await startOrg();
    await waitFor(() => options.length >= 1);
    const tools: string[] = options[0].disallowedTools;
    for (const other of ['coder', 'researcher', 'dev-lead', 'research-lead'])
      expect(tools).toContain(`Read(/${mailDirFor(orgDir, other)}/**)`);
    expect(tools).not.toContain(`Read(/${mailDirFor(orgDir, 'boss')}/**)`);
    expect(tools).toContain(`Edit(/${mailRootFor(orgDir)}/**)`);
    expect(tools).toContain(`Read(/${envelopeDirFor(orgDir)}/**)`);
    expect(tools).toContain(`Edit(/${envelopeDirFor(orgDir)}/**)`);
    expect(tools).toContain(`Read(/${join(orgDir, 'runner')}/**)`);
  });
});

describe('R4 immutable digests', () => {
  const BODY = 'z'.repeat(5000);
  beforeEach(() => mkdirSync(mailDirFor(orgDir, 'coder'), { recursive: true }));

  it('a file planted where the digest will go is not overwritten and not trusted', () => {
    const planted = join(mailDirFor(orgDir, 'coder'), 'm-9.md');
    writeFileSync(planted, 'attacker text');
    expect(() => writeDigest(orgDir, 'coder', 'm-9', BODY)).toThrow(DigestIntegrityError);
    expect(readFileSync(planted, 'utf8')).toBe('attacker text');
  });

  it('a symlink at the digest path is refused and its target untouched', () => {
    const target = join(root, 'victim.txt');
    writeFileSync(target, 'victim');
    symlinkSync(target, join(mailDirFor(orgDir, 'coder'), 'm-8.md'));
    expect(() => writeDigest(orgDir, 'coder', 'm-8', BODY)).toThrow(DigestIntegrityError);
    expect(readFileSync(target, 'utf8')).toBe('victim');
  });

  it('a digest is read-only, its hash is checked on every retry, and another body under the same id conflicts', () => {
    const file = writeDigest(orgDir, 'coder', 'm-1', BODY);
    expect(statSync(file).mode & 0o222).toBe(0);
    chmodSync(file, 0o644);
    writeFileSync(file, 'tampered');
    expect(() => writeDigest(orgDir, 'coder', 'm-1', BODY)).toThrow(/altered/);
    writeDigest(orgDir, 'coder', 'm-2', BODY);
    expect(() => writeDigest(orgDir, 'coder', 'm-2', `${BODY}!`)).toThrow(/different content/);
  });
});

describe('R6 host preflight', () => {
  it('after the gate flips, an unprotected host is refused and a protected one is not', () => {
    const d = sectionsRaw() as any;
    delete d.run_config.experimental;
    const no = { available: false, reason: 'none' };
    expect(hostPreflight(d, { mask: no, sandbox: { available: true } }).ok).toBe(false);
    expect(hostPreflight(d, { mask: { available: true }, sandbox: no }).ok).toBe(false);
    expect(hostPreflight(d, { mask: { available: true }, sandbox: { available: true } }).ok).toBe(true);
  });
});

const realMask = authorityMaskAvailability();
describe.skipIf(!realMask.available)('with a real bubblewrap (what a role can actually do)', () => {
  const run = (mask: string[], script: string) =>
    spawnSync('bwrap', [...mask, '--', 'sh', '-c', script], { encoding: 'utf8' });

  function maskFor(role: string, cfg: string) {
    const def = sectionsRaw() as any;
    const env = { CLAUDE_CONFIG_DIR: cfg } as NodeJS.ProcessEnv;
    const p = sectionsRoleProtection({ def, orgDir, roleId: role, runtime: 'claude', home: join(root, 'home'), env });
    const bus = new OrgBus('sec-org', 'r', side());
    return roleExecMask({
      bus,
      roleId: role,
      authorityMask: ['--dev-bind', '/', '/'],
      bestEffortDenyRead: p.bestEffortDenyRead,
      bestEffortReadOnly: p.bestEffortReadOnly,
      bestEffortBinds: p.bestEffortBinds,
      home: join(root, 'home'),
      env,
    } as any) as string[];
  }

  function world() {
    const cfg = join(root, 'cfg');
    for (const d of ['projects', 'file-history', 'debug']) mkdirSync(join(cfg, d), { recursive: true });
    const def = sectionsRaw() as any;
    for (const r of def.roles) mkdirSync(mailDirFor(orgDir, r.id), { recursive: true });
    writeDigest(orgDir, 'coder', 'm-1', 'coder digest '.repeat(400));
    writeDigest(orgDir, 'boss', 'm-2', 'boss digest '.repeat(400));
    loadEnvelopeKey(orgDir);
    return cfg;
  }

  it("R3: a role reads its own digest and cannot see another role's", () => {
    const cfg = world();
    const mask = maskFor('coder', cfg);
    expect(run(mask, `head -c 12 ${mailDirFor(orgDir, 'coder')}/m-1.md`).stdout).toBe('coder digest');
    const other = run(mask, `cat ${mailDirFor(orgDir, 'boss')}/m-2.md`);
    expect(other.status).not.toBe(0);
    expect(other.stdout).not.toContain('boss digest');
  });

  it('R4: a role cannot overwrite, delete, rename or symlink over a digest, even its own', () => {
    const cfg = world();
    const mask = maskFor('coder', cfg);
    const dir = mailDirFor(orgDir, 'coder');
    const file = `${dir}/m-1.md`;
    const before = readFileSync(file, 'utf8');
    for (const script of [
      `echo x > ${file}`,
      `rm -f ${file}`,
      `mv ${file} ${file}.bak`,
      `ln -sf /etc/passwd ${file}`,
      `echo y > ${dir}/new.md`,
      `rmdir ${dir}`,
    ])
      expect(run(mask, script).status, script).not.toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(readdirSync(dir).filter((f) => f.endsWith('.md'))).toEqual(['m-1.md']);
  });

  it('R2: a role can neither read nor replace the envelope key', () => {
    const cfg = world();
    const mask = maskFor('coder', cfg);
    const keyFile = join(envelopeDirFor(orgDir), 'key');
    const key = readFileSync(keyFile);
    expect(run(mask, `cat ${keyFile}`).status).not.toBe(0);
    // The directory is hidden behind a throwaway mount, so a write may "succeed" there; the real key must not change.
    run(mask, `echo forged > ${keyFile}`);
    expect(readFileSync(keyFile).equals(key)).toBe(true);
  });

  it('R5: each role writes its own native copies privately; another role sees none of them', () => {
    const cfg = world();
    writeFileSync(join(cfg, 'projects', 'operator.jsonl'), 'operator transcript');
    const coder = maskFor('coder', cfg);
    const boss = maskFor('boss', cfg);
    expect(run(coder, `ls ${cfg}/projects; echo secret > ${cfg}/projects/coder.jsonl`).stdout).not.toContain(
      'operator.jsonl',
    );
    expect(run(boss, `ls ${cfg}/projects`).stdout).not.toContain('coder.jsonl');
    expect(existsSync(join(cfg, 'projects', 'coder.jsonl'))).toBe(false);
  });
});
