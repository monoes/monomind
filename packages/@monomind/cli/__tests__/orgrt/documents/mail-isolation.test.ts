// packages/@monomind/cli/__tests__/orgrt/documents/mail-isolation.test.ts
// GA row R3 (spec 9.3, 6.1 mail-digest row): in a sections org a long message
// body is digested into a daemon-owned per-recipient directory, and every other
// role is denied reading it at the file-tool, SDK-sandbox and authority-mask
// layers. An org without sections keeps today's `<workdir>/.mail` layout.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OrgDaemon } from '../../../src/orgrt/daemon.js';
import { mailBody } from '../../../src/orgrt/cross-org-mail.js';
import {
  ensureMailDirs,
  mailDirFor,
  otherMailDirs,
} from '../../../src/orgrt/documents/mail-isolation.js';
import { prepareGitGuard } from '../../../src/orgrt/git-guard.js';
import { buildClaudeRestrictions } from '../../../src/orgrt/role-sandbox.js';
import { sectionsRaw } from '../support/sections-defs.js';

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'mail-iso-'));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const BIG = 'x'.repeat(5000);
const orgDirOf = () => join(base, '.monomind/orgs/sec-org');

describe('mail directory layout', () => {
  it('has one directory per recipient under <orgDir>/mail', () => {
    expect(mailDirFor('/o', 'researcher')).toBe('/o/mail/researcher');
    expect(mailDirFor('/o', 'a/../b')).toBe('/o/mail/a_.._b');
  });

  it('lists every OTHER role of a sections org, and nothing for an org without sections', () => {
    const def = sectionsRaw() as any;
    const others = otherMailDirs(def, '/o', 'coder');
    expect(others).toContain('/o/mail/boss');
    expect(others).toContain('/o/mail/researcher');
    expect(others).not.toContain('/o/mail/coder');
    expect(others).toHaveLength(def.roles.length - 1);
    const legacy = { name: 'l', goal: 'g', roles: def.roles };
    expect(otherMailDirs(legacy as any, '/o', 'coder')).toEqual([]);
  });

  it('ensureMailDirs creates a directory per role and is idempotent', () => {
    const def = sectionsRaw() as any;
    ensureMailDirs(def, orgDirOf());
    ensureMailDirs(def, orgDirOf());
    for (const r of def.roles) expect(existsSync(mailDirFor(orgDirOf(), r.id))).toBe(true);
    const legacy = { name: 'l', goal: 'g', roles: def.roles };
    ensureMailDirs(legacy as any, join(base, 'other'));
    expect(existsSync(join(base, 'other'))).toBe(false);
  });
});

describe('mailBody', () => {
  const org = (def: unknown) => ({ def, workdir: join(base, 'work') }) as any;

  it('digests into the recipient directory for a sections org', () => {
    const text = mailBody(base, 'sec-org', org(sectionsRaw()), '[h]', BIG, 'm-1', 'coder');
    const file = join(mailDirFor(orgDirOf(), 'coder'), 'm-1.md');
    expect(readFileSync(file, 'utf8')).toBe(BIG);
    expect(text).toContain(file);
    expect(existsSync(join(base, 'work', '.mail'))).toBe(false);
  });

  it('keeps <workdir>/.mail for an org without sections, and short bodies inline', () => {
    const legacy = { name: 'l', goal: 'g', roles: (sectionsRaw() as any).roles };
    const text = mailBody(base, 'l', org(legacy), '[h]', BIG, 'm-2', 'coder');
    expect(existsSync(join(base, 'work', '.mail', 'm-2.md'))).toBe(true);
    expect(text).toContain(join(base, 'work', '.mail', 'm-2.md'));
    expect(mailBody(base, 'sec-org', org(sectionsRaw()), '[h]', 'short', 'm-3', 'coder')).toBe('[h]\n\nshort');
  });
});

describe('read denial of other roles\' digests', () => {
  function restrictions(extra?: string[]) {
    const guard = prepareGitGuard({ level: 'read', stateDir: join(base, 'guard'), protectedGitDirs: [] }) as any;
    return buildClaudeRestrictions(
      guard,
      undefined,
      { cwd: base, orgRoot: base, home: join(base, 'home'), tmp: base, env: {}, denyReadDirs: extra },
      true,
    );
  }

  it('denies the file tools and the SDK sandbox the listed directories', () => {
    const def = sectionsRaw() as any;
    ensureMailDirs(def, orgDirOf());
    const dirs = otherMailDirs(def, orgDirOf(), 'coder');
    const r = restrictions(dirs);
    const sb = r.sandbox as any;
    for (const d of dirs) {
      expect(r.disallowedTools).toContain(`Read(/${d}/**)`);
      expect(sb.filesystem.denyRead).toContain(d);
    }
    expect(r.disallowedTools).not.toContain(`Read(/${mailDirFor(orgDirOf(), 'coder')}/**)`);
  });

  it('changes nothing without directories', () => {
    restrictions(undefined); // the first call creates a deps directory the later ones see
    expect(restrictions(undefined)).toEqual(restrictions([]));
  });
});

describe('a sections org session (real daemon)', () => {
  it('starts the boss with the other roles\' digest directories denied, and not its own', async () => {
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
      const orgDir = join(root, '.monomind/orgs/sec-org');
      expect(tools).toContain(`Read(/${mailDirFor(orgDir, 'coder')}/**)`);
      expect(tools).toContain(`Read(/${mailDirFor(orgDir, 'researcher')}/**)`);
      expect(tools).not.toContain(`Read(/${mailDirFor(orgDir, 'boss')}/**)`);
    } finally {
      await d.stopAll().catch(() => {});
    }
  });
});
