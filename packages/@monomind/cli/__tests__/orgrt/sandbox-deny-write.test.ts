// packages/@monomind/cli/__tests__/orgrt/sandbox-deny-write.test.ts
/**
 * #323: the SDK sandbox bind-mounts /dev/null over missing "dangerous files"
 * in the role's cwd and ~/.claude, which needs a writable parent for bwrap's
 * mount-point stub. A deny-write directory equal to or containing the cwd or
 * ~/.claude must therefore go to the SDK as its existing children — and the
 * real bwrap must accept the resulting mounts (skipped where bwrap can't run).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gitCommonDir, prepareGitGuard } from '../../src/orgrt/git-guard.js';
import { buildClaudeRestrictions } from '../../src/orgrt/role-sandbox.js';
import { expandDenyWrite } from '../../src/orgrt/sandbox-deny-write.js';

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
});
