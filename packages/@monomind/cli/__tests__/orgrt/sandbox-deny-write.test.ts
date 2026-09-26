// packages/@monomind/cli/__tests__/orgrt/sandbox-deny-write.test.ts
/**
 * #323: the SDK sandbox bind-mounts /dev/null over missing "dangerous files"
 * in the role's cwd and ~/.claude, which needs a writable parent for bwrap's
 * mount-point stub. A deny-write directory equal to or containing the cwd or
 * ~/.claude must therefore go to the SDK as its existing children — and the
 * real bwrap must accept the resulting mounts (skipped where bwrap can't run).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gitCommonDir, prepareGitGuard } from '../../src/orgrt/git-guard.js';
import { buildClaudeRestrictions } from '../../src/orgrt/role-sandbox.js';
import { expandDenyWrite } from '../../src/orgrt/sandbox-deny-write.js';
import { SandboxStubs, sandboxStubPaths } from '../../src/orgrt/sandbox-stubs.js';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

/** org root `base` holding the role's checkout `base/repo` (its cwd), an
 *  existing file and dir next to it, and a home with a populated ~/.claude. */
function layout() {
  const base = tmp('deny-expand-');
  const repo = join(base, 'repo');
  spawnSync('git', ['init', '-q', repo]);
  writeFileSync(join(base, 'README.md'), 'hi\n');
  mkdirSync(join(base, 'docs'));
  const home = tmp('deny-expand-home-');
  mkdirSync(join(home, '.claude', 'ide'), { recursive: true });
  writeFileSync(join(home, '.claude', 'settings.json'), '{}\n');
  const guard = prepareGitGuard({
    level: 'read',
    stateDir: join(base, 'guard'),
    protectedGitDirs: [gitCommonDir(repo)!],
  })!;
  return { base, repo, home, guard };
}

const restrictions = (l: ReturnType<typeof layout>, denyWrite = ['.']) =>
  buildClaudeRestrictions(
    l.guard,
    { denyWrite },
    { cwd: l.repo, orgRoot: l.base, home: l.home, tmp: '/tmp', platform: 'linux' },
    true,
  );

describe('expandDenyWrite', () => {
  it('replaces a directory holding a keep-writable path with its children, recursively', () => {
    const l = layout();
    const r = expandDenyWrite([l.base], [l.repo], 'linux');
    expect(r.denyWrite).not.toContain(l.base);
    expect(r.denyWrite).not.toContain(l.repo);
    expect(r.denyWrite).toEqual(
      expect.arrayContaining([join(l.base, 'README.md'), join(l.base, 'docs'), join(l.repo, '.git')]),
    );
    expect(r.mountPoints).toEqual([l.base, l.repo]);
  });

  it("leaves out the SDK's empty stub files, which vanish when the sandbox that made them ends", () => {
    const l = layout();
    const claude = join(l.home, '.claude');
    writeFileSync(join(claude, 'local'), ''); // a stub another sandbox holds
    writeFileSync(join(l.base, '.mcp.json'), '');
    const r = expandDenyWrite([l.base, claude], [l.repo, claude], 'linux');
    expect(r.denyWrite).not.toContain(join(claude, 'local'));
    expect(r.denyWrite).not.toContain(join(l.base, '.mcp.json'));
    expect(r.denyWrite).toEqual(
      expect.arrayContaining([join(claude, 'settings.json'), join(claude, 'ide'), join(l.base, 'README.md')]),
    );
  });

  it('keeps unrelated and missing paths exactly as given', () => {
    const l = layout();
    const r = expandDenyWrite([join(l.base, 'docs'), '/definitely/not/there'], [l.repo], 'linux');
    expect(r).toEqual({ denyWrite: [join(l.base, 'docs'), '/definitely/not/there'], mountPoints: [] });
  });

  it('is a no-op off Linux (seatbelt needs no mount points)', () => {
    const l = layout();
    expect(expandDenyWrite([l.base], [l.repo], 'darwin')).toEqual({ denyWrite: [l.base], mountPoints: [] });
  });
});

describe('buildClaudeRestrictions (#323)', () => {
  it("denyWrite ['.']: never the org root or the cwd, but every existing entry under them", () => {
    const l = layout();
    const fs = (restrictions(l).sandbox as any).filesystem;
    expect(fs.denyWrite).not.toContain(l.base);
    expect(fs.denyWrite).not.toContain(l.repo);
    expect(fs.denyWrite).toEqual(expect.arrayContaining([join(l.base, 'README.md'), join(l.base, 'docs')]));
    expect(fs.allowWrite).toEqual(expect.arrayContaining([l.base, l.repo]));
  });

  it('never ~/.claude itself: its existing children stay read-only, the dir becomes a mount point', () => {
    const l = layout();
    const fs = (restrictions(l, []).sandbox as any).filesystem;
    expect(fs.denyWrite).not.toContain(join(l.home, '.claude'));
    expect(fs.denyWrite).toEqual(
      expect.arrayContaining([join(l.home, '.claude', 'settings.json'), join(l.home, '.claude', 'ide')]),
    );
    expect(fs.allowWrite).toContain(join(l.home, '.claude'));
  });

  it('keeps the file tools on the whole directory: new files in the org root stay unwritable to Edit/Write', () => {
    const l = layout();
    expect(restrictions(l).disallowedTools).toEqual(
      expect.arrayContaining([`Edit(/${l.base})`, `Edit(/${l.base}/**)`]),
    );
  });

  it('does not turn an expanded directory outside every writable root into a writable one', () => {
    const l = layout();
    const r = buildClaudeRestrictions(
      l.guard,
      { denyWrite: [l.base] },
      // cwd inside the org root, but no org root: base is under no writable root here
      { cwd: l.repo, home: l.home, tmp: l.home, platform: 'linux' },
      true,
    );
    const fs = (r.sandbox as any).filesystem;
    expect(fs.denyWrite).not.toContain(l.base);
    expect(fs.allowWrite).not.toContain(l.base);
  });
});

/** A QA role's layout: the org root is a checkout and is the role's cwd. */
function qaLayout() {
  const root = tmp('deny-lock-');
  spawnSync('git', ['init', '-q', root]);
  writeFileSync(join(root, 'README.md'), 'hi\n');
  const home = tmp('deny-lock-home-');
  mkdirSync(join(home, '.claude'), { recursive: true });
  const guard = prepareGitGuard({
    level: 'read',
    stateDir: join(tmp('deny-lock-guard-'), 'guard'),
    protectedGitDirs: [gitCommonDir(root)!],
  })!;
  return { root, home, guard };
}

/** What session.ts hands buildClaudeRestrictions, with a private stub set. */
const holdWith = (stubs: SandboxStubs, cwd: string, home: string) => (writableRoots: string[]) => {
  const paths = sandboxStubPaths({ cwd, home, writableRoots, env: {} });
  stubs.hold('org:run', paths);
  return stubs.missing(paths);
};

describe('the cwd stays read-only when the runtime holds its stubs', () => {
  const qa = (
    l: ReturnType<typeof qaLayout>,
    holdStubs?: (roots: string[]) => string[],
    cwd = l.root,
    platform: NodeJS.Platform = 'linux',
  ) =>
    (buildClaudeRestrictions(
      l.guard,
      { denyWrite: ['.'] },
      { cwd, orgRoot: l.root, home: l.home, tmp: l.home, platform, holdStubs },
      true,
    ).sandbox as any).filesystem;

  it('every stub in place: the org root (= cwd) is a plain deny, not a mount point', () => {
    const l = qaLayout();
    const r = expandDenyWrite([l.root], [l.root, join(l.home, '.claude')], 'linux', {
      cwd: l.root,
      writableRoots: [l.root, l.home, '/tmp'],
      missingStubs: [],
    });
    expect(r).toEqual({ denyWrite: [l.root], mountPoints: [] });
    expect(qa(l, () => [])).toMatchObject({ denyWrite: expect.arrayContaining([l.root]) });
  });

  it('holds the stubs before building the deny list, then keeps the org root denied', () => {
    const l = qaLayout();
    const stubs = new SandboxStubs(null);
    try {
      const fs = qa(l, holdWith(stubs, l.root, l.home));
      expect(existsSync(join(l.root, '.mcp.json'))).toBe(true);
      expect(existsSync(join(l.root, '.claude', 'settings.json'))).toBe(true);
      expect(fs.denyWrite).toContain(l.root);
      expect(fs.denyWrite).not.toContain(join(l.root, 'README.md')); // covered by the root
    } finally {
      stubs.releaseAll();
    }
  });

  it('a stub missing: the #323 expansion exactly as before', () => {
    const l = qaLayout();
    const before = qa(l);
    const missing = qa(l, () => [join(l.root, '.mcp.json')]);
    expect(missing).toEqual(before);
    expect(missing.denyWrite).not.toContain(l.root);
    expect(missing.denyWrite).toEqual(expect.arrayContaining([join(l.root, 'README.md')]));
  });

  it('a stub another sandbox made (empty, not ours) counts as missing: it can vanish', () => {
    const l = qaLayout();
    writeFileSync(join(l.root, '.mcp.json'), ''); // another process's bwrap stub
    const stubs = new SandboxStubs(null);
    try {
      const fs = qa(l, holdWith(stubs, l.root, l.home));
      expect(fs.denyWrite).not.toContain(l.root);
    } finally {
      stubs.releaseAll();
    }
  });

  it('off Linux the stubs are neither held nor consulted', () => {
    const l = qaLayout();
    let called = false;
    qa(l, () => ((called = true), []), l.root, 'darwin');
    expect(called).toBe(false);
  });

  it('a directory above the cwd stays expanded; the cwd inside it is locked', () => {
    const l = layout();
    const r = expandDenyWrite([l.base], [l.repo], 'linux', {
      cwd: l.repo,
      writableRoots: [l.repo, l.base],
      missingStubs: [],
    });
    expect(r.mountPoints).toEqual([l.base]);
    expect(r.denyWrite).toEqual(expect.arrayContaining([l.repo, join(l.base, 'README.md')]));
  });

  it('not while another writable root lies inside the cwd', () => {
    const l = qaLayout();
    const inner = join(l.root, 'scratch');
    mkdirSync(inner);
    const r = expandDenyWrite([l.root], [l.root], 'linux', {
      cwd: l.root,
      writableRoots: [l.root, inner],
      missingStubs: [],
    });
    expect(r.mountPoints).toEqual([l.root]);
  });

  it('~/.claude keeps the #323 expansion even with every stub held', () => {
    const l = qaLayout();
    const claude = join(l.home, '.claude');
    writeFileSync(join(claude, 'settings.json'), '{}\n');
    const fs = qa(l, () => []);
    expect(fs.denyWrite).not.toContain(claude);
    expect(fs.denyWrite).toContain(join(claude, 'settings.json'));
    expect(fs.allowWrite).toContain(claude);
  });
});

describe('SandboxStubs.missing', () => {
  it('in place: held by us, or a non-empty file/dir; missing: absent or an empty one not ours', () => {
    const d = tmp('stubs-missing-');
    const stubs = new SandboxStubs(null);
    try {
      writeFileSync(join(d, 'real.json'), '{}');
      writeFileSync(join(d, 'foreign'), '');
      mkdirSync(join(d, 'emptydir'));
      stubs.hold('o', [join(d, 'held')]);
      const all = ['real.json', 'foreign', 'emptydir', 'held', 'absent', 'nodir/x'].map((p) => join(d, p));
      expect(stubs.missing(all)).toEqual([join(d, 'foreign'), join(d, 'emptydir'), join(d, 'absent')]);
    } finally {
      stubs.releaseAll();
    }
  });
});

const bwrapWorks =
  process.platform === 'linux' &&
  spawnSync('bwrap', ['--dev-bind', '/', '/', 'true'], { encoding: 'utf8' }).status === 0;

describe.skipIf(!bwrapWorks)('real bwrap (#323 repro)', () => {
  const bwrap = (args: string[], script: string) =>
    spawnSync('bwrap', ['--dev-bind', '/', '/', ...args, 'sh', '-c', script], { encoding: 'utf8' });

  it('reproduces the failure: a stub mount under a read-only directory cannot be created', () => {
    const d = tmp('bwrap-repro-');
    const r = bwrap(['--ro-bind', d, d, '--ro-bind', '/dev/null', join(d, '.gitconfig')], 'true');
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Read-only file system/);
  });

  it('starts after a stub seen at session start is gone (2.16.2: "Can\'t find source path ~/.claude/local")', () => {
    const l = layout();
    const stub = join(l.home, '.claude', 'local');
    writeFileSync(stub, '');
    const fs = (restrictions(l, []).sandbox as any).filesystem;
    rmSync(stub); // the sandbox that held it ended
    const inScope = (p: string) => p.startsWith(`${l.home}/.claude`);
    const args = [
      ...fs.allowWrite.filter(inScope).flatMap((p: string) => ['--bind', p, p]),
      ...fs.denyWrite.filter(inScope).flatMap((p: string) => ['--ro-bind', p, p]),
    ];
    expect(bwrap(args, 'true').status).toBe(0);
    // What the stub in the deny list did:
    const r = bwrap([...args, '--ro-bind', stub, stub], 'true');
    expect(r.stderr).toMatch(/Can't find source path/);
  });

  it('accepts the expanded mounts: SDK stubs are created, existing entries stay read-only', () => {
    const l = layout();
    const fs = (restrictions(l).sandbox as any).filesystem;
    const inScope = (p: string) => p.startsWith(`${l.base}/`) || p === l.base || p.startsWith(`${l.home}/.claude`);
    // The SDK's order: writable binds, then read-only denies, then /dev/null stubs.
    const args = [
      ...fs.allowWrite.filter(inScope).flatMap((p: string) => ['--bind', p, p]),
      ...fs.denyWrite.filter(inScope).flatMap((p: string) => ['--ro-bind', p, p]),
      ...[join(l.repo, '.gitconfig'), join(l.repo, '.mcp.json'), join(l.home, '.claude', 'settings.local.json')]
        .filter((p) => !existsSync(p))
        .flatMap((p) => ['--ro-bind', '/dev/null', p]),
    ];
    const script = [
      `echo new > ${join(l.base, 'scratch.txt')}`,
      `! echo x > ${join(l.base, 'README.md')}`,
      `! mv ${join(l.base, 'docs')} ${join(l.base, 'docs2')}`,
      `! mv ${l.base} ${l.base}-moved`,
      `! mv ${join(l.home, '.claude')} ${join(l.home, 'claude-moved')}`,
      `! echo x > ${join(l.home, '.claude', 'settings.json')}`,
      `! echo x > ${join(l.repo, '.gitconfig')}`,
      `! touch ${join(l.repo, '.git', 'x')}`,
    ].join(' && ');
    const r = bwrap(args, script);
    expect(r.status, r.stderr).toBe(0);
  });

  it('accepts a locked org root (= cwd) with the stubs held: no new file, bwrap starts', () => {
    const l = qaLayout();
    const stubs = new SandboxStubs(null);
    try {
      const held = holdWith(stubs, l.root, l.home);
      let paths: string[] = [];
      const fs = (buildClaudeRestrictions(
        l.guard,
        { denyWrite: ['.'] },
        {
          cwd: l.root,
          orgRoot: l.root,
          home: l.home,
          tmp: l.home,
          platform: 'linux',
          holdStubs: (roots) => {
            paths = sandboxStubPaths({ cwd: l.root, home: l.home, writableRoots: roots, env: {} });
            return held(roots);
          },
        },
        true,
      ).sandbox as any).filesystem;
      expect(fs.denyWrite).toContain(l.root);
      const inScope = (p: string) => p === l.root || p.startsWith(`${l.root}/`);
      // The SDK's order: writable binds, read-only denies, then its own denies,
      // which all exist now and are bound onto themselves.
      const args = [
        ...fs.allowWrite.filter(inScope).flatMap((p: string) => ['--bind', p, p]),
        ...fs.denyWrite.filter(inScope).flatMap((p: string) => ['--ro-bind', p, p]),
        ...paths.filter((p) => inScope(p) && existsSync(p)).flatMap((p) => ['--ro-bind', p, p]),
      ];
      const r = bwrap(
        args,
        [`cat ${join(l.root, 'README.md')} >/dev/null`, `ls ${l.root} >/dev/null`, `touch ${join(l.root, 'new')}`].join(
          ' && ',
        ),
      );
      expect(r.stderr).not.toMatch(/Can't create file|Can't find source path/);
      expect(r.stderr).toMatch(/Read-only file system/);
      expect(existsSync(join(l.root, 'new'))).toBe(false);
    } finally {
      stubs.releaseAll();
    }
  });
});
