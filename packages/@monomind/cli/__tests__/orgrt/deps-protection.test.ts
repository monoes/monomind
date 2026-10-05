/**
 * #518 review, B1: an org role could write ~/.monomind/deps (the SDK
 * sandbox's allowWrite includes $HOME; the mask is `--dev-bind / /`) and
 * plant the SDK or Chrome that the unsandboxed daemon then runs, or point
 * npm elsewhere with ~/.npmrc. The deps dir and npm's config are now
 * write-denied in the file tools and the SDK sandbox, and read-only in the
 * mask, with its parent a mount point so it cannot be renamed aside.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  authorityMaskArgs,
  authorityMaskAvailability,
  maskedCommand,
} from '../../src/orgrt/authority-mask.js';
import { fileToolDenied, HOME_DENY_WRITE } from '../../src/orgrt/file-roots.js';
import { gitCommonDir, prepareGitGuard } from '../../src/orgrt/git-guard.js';
import { isOperatorProtected } from '../../src/orgrt/operator-protected-paths.js';
import { realPath } from '../../src/orgrt/policy-paths.js';
import { buildClaudeRestrictions } from '../../src/orgrt/role-sandbox.js';

const scratch = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));

describe('deps dir and npm config are write-denied to roles', () => {
  it('HOME_DENY_WRITE lists them, and the file tools deny them', () => {
    expect(HOME_DENY_WRITE).toEqual(expect.arrayContaining(['.monomind/deps', '.npmrc', '.config/npm']));
    const home = scratch('dp-home-');
    const denied = fileToolDenied(home, {});
    for (const p of ['.monomind/deps', '.npmrc', '.config/npm']) expect(denied).toContain(join(home, p));
    // $MONOMIND_HOME moves the deps dir; the deny follows it.
    const mm = scratch('dp-mm-');
    expect(fileToolDenied(home, { MONOMIND_HOME: mm })).toContain(join(mm, 'deps'));
  });

  it('the SDK sandbox denies writes to the deps dir (created first) and pins ~/.monomind as a mount point', () => {
    const base = scratch('dp-base-');
    const repo = join(base, 'repo');
    spawnSync('git', ['init', '-q', repo]);
    const guard = prepareGitGuard({
      level: 'read',
      stateDir: join(base, 'guard'),
      protectedGitDirs: [gitCommonDir(repo)!],
    })!;
    const home = scratch('dp-home-');
    const sb = buildClaudeRestrictions(guard, undefined, { cwd: repo, orgRoot: base, home, tmp: '/tmp', env: {} }, true)
      .sandbox as { filesystem: { denyWrite: string[]; allowWrite: string[] } };
    expect(existsSync(join(home, '.monomind', 'deps'))).toBe(true);
    expect(sb.filesystem.denyWrite).toContain(join(home, '.monomind', 'deps'));
    expect(sb.filesystem.allowWrite).toContain(join(home, '.monomind'));
  });

  it('the mask binds the deps dir and its parent read-only', () => {
    const home = scratch('dp-home-');
    const root = scratch('dp-root-');
    const args = authorityMaskArgs({ home, env: {}, roots: [root], orgRoot: root });
    const bound = (flag: string, p: string) =>
      args.some((a, i) => a === flag && args[i + 1] === p && args[i + 2] === p);
    const mm = join(home, '.monomind');
    // The monomind home is a read-only mount point (#502 review), so the
    // deps dir in it can neither be renamed aside nor re-created.
    expect(bound('--ro-bind', mm)).toBe(true);
    expect(bound('--bind', mm)).toBe(false);
    expect(bound('--ro-bind', join(mm, 'deps'))).toBe(true);
  });
});

describe.runIf(authorityMaskAvailability().available)('inside the real mask', () => {
  it('a role can neither plant into the deps dir nor rename ~/.monomind aside', () => {
    const home = scratch('dp-home-');
    const root = scratch('dp-root-');
    const mm = join(home, '.monomind');
    const [cmd, argv] = maskedCommand(
      authorityMaskArgs({ home, env: {}, roots: [root], orgRoot: root }),
      'bash',
      [
        '-c',
        `mkdir ${mm}/deps/@anthropic-ai+claude-agent-sdk@0.3.289 2>/dev/null && echo PLANTED; ` +
          `mv ${mm} ${home}/.mm-aside 2>/dev/null && echo RENAMED; ` +
          `mv ${mm}/deps ${mm}/deps-aside 2>/dev/null && echo MOVED; true`,
      ],
    );
    const out = spawnSync(cmd, argv, { encoding: 'utf8' }).stdout;
    expect(out).not.toMatch(/PLANTED|RENAMED|MOVED/);
    expect(readdirSync(join(mm, 'deps'))).toEqual([]);
    expect(existsSync(join(home, '.mm-aside'))).toBe(false);
  });

  it('a masked role gets a read-only deps dir, so its install fails with EROFS', () => {
    const home = scratch('dp-home-');
    const root = scratch('dp-root-');
    mkdirSync(join(home, '.monomind', 'deps'), { recursive: true, mode: 0o700 });
    const [cmd, argv] = maskedCommand(
      authorityMaskArgs({ home, env: {}, roots: [root], orgRoot: root }),
      'bash',
      ['-c', `touch ${home}/.monomind/deps/x`],
    );
    expect(spawnSync(cmd, argv, { encoding: 'utf8' }).stderr).toMatch(/Read-only file system/);
  });
});

/** #522 review: an operator-chosen Claude Code under $HOME, which the
 *  daemons run unsandboxed, is read-only to roles and cannot be moved aside. */
function claudeHome() {
  const home = scratch('dp-home-');
  const file = join(home, '.local', 'share', 'claude', 'versions', '2.1.300');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '\x7fELF', { mode: 0o755 });
  mkdirSync(join(home, '.local', 'bin'));
  symlinkSync(file, join(home, '.local', 'bin', 'claude'));
  const env = { MONOMIND_CLAUDE_PATH: join(home, '.local', 'bin', 'claude') };
  const dirs = ['.local', '.local/share', '.local/share/claude', '.local/share/claude/versions'];
  return { home, file, env, dirs: dirs.map((d) => join(home, d)) };
}

describe('the MONOMIND_CLAUDE_PATH binary is write-denied to roles', () => {
  it('it is an operator-protected path, which the file tools refuse to write', () => {
    const { home, file, env } = claudeHome();
    expect(isOperatorProtected(file, { home, env }, realPath)).toBe(file);
  });

  it('the SDK sandbox denies it and pins every directory under $HOME on the way', () => {
    const { home, file, env, dirs } = claudeHome();
    const base = scratch('dp-base-');
    const repo = join(base, 'repo');
    spawnSync('git', ['init', '-q', repo]);
    const guard = prepareGitGuard({
      level: 'read',
      stateDir: join(base, 'guard'),
      protectedGitDirs: [gitCommonDir(repo)!],
    })!;
    const sb = buildClaudeRestrictions(
      guard,
      undefined,
      { cwd: repo, orgRoot: base, home, tmp: '/tmp', env },
      true,
    ).sandbox as { filesystem: { denyWrite: string[]; allowWrite: string[] } };
    expect(sb.filesystem.denyWrite).toContain(file);
    expect(sb.filesystem.allowWrite).toEqual(expect.arrayContaining(dirs));
  });

  it('the mask pins those directories first, binds the file read-only, and never ~/.monomind read-write', () => {
    const { home, file, env, dirs } = claudeHome();
    const root = scratch('dp-root-');
    const args = authorityMaskArgs({ home, env, roots: [root], orgRoot: root });
    // Among the mount-point anchors (#527), which all come before any
    // read-only bind.
    const firstRo = args.indexOf('--ro-bind');
    for (const d of dirs) {
      const i = args.findIndex((a, j) => a === '--bind' && args[j + 1] === d && args[j + 2] === d);
      expect(i, d).toBeGreaterThan(0);
      expect(i, d).toBeLessThan(firstRo);
    }
    const at = args.indexOf(file);
    expect(args.slice(at - 1, at + 2)).toEqual(['--ro-bind', file, file]);
    // With the other read-only binds: after the org binds, before the tmpfs.
    expect(at).toBeGreaterThan(args.lastIndexOf(join(home, '.monomind')));
    const tmpfs = args.indexOf('--tmpfs');
    if (tmpfs >= 0) expect(at).toBeLessThan(tmpfs);
    const mm = join(home, '.monomind');
    for (let i = 0; i < args.length; i++)
      if (args[i] === '--bind') expect(args[i + 2]).not.toBe(mm);
  });

  it.runIf(authorityMaskAvailability().available)(
    'inside the real mask a role can neither overwrite it nor move a directory above it aside',
    () => {
      const { home, file, env } = claudeHome();
      const root = scratch('dp-root-');
      const v = dirname(file);
      const [cmd, argv] = maskedCommand(
        authorityMaskArgs({ home, env, roots: [root], orgRoot: root }),
        'bash',
        [
          '-c',
          `echo evil > ${file} 2>/dev/null && echo WROTE; ` +
            `mv ${v} ${v}-aside 2>/dev/null && echo MOVED1; ` +
            `mv ${dirname(v)} ${dirname(v)}-aside 2>/dev/null && echo MOVED2; ` +
            `mv ${home}/.local ${home}/.local-aside 2>/dev/null && echo MOVED3; ` +
            `touch ${home}/.monomind/newfile 2>/dev/null && echo PLANTED; true`,
        ],
      );
      expect(spawnSync(cmd, argv, { encoding: 'utf8' }).stdout).not.toMatch(/WROTE|MOVED|PLANTED/);
      expect(readFileSync(file, 'utf8')).toBe('\x7fELF');
      expect(existsSync(join(home, '.monomind', 'newfile'))).toBe(false);
    },
  );
});
