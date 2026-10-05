// packages/@monomind/cli/__tests__/orgrt/documents/mail-integrity.test.ts
// GA row R4 (spec 9.3; 6.1 mail-digest row): digests are daemon-written,
// immutable files whose content hash is recorded BEFORE delivery. No agent may
// write, overwrite, delete, rename or symlink over them (file tools, SDK
// sandbox, authority mask), and a missing or altered digest is a delivery-
// integrity blocker, never mail under the sender's envelope.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OrgBus } from '../../../src/orgrt/bus.js';
import { OrgDaemon } from '../../../src/orgrt/daemon.js';
import { pushMessage } from '../../../src/orgrt/cross-org-mail.js';
import { roleExecMask } from '../../../src/orgrt/exec-deny.js';
import { DigestIntegrityError, digestJournalPath, writeDigest } from '../../../src/orgrt/documents/mail-integrity.js';
import { mailDirFor, mailRootFor } from '../../../src/orgrt/documents/mail-isolation.js';
import { prepareGitGuard } from '../../../src/orgrt/git-guard.js';
import { buildClaudeRestrictions } from '../../../src/orgrt/role-sandbox.js';
import { sectionsRaw } from '../support/sections-defs.js';

let base: string;
let orgDir: string;
beforeEach(() => {
  base = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'mail-int-'));
  orgDir = join(base, '.monomind/orgs/sec-org');
  mkdirSync(mailDirFor(orgDir, 'coder'), { recursive: true });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const journal = () =>
  existsSync(digestJournalPath(orgDir))
    ? readFileSync(digestJournalPath(orgDir), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];

describe('writeDigest', () => {
  it('writes a read-only file and records its sha256 in the journal', () => {
    const file = writeDigest(orgDir, 'coder', 'm-1', 'hello body');
    expect(file).toBe(join(mailDirFor(orgDir, 'coder'), 'm-1.md'));
    expect(readFileSync(file, 'utf8')).toBe('hello body');
    expect(statSync(file).mode & 0o222).toBe(0);
    expect(journal()).toEqual([
      expect.objectContaining({ id: 'm-1', to: 'coder', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }),
    ]);
  });

  it('a retry with identical content is accepted and adds no second entry', () => {
    writeDigest(orgDir, 'coder', 'm-1', 'body');
    writeDigest(orgDir, 'coder', 'm-1', 'body');
    expect(journal()).toHaveLength(1);
  });

  it('the same id with different content is refused', () => {
    writeDigest(orgDir, 'coder', 'm-1', 'body');
    expect(() => writeDigest(orgDir, 'coder', 'm-1', 'other body')).toThrow(DigestIntegrityError);
  });

  it('an altered file is refused on the next delivery', () => {
    const file = writeDigest(orgDir, 'coder', 'm-1', 'body');
    chmodSync(file, 0o644);
    writeFileSync(file, 'tampered');
    expect(() => writeDigest(orgDir, 'coder', 'm-1', 'body')).toThrow(/altered/);
  });

  it('a deleted file is refused, not silently rewritten', () => {
    const file = writeDigest(orgDir, 'coder', 'm-1', 'body');
    unlinkSync(file);
    expect(() => writeDigest(orgDir, 'coder', 'm-1', 'body')).toThrow(/missing/);
  });

  it('a symlink put where the file belongs is not followed', () => {
    const target = join(base, 'elsewhere.txt');
    writeFileSync(target, 'victim');
    symlinkSync(target, join(mailDirFor(orgDir, 'coder'), 'm-2.md'));
    expect(() => writeDigest(orgDir, 'coder', 'm-2', 'body')).toThrow(DigestIntegrityError);
    expect(readFileSync(target, 'utf8')).toBe('victim');
  });
});

describe('delivery of a tampered digest', () => {
  function fakeOrg() {
    const pushed: string[] = [];
    const events: any[] = [];
    const bus = new OrgBus('sec-org', 'r', join(base, 'bus'));
    bus.subscribe((e) => events.push(e));
    const org: any = {
      def: sectionsRaw(),
      bus,
      workdir: base,
      agents: new Map([['coder', { mailbox: { isClosed: false, push: (m: string) => pushed.push(m) } }]]),
    };
    return { org, pushed, events };
  }
  const daemon = { get root() { return base; } } as unknown as OrgDaemon;
  const BIG = 'y'.repeat(5000);

  it('delivers a long body as a digest the first time', async () => {
    const { org, pushed } = fakeOrg();
    expect(await pushMessage(daemon, 'sec-org', org, 'coder', 'boss', 's', BIG, 'm-1')).toBe(true);
    expect(pushed[0]).toContain('full text at');
  });

  it('delivers a blocker, not the digest, when the file was altered, and audits it', async () => {
    const { org, pushed, events } = fakeOrg();
    await pushMessage(daemon, 'sec-org', org, 'coder', 'boss', 's', BIG, 'm-1');
    const file = join(mailDirFor(orgDir, 'coder'), 'm-1.md');
    chmodSync(file, 0o644);
    writeFileSync(file, 'tampered');
    expect(await pushMessage(daemon, 'sec-org', org, 'coder', 'boss', 's', BIG, 'm-1')).toBe(true);
    expect(pushed[1]).toMatch(/delivery-integrity blocker/);
    expect(pushed[1]).not.toContain('tampered');
    expect(pushed[1]).not.toContain('message from boss');
    expect(events.some((e) => e.type === 'audit' && e.reason === 'mail-integrity-blocker')).toBe(true);
  });
});

describe('write denial', () => {
  const guard = () => prepareGitGuard({ level: 'read', stateDir: join(base, 'guard'), protectedGitDirs: [] }) as any;

  it('denies file-tool edits and SDK-sandbox writes under the mail root, own directory included', () => {
    const root = mailRootFor(orgDir);
    const r = buildClaudeRestrictions(
      guard(),
      undefined,
      { cwd: base, orgRoot: base, home: join(base, 'home'), tmp: base, env: {}, denyWriteDirs: [root] },
      true,
    );
    expect(r.disallowedTools).toContain(`Edit(/${root}/**)`);
    expect((r.sandbox as any).filesystem.denyWrite).toContain(root);
  });

  it('adds nothing without directories', () => {
    const mk = (d?: string[]) =>
      buildClaudeRestrictions(guard(), undefined, { cwd: base, orgRoot: base, home: join(base, 'home'), tmp: base, env: {}, denyWriteDirs: d }, true);
    mk();
    expect(mk(undefined)).toEqual(mk([]));
  });

  it('the mask binds the mail root read-only when bubblewrap works, and audits when it does not', () => {
    const root = mailRootFor(orgDir);
    mkdirSync(root, { recursive: true });
    const events: any[] = [];
    const bus = new OrgBus('o', 'r', join(base, 'bus2'));
    bus.subscribe((e) => events.push(e));
    const mk = (available: boolean) =>
      roleExecMask({
        bus,
        roleId: 'coder',
        authorityMask: ['--dev-bind', '/', '/'],
        bestEffortReadOnly: [root],
        home: join(base, 'home'),
        env: {},
        availability: { available, reason: 'none' },
      } as any);
    const real = realpathSync(root);
    expect(mk(true)).toEqual(expect.arrayContaining(['--ro-bind', real, real]));
    expect(mk(false)).toEqual(['--dev-bind', '/', '/']);
    expect(events.some((e) => e.reason === 'mail-mask-unavailable')).toBe(true);
  });

  it('a real sections session carries the denial', async () => {
    const root = join(base, 'proj');
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    writeFileSync(join(root, '.monomind/orgs/sec-org.json'), JSON.stringify(sectionsRaw()));
    const seen: any[] = [];
    const queryFn = ({ prompt, options }: any) =>
      (async function* () {
        seen.push(options);
        for await (const m of prompt) {
          yield { type: 'assistant', message: { content: [{ type: 'text', text: `echo: ${m.message.content}` }] } };
          yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
        }
      })();
    const d = new OrgDaemon(root, { queryFn: queryFn as any, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
    try {
      await d.startOrg('sec-org', undefined, { evalGate: true });
      for (let i = 0; i < 200 && seen.length === 0; i++) await new Promise((r) => setTimeout(r, 25));
      const tools: string[] = seen[0].disallowedTools;
      expect(tools).toContain(`Edit(/${mailRootFor(join(root, '.monomind/orgs/sec-org'))}/**)`);
    } finally {
      await d.stopAll().catch(() => {});
    }
  });
});
