// packages/@monomind/cli/__tests__/orgrt/org-authority-files.test.ts
/**
 * #498: no role may write the files under `.monomind/orgs/` that control its
 * own authority or record a human's decisions — not with a file tool
 * (policy.ts), and, for existing files and the orgs dir itself, not with Bash
 * (the bubblewrap mask and the SDK sandbox). The mask cases run real bwrap.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../../../../tests/setup/tmp-track.js';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  authorityMaskArgs,
  authorityMaskAvailability,
  maskedCommand,
} from '../../src/orgrt/authority-mask.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { gitCommonDir, prepareGitGuard } from '../../src/orgrt/git-guard.js';
import {
  authorityFilePaths,
  ensureOrgWorkDirs,
  gitGuardDirs,
  isAuthorityBelowOrgs,
  isAuthorityFile,
  ORG_WORK_DIRS,
  orgsMountPoints,
} from '../../src/orgrt/org-authority-files.js';
import { PolicyEngine } from '../../src/orgrt/policy.js';
import {
  gitWriteViolation,
  normalizeSegment,
  pathSegments,
  segmentsBelow,
} from '../../src/orgrt/policy-paths.js';
import { buildClaudeRestrictions } from '../../src/orgrt/role-sandbox.js';

const scratch = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));

/** Every kind of authority file under .monomind/orgs/, and why it is one. */
const AUTHORITY = [
  'acme.json', // the org definition: every role's own policy
  'acme.yaml',
  'acme-state.json', // org artifacts beside the definition
  'acme-secrets.json',
  'acme-runstate.json',
  'acme-threads.jsonl',
  'remote-hosts.json',
  'acme/gates.json', // a human's decisions
  'acme/approvals.json',
  'acme/questions.json',
  'acme/inbox.jsonl',
  'acme/decisions.jsonl',
  'acme/runtime.json', // the resume checkpoint
  'acme/history.jsonl',
  'acme/idle-watchdog.json',
  'acme/run', // org serve's control files
  'acme/stop',
  'acme/pause',
  'acme/reload',
  'acme/run-1/bus.jsonl', // the run's event log, replayed from checkpoints
  'acme/run-1/sessions.json',
  'acme/replay-1/bus.jsonl',
  'acme/git-guard/coder/hooks/pre-push', // the hooks that enforce policy.git
  'acme-memory/runtime.json', // known names stay protected in a memory dir
  'acme-memory/run',
];
/** Paths under .monomind/orgs/ that roles legitimately write. */
const ROLE_WRITABLE = [
  'acme/reports/2.19.0/summary.md', // the release org's reports
  'acme/reports/sessions.json', // run-state names only count in a run dir
  'acme/reports/bus.jsonl',
  'acme/work/bus.jsonl',
  'acme/work/src/packages/x/src/a.ts', // task artifacts and checkouts
  'acme/work/src/.monomind/orgs/release.json', // a checkout's own org tree
  'acme/work/src/.monomind/orgs/release/gates.json',
  'acme/workspace/notes.md', // run_config.workspace: 'isolated'
  'acme/worktree/src/a.ts', // run_config.workspace: 'worktree'
  'acme/.mail/m1.md',
  'acme/run-1/scratch.txt',
  'acme-memory/tacit.md', // the org's PARA memory (mastermind-memory)
  'acme-memory/knowledge/index.md',
];

describe('isAuthorityFile (paths anchored at the org root)', () => {
  it.each(AUTHORITY)('protects %s', (f) => {
    expect(isAuthorityFile(`/p/.monomind/orgs/${f}`, '/p')).toBe(true);
  });
  it.each(ROLE_WRITABLE)('leaves %s to the roles', (f) => {
    expect(isAuthorityFile(`/p/.monomind/orgs/${f}`, '/p')).toBe(false);
  });
  it('protects nothing outside the org root', () => {
    expect(isAuthorityFile('/p/src/gates.json', '/p')).toBe(false);
    expect(isAuthorityFile('/p/.monomind/config.json', '/p')).toBe(false);
    expect(isAuthorityFile('/tmp/fixture/.monomind/orgs/t.json', '/p')).toBe(false);
    expect(isAuthorityFile('/other/.monomind/orgs/acme.json', '/p')).toBe(false);
  });
  it('treats <x>-memory as an org, not a memory dir, once <x>-memory.json exists', () => {
    const root = scratch('oa-mem-');
    mkdirSync(join(root, '.monomind/orgs/x-memory'), { recursive: true });
    const notes = join(root, '.monomind/orgs/x-memory/notes.md');
    expect(isAuthorityFile(notes, root)).toBe(false);
    writeFileSync(join(root, '.monomind/orgs/x-memory.json'), '{}');
    expect(isAuthorityFile(notes, root)).toBe(true);
  });
});

describe('case-insensitive and Windows spellings (comparator by platform)', () => {
  const memory = () => false;
  it('normalizes a segment the way each filesystem compares it', () => {
    expect(normalizeSegment('Gates.JSON', 'linux')).toBe('Gates.JSON');
    expect(normalizeSegment('Gates.JSON', 'darwin')).toBe('gates.json');
    expect(normalizeSegment('bus.jsonl::$DATA', 'win32')).toBe('bus.jsonl');
    expect(normalizeSegment('bus.jsonl:s', 'win32')).toBe('bus.jsonl');
    expect(normalizeSegment('.monomind. . ', 'win32')).toBe('.monomind');
    expect(normalizeSegment('C:', 'win32')).toBe('c:');
    expect(normalizeSegment('..', 'win32')).toBe('..');
  });

  it.each([
    ['darwin', '/P/.Monomind/ORGS/Acme/Gates.JSON', '/p'],
    ['darwin', '/p/.monomind/orgs/Acme/Run-1/Bus.jsonl', '/p'],
    ['darwin', '/p/.monomind/orgs/acme/GIT-GUARD/coder/hooks/pre-push', '/p'],
    ['win32', 'C:\\p\\.monomind.\\orgs\\release.json', 'C:\\p'],
    ['win32', 'c:\\P\\.MONOMIND\\Orgs\\acme\\run-1\\bus.jsonl::$DATA', 'C:\\p'],
    ['win32', 'C:\\p\\.monomind\\orgs\\acme\\gates.json. ', 'C:\\p'],
  ] as const)('%s: %s is an authority file', (platform, p, root) => {
    expect(isAuthorityFile(p, root, platform)).toBe(true);
  });

  it('keeps the spellings distinct where the filesystem does (linux)', () => {
    expect(isAuthorityFile('/p/.Monomind/orgs/acme.json', '/p', 'linux')).toBe(false);
    expect(isAuthorityFile('/p/.monomind/orgs/acme/run-1/Bus.jsonl', '/p', 'linux')).toBe(false);
  });

  it('classifies only what lies below the orgs dir', () => {
    expect(segmentsBelow('/p/.monomind/orgs', '/P/.MONOMIND/orgs/x', 'darwin')).toEqual(['x']);
    expect(segmentsBelow('/p/.monomind/orgs', '/P/.MONOMIND/orgs/x', 'linux')).toBeNull();
    expect(isAuthorityBelowOrgs(['acme', 'reports', 'x.md'], memory)).toBe(false);
  });

  it('applies the same comparison to the .git check', () => {
    expect(gitWriteViolation('/r/.GIT/Config', 'commit', 'darwin')).toBe('.git/config');
    expect(gitWriteViolation('/r/.GIT/Config', 'commit', 'linux')).toBeNull();
    expect(gitWriteViolation('C:\\r\\.git.\\HOOKS\\pre-push', 'commit', 'win32')).toBe(
      '.git/hooks/pre-push',
    );
    expect(gitWriteViolation('/r/.git/objects/ab', 'commit', 'linux')).toBeNull();
    expect(gitWriteViolation('/r/.git/objects/ab', 'read', 'linux')).toBe('.git/objects/ab');
    expect(gitWriteViolation('/r/.git/config', 'push', 'darwin')).toBeNull();
  });
});

/** A project whose org root holds every authority file and every
 *  role-writable path; the role's workdir is `<root>/app`. */
function orgTree() {
  const root = scratch('oa-org-');
  for (const f of [...AUTHORITY, ...ROLE_WRITABLE]) {
    const p = join(root, '.monomind/orgs', f);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, 'ORIGINAL');
  }
  mkdirSync(join(root, 'app'), { recursive: true });
  return root;
}
const engine = (root: string, policy: Record<string, unknown>, cwd = join(root, 'app')) =>
  new PolicyEngine('coder', policy as any, new OrgBus('o', 'r', scratch('oa-bus-')), cwd, [root], root);
const write = (p: PolicyEngine, file: string) =>
  p.decide('Write', { file_path: file, content: '{}' });
const edit = (p: PolicyEngine, file: string) =>
  p.decide('Edit', { file_path: file, old_string: 'ORIGINAL', new_string: 'x' });

describe('file tools cannot write authority files', () => {
  const scopes: Array<[string, (root: string) => PolicyEngine]> = [
    ["fileWrite ['../**'] from a subdir", (root) => engine(root, { fileWrite: ['../**'] })],
    ["fileWrite ['..'] (a directory scope, #493) from a subdir", (root) => engine(root, { fileWrite: ['..'] })],
    ['the default unrestricted scope at the org root', (root) => engine(root, {}, root)],
    ['a directory scope covering the org root', (root) => engine(root, { fileWrite: ['.monomind/**'] }, root)],
    ['an absolute glob over .monomind/orgs', (root) => engine(root, { fileWrite: [`${root}/.monomind/orgs/**`] })],
  ];

  it.each(scopes)('denies Write, Edit, MultiEdit and NotebookEdit on every authority file with %s', async (_, make) => {
    const root = orgTree();
    const p = make(root);
    for (const f of AUTHORITY) {
      const file = join(root, '.monomind/orgs', f);
      const w = await write(p, file);
      expect(w.behavior, `Write ${f}`).toBe('deny');
      expect((w as { message: string }).message).toMatch(/org authority state/);
      expect((await edit(p, file)).behavior, `Edit ${f}`).toBe('deny');
      expect((await p.decide('MultiEdit', { file_path: file, edits: [] })).behavior, `MultiEdit ${f}`).toBe('deny');
      expect((await p.decide('NotebookEdit', { notebook_path: file, new_source: '' })).behavior, `NotebookEdit ${f}`).toBe('deny');
      expect((await p.decide('Read', { file_path: file })).behavior, `Read ${f}`).toBe('allow');
    }
  });

  it.each(scopes)('still allows the role-writable paths with %s', async (_, make) => {
    const root = orgTree();
    const p = make(root);
    for (const f of ROLE_WRITABLE) {
      const file = join(root, '.monomind/orgs', f);
      expect((await write(p, file)).behavior, `Write ${f}`).toBe('allow');
      expect((await edit(p, file)).behavior, `Edit ${f}`).toBe('allow');
    }
  });

  it('denies new files: an org definition, a runfile, a decision file', async () => {
    const root = orgTree();
    const p = engine(root, { fileWrite: ['../**'] });
    for (const f of ['rogue.json', 'rogue/run', 'acme/new-state.json', 'acme/run-2/bus.jsonl'])
      expect((await write(p, join(root, '.monomind/orgs', f))).behavior, f).toBe('deny');
  });

  it('checks every path argument: NotebookEdit with both keys, MultiEdit edits', async () => {
    const root = orgTree();
    const p = engine(root, {}, root);
    const def = join(root, '.monomind/orgs/acme.json');
    const report = join(root, '.monomind/orgs/acme/reports/a.ipynb');
    for (const input of [
      { file_path: report, notebook_path: def, new_source: '' },
      { notebook_path: report, file_path: def, new_source: '' },
    ])
      expect((await p.decide('NotebookEdit', input)).behavior).toBe('deny');
    expect((await p.decide('NotebookEdit', { notebook_path: report, new_source: '' })).behavior).toBe('allow');
    expect(
      (await p.decide('MultiEdit', { edits: [{ file_path: def, old_string: 'a', new_string: 'b' }] })).behavior,
    ).toBe('deny');
  });

  it('denies writes through symlinks and hard links', async () => {
    const root = orgTree();
    const orgs = join(root, '.monomind/orgs');
    const reports = join(orgs, 'acme/reports');
    symlinkSync(join(orgs, 'acme.json'), join(reports, 'def.json'));
    symlinkSync(orgs, join(reports, 'orgs-link'));
    symlinkSync(join(orgs, 'brand-new.json'), join(reports, 'dangling'));
    linkSync(join(orgs, 'acme.json'), join(reports, 'hard.json'));
    const p = engine(root, { fileWrite: ['.monomind/orgs/acme/reports/**'] }, root);
    for (const f of ['def.json', 'orgs-link/acme/decisions.jsonl', 'orgs-link/new-org.json', 'dangling', 'hard.json'])
      expect((await write(p, join(reports, f))).behavior, f).toBe('deny');
    expect((await edit(p, join(reports, 'def.json'))).behavior).toBe('deny');
    expect((await write(p, join(reports, 'real.md'))).behavior).toBe('allow');
  });

  it('protects a symlinked .monomind and an org definition that is a symlink', async () => {
    const a = scratch('oa-syma-');
    mkdirSync(join(a, 'state/orgs/release'), { recursive: true });
    writeFileSync(join(a, 'state/orgs/release.json'), '{}');
    symlinkSync(join(a, 'state'), join(a, '.monomind'));
    const pa = engine(a, {}, a);
    expect((await edit(pa, '.monomind/orgs/release.json')).behavior).toBe('deny');
    expect((await edit(pa, 'state/orgs/release.json')).behavior).toBe('deny');
    expect((await write(pa, 'state/orgs/release/gates.json')).behavior).toBe('deny');

    const b = scratch('oa-symb-');
    mkdirSync(join(b, '.monomind/orgs'), { recursive: true });
    mkdirSync(join(b, 'config/orgs'), { recursive: true });
    writeFileSync(join(b, 'config/orgs/release.json'), '{}');
    symlinkSync(join(b, 'config/orgs/release.json'), join(b, '.monomind/orgs/release.json'));
    const pb = engine(b, {}, b);
    expect((await edit(pb, '.monomind/orgs/release.json')).behavior).toBe('deny');
    expect((await edit(pb, 'config/orgs/release.json')).behavior).toBe('deny');
    expect((await write(pb, 'config/orgs/other.json')).behavior).toBe('allow');
    expect(authorityFilePaths(a)).toContain(join(a, 'state/orgs/release.json'));
    expect(authorityFilePaths(b)).toContain(join(b, 'config/orgs/release.json'));
  });

  it('leaves a checkout own .monomind/orgs and a temp fixture alone, anchored at the org root', async () => {
    const root = orgTree();
    const wt = join(root, '.monomind/orgs/acme/work/src');
    const p = engine(root, { fileWrite: ['**', '../../**'] }, wt);
    expect((await edit(p, '.monomind/orgs/release.json')).behavior).toBe('allow');
    expect((await edit(p, '../../../acme.json')).behavior).toBe('deny');
    const fixture = scratch('oa-fixture-');
    const pf = new PolicyEngine('coder', {} as any, new OrgBus('o', 'r', scratch('oa-bus-')), root, [root, fixture], root);
    expect((await write(pf, join(fixture, '.monomind/orgs/t.json'))).behavior).toBe('allow');
  });
});

describe('Bash-side lists', () => {
  it('lists existing authority files, the current run only, no role-writable path', () => {
    const root = orgTree();
    const orgs = join(root, '.monomind/orgs');
    mkdirSync(join(orgs, 'acme/run-2'));
    writeFileSync(join(orgs, 'acme/run-2/bus.jsonl'), '');
    const paths = authorityFilePaths(root, { org: 'acme', run: 'run-2' });
    for (const f of AUTHORITY.filter((f) => !/run-1|replay-1|git-guard/.test(f)))
      expect(paths, f).toContain(join(orgs, f));
    expect(paths).toContain(join(orgs, 'acme/run-2/bus.jsonl'));
    expect(paths).not.toContain(join(orgs, 'acme/run-1/bus.jsonl'));
    for (const f of ROLE_WRITABLE) expect(paths, f).not.toContain(join(orgs, f));
  });

  it('gives the SDK sandbox the current run log and mount points for the orgs tree', () => {
    const root = orgTree();
    const orgs = join(root, '.monomind/orgs');
    spawnSync('git', ['init', '-q', root]);
    const guard = prepareGitGuard({ level: 'read', stateDir: join(root, 'guard'), protectedGitDirs: [gitCommonDir(root)!] })!;
    const r = buildClaudeRestrictions(
      guard,
      undefined,
      { cwd: root, orgRoot: root, current: { org: 'acme', run: 'run-1' }, home: scratch('oa-home-'), tmp: '/tmp', env: {} },
      true,
    );
    const fs = (r.sandbox as any).filesystem;
    expect(fs.denyWrite).toContain(join(orgs, 'acme.json'));
    expect(fs.denyWrite).toContain(join(orgs, 'acme/run'));
    expect(fs.denyWrite).toContain(join(orgs, 'acme/run-1/bus.jsonl'));
    for (const d of orgsMountPoints(root)) expect(fs.allowWrite).toContain(d);
    expect(fs.allowWrite).toContain(orgs);
    expect(fs.allowWrite).toContain(join(root, '.monomind'));
    // Org-dir children are mount points too, so reports/ cannot be swapped
    // for a symlink; every role's guard dir is denied whole.
    expect(fs.allowWrite).toContain(join(orgs, 'acme/reports'));
    expect(gitGuardDirs(root)).toEqual([join(orgs, 'acme/git-guard')]);
    expect(fs.denyWrite).toContain(join(orgs, 'acme/git-guard'));
  });

  it('creates the work dirs of every org, and the dirs a role fileWrite names', () => {
    const root = scratch('oa-work-');
    const orgs = join(root, '.monomind/orgs');
    mkdirSync(join(orgs, 'acme'), { recursive: true });
    writeFileSync(join(orgs, 'acme.json'), '{}');
    mkdirSync(join(orgs, 'stray'), { recursive: true }); // no definition: not an org
    ensureOrgWorkDirs(root, [
      '.monomind/orgs/acme/drafts/**',
      `${orgs}/acme/notes/*.md`,
      '.monomind/orgs/ghost/work/**', // no such org
      '.monomind/orgs/acme/git-guard/**',
      '.monomind/orgs/acme/run-9/**',
      '.monomind/orgs/*/wild/**',
    ]);
    for (const d of [...ORG_WORK_DIRS, 'drafts', 'notes'])
      expect(existsSync(join(orgs, 'acme', d)), d).toBe(true);
    for (const d of ['stray/work', 'ghost', 'acme/git-guard', 'acme/run-9', 'acme/wild'])
      expect(existsSync(join(orgs, d)), d).toBe(false);
  });

  it('collapses . and .. before classifying', () => {
    expect(pathSegments('/p/.monomind/orgs/acme/Reports/../gates.json', 'darwin')).toEqual([
      'p',
      '.monomind',
      'orgs',
      'acme',
      'gates.json',
    ]);
    expect(isAuthorityFile('/p/.monomind/orgs/acme/reports/./../gates.json', '/p', 'linux')).toBe(true);
  });
});

describe.runIf(authorityMaskAvailability().available)('the mask keeps Bash out of the orgs tree (real bwrap)', () => {
  const inMask = (root: string, script: string) => {
    const home = scratch('oa-mhome-');
    const [cmd, argv] = maskedCommand(
      authorityMaskArgs({ home, env: {}, roots: [root], orgRoot: root }),
      'bash',
      ['-c', script],
    );
    return spawnSync(cmd, argv, { encoding: 'utf8' });
  };

  it('refuses the rename trick, new org definitions, runfiles and links; reports stay writable', () => {
    const root = orgTree();
    const orgs = join(root, '.monomind/orgs');
    const r = inMask(
      root,
      [
        `mv ${orgs} ${root}/.monomind/orgs.bak && mkdir ${orgs} && echo forged > ${orgs}/acme.json`,
        `mv ${root}/.monomind ${root}/.monomind.bak && mkdir -p ${orgs} && echo forged > ${orgs}/acme.json`,
        `echo x > ${orgs}/evil.json`,
        `mkdir ${orgs}/evil`,
        `echo x > ${orgs}/acme/run`,
        `echo x > ${orgs}/acme/gates.json`,
        `rm -f ${orgs}/acme/runtime.json`,
        `echo x > ${orgs}/acme/run-1/bus.jsonl`,
        `ln ${orgs}/acme.json ${orgs}/acme/reports/h`,
        `echo ok > ${orgs}/acme/reports/r.md`,
        `mkdir -p ${orgs}/acme/work/new && echo ok > ${orgs}/acme/work/new/f`,
        `echo ok > ${orgs}/acme-memory/note.md`,
        `echo x > ${orgs}/acme-memory/run`,
        `echo ok > ${root}/app/out.txt`,
      ].join('; '),
    );
    expect(readFileSync(join(orgs, 'acme.json'), 'utf8')).toBe('ORIGINAL');
    expect(existsSync(join(root, '.monomind/orgs.bak'))).toBe(false);
    expect(existsSync(join(root, '.monomind.bak'))).toBe(false);
    expect(existsSync(join(orgs, 'evil.json'))).toBe(false);
    expect(existsSync(join(orgs, 'evil'))).toBe(false);
    expect(readFileSync(join(orgs, 'acme/run'), 'utf8')).toBe('ORIGINAL');
    expect(readFileSync(join(orgs, 'acme/gates.json'), 'utf8')).toBe('ORIGINAL');
    expect(existsSync(join(orgs, 'acme/runtime.json'))).toBe(true);
    expect(readFileSync(join(orgs, 'acme/run-1/bus.jsonl'), 'utf8')).toBe('ORIGINAL');
    expect(existsSync(join(orgs, 'acme/reports/h'))).toBe(false);
    expect(readFileSync(join(orgs, 'acme-memory/run'), 'utf8')).toBe('ORIGINAL');
    expect(readFileSync(join(orgs, 'acme/reports/r.md'), 'utf8')).toBe('ok\n');
    expect(readFileSync(join(orgs, 'acme/work/new/f'), 'utf8')).toBe('ok\n');
    expect(readFileSync(join(orgs, 'acme-memory/note.md'), 'utf8')).toBe('ok\n');
    expect(readFileSync(join(root, 'app/out.txt'), 'utf8')).toBe('ok\n');
    expect(r.stderr).toMatch(/Read-only|busy/i);
  });

  it('keeps a symlinked org definition target read-only', () => {
    const root = scratch('oa-msym-');
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    mkdirSync(join(root, 'config/orgs'), { recursive: true });
    writeFileSync(join(root, 'config/orgs/release.json'), 'ORIGINAL');
    symlinkSync(join(root, 'config/orgs/release.json'), join(root, '.monomind/orgs/release.json'));
    inMask(root, `echo x > ${root}/config/orgs/release.json; echo ok > ${root}/config/orgs/other.json`);
    expect(readFileSync(join(root, 'config/orgs/release.json'), 'utf8')).toBe('ORIGINAL');
    expect(readFileSync(join(root, 'config/orgs/other.json'), 'utf8')).toBe('ok\n');
  });

  it('lets a masked role add a worktree under work/ that did not exist yet', () => {
    const root = scratch('oa-mwt-');
    spawnSync('git', ['init', '-q', root]);
    spawnSync('git', ['-C', root, '-c', 'user.email=x@y', '-c', 'user.name=x', 'commit', '-q', '--allow-empty', '-m', 'i']);
    mkdirSync(join(root, '.monomind/orgs/release/reports'), { recursive: true });
    writeFileSync(join(root, '.monomind/orgs/release.json'), '{}');
    const r = inMask(
      root,
      `git -C ${root} worktree add -q -b release/9.9.9 .monomind/orgs/release/work/src HEAD && echo ok`,
    );
    expect(r.stdout + r.stderr).toMatch(/^ok$/m);
    expect(existsSync(join(root, '.monomind/orgs/release/work/src/.git'))).toBe(true);
  });

  /** A planted symlink in the orgs dir must not loosen the next session's mask. */
  it.each([
    ['foo', '..'],
    ['z-memory', '..'],
    ['foo', 'HOME'],
  ])('ignores a planted %s -> %s', (name, target) => {
    const root = orgTree();
    const orgs = join(root, '.monomind/orgs');
    const home = scratch('oa-phome-');
    mkdirSync(join(home, '.monomind/orgrt-operator'), { recursive: true });
    writeFileSync(join(home, '.monomind/orgrt-operator/secret'), 'OPERATOR-SECRET');
    symlinkSync(target === 'HOME' ? home : target, join(orgs, name));
    const [cmd, argv] = maskedCommand(
      authorityMaskArgs({ home, env: {}, roots: [root], orgRoot: root }),
      'bash',
      [
        '-c',
        [
          `echo x > ${orgs}/evil.json`,
          `echo x > ${orgs}/acme/run`,
          `echo x >> ${orgs}/acme/run-1/bus.jsonl`,
          `touch ${orgs}/acme/git-guard/x`,
          `echo x > ${orgs}/acme.json`,
          `cat ${home}/.monomind/orgrt-operator/secret`,
          `echo ok > ${orgs}/acme/reports/r.md`,
        ].join('; '),
      ],
    );
    const r = spawnSync(cmd, argv, { encoding: 'utf8' });
    expect(r.stdout).not.toMatch(/OPERATOR-SECRET/);
    expect(existsSync(join(orgs, 'evil.json'))).toBe(false);
    expect(readFileSync(join(orgs, 'acme/run'), 'utf8')).toBe('ORIGINAL');
    expect(readFileSync(join(orgs, 'acme/run-1/bus.jsonl'), 'utf8')).toBe('ORIGINAL');
    expect(existsSync(join(orgs, 'acme/git-guard/x'))).toBe(false);
    expect(readFileSync(join(orgs, 'acme.json'), 'utf8')).toBe('ORIGINAL');
    expect(readFileSync(join(orgs, 'acme/reports/r.md'), 'utf8')).toBe('ok\n');
  });
});
