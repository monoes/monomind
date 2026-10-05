/**
 * #526 follow-ups to the #518 review, with a temp HOME throughout:
 *   (2) HOME_DENY_WRITE entries that did not exist were dropped from the SDK
 *       sandbox's denyWrite and missing from the mask, so a role could create
 *       ~/.npmrc, ~/.config/npm or an rc file. The harmless ones are now
 *       created empty before a role starts; on macOS a missing one is denied
 *       by path.
 *   (3) a custom MONOMIND_HOME under a writable root could be renamed aside
 *       through an ancestor: every such ancestor is now a mount point, in the
 *       SDK sandbox's allowWrite and in the mask.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  authorityMaskArgs,
  authorityMaskAvailability,
  maskedCommand,
} from '../../src/orgrt/authority-mask.js';
import { HOME_DENY_WRITE } from '../../src/orgrt/file-roots.js';
import { gitCommonDir, prepareGitGuard } from '../../src/orgrt/git-guard.js';
import {
  ensureOperatorProtectedPaths,
  HOME_DENY_WRITE_NOT_STUBBED,
  HOME_DENY_WRITE_STUB_DIRS,
  HOME_DENY_WRITE_STUB_FILES,
} from '../../src/orgrt/operator-protected-paths.js';
import { buildClaudeRestrictions } from '../../src/orgrt/role-sandbox.js';

const dirs: string[] = [];
const scratch = (p: string) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), p)));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function restrictions(o: {
  home: string;
  base: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}) {
  const repo = join(o.base, 'repo');
  spawnSync('git', ['init', '-q', repo]);
  const guard = prepareGitGuard({
    level: 'read',
    stateDir: join(o.base, 'guard'),
    protectedGitDirs: [gitCommonDir(repo) as string],
  });
  return buildClaudeRestrictions(
    guard as NonNullable<typeof guard>,
    undefined,
    {
      cwd: repo,
      orgRoot: o.base,
      home: o.home,
      tmp: o.base,
      env: o.env ?? {},
      platform: o.platform,
    },
    true,
  ).sandbox as { filesystem: { denyWrite: string[]; allowWrite: string[] } };
}

const bound = (args: string[], flag: string, p: string) =>
  args.findIndex((a, i) => a === flag && args[i + 1] === p && args[i + 2] === p);

describe('(2) missing HOME_DENY_WRITE entries are stubbed before a role starts', () => {
  it('creates the harmless ones empty, and none that would change behaviour', () => {
    const home = scratch('dh-home-');
    ensureOperatorProtectedPaths({ home, env: {}, platform: 'linux' });
    for (const f of HOME_DENY_WRITE_STUB_FILES) {
      expect(lstatSync(join(home, f)).isFile(), f).toBe(true);
      expect(readFileSync(join(home, f), 'utf8'), f).toBe('');
    }
    for (const d of HOME_DENY_WRITE_STUB_DIRS) {
      const st = lstatSync(join(home, d));
      expect(st.isDirectory(), d).toBe(true);
      expect(st.mode & 0o777, d).toBe(0o700);
      expect(readdirSync(join(home, d)), d).toEqual([]);
    }
    for (const f of HOME_DENY_WRITE_NOT_STUBBED)
      expect(existsSync(join(home, f)), f).toBe(false);
    expect(existsSync(join(home, '.claude', '.config.json'))).toBe(false);
  });

  it('never overwrites what exists, nor changes an existing directory', () => {
    const home = scratch('dh-home-');
    writeFileSync(join(home, '.npmrc'), 'registry=https://example.invalid/\n');
    writeFileSync(join(home, '.profile'), 'export A=1\n');
    mkdirSync(join(home, '.ssh'), { mode: 0o755 });
    writeFileSync(join(home, '.ssh', 'config'), 'Host x\n');
    ensureOperatorProtectedPaths({ home, env: {} });
    expect(readFileSync(join(home, '.npmrc'), 'utf8')).toBe('registry=https://example.invalid/\n');
    expect(readFileSync(join(home, '.profile'), 'utf8')).toBe('export A=1\n');
    expect(lstatSync(join(home, '.ssh')).mode & 0o777).toBe(0o755);
    expect(readdirSync(join(home, '.ssh'))).toEqual(['config']);
  });

  it('an empty ~/.profile and ~/.bashrc leave a login and an interactive bash as they were', () => {
    const run = (home: string, args: string[]) =>
      spawnSync('bash', [...args, '-c', 'echo "PS1=${PS1:-} A=${A:-}"; alias'], {
        env: { HOME: home, PATH: process.env.PATH },
        encoding: 'utf8',
      }).stdout;
    const bare = scratch('dh-home-');
    const stubbed = scratch('dh-home-');
    ensureOperatorProtectedPaths({ home: stubbed, env: {} });
    for (const args of [['-l'], ['-i'], ['-l', '-i']])
      expect(run(stubbed, args), args.join(' ')).toBe(run(bare, args));
  });

  it('skips ~/.profile when the login shell is zsh or fish', () => {
    for (const [shell, made] of [
      ['/usr/bin/zsh', false],
      ['/usr/local/bin/fish', false],
      ['/bin/bash', true],
    ] as const) {
      const home = scratch('dh-home-');
      ensureOperatorProtectedPaths({ home, env: { SHELL: shell }, platform: 'linux' });
      expect(existsSync(join(home, '.profile')), shell).toBe(made);
      expect(existsSync(join(home, '.bashrc')), shell).toBe(true);
    }
  });

  it('on macOS creates only ~/.config: seatbelt denies the missing paths themselves', () => {
    const home = scratch('dh-home-');
    ensureOperatorProtectedPaths({ home, env: {}, platform: 'darwin' });
    expect(lstatSync(join(home, '.config')).isDirectory()).toBe(true);
    expect(readdirSync(join(home, '.config'))).toEqual([]);
    for (const p of [...HOME_DENY_WRITE_STUB_FILES, '.ssh'])
      expect(existsSync(join(home, p)), p).toBe(false);
    // …and the deny list then names them, and ~/.config/npm under the new ~/.config.
    const fs = restrictions({ home, base: scratch('dh-base-'), platform: 'darwin' }).filesystem;
    for (const p of ['.npmrc', '.profile', '.ssh', '.config/npm'])
      expect(fs.denyWrite, p).toContain(join(home, p));
  });

  it('accounts for every HOME_DENY_WRITE entry', () => {
    const handled = [
      ...HOME_DENY_WRITE_STUB_DIRS,
      ...HOME_DENY_WRITE_STUB_FILES,
      ...HOME_DENY_WRITE_NOT_STUBBED,
    ];
    expect([...HOME_DENY_WRITE].sort()).toEqual([...new Set(handled)].sort());
  });

  it('the SDK sandbox denies the stubs, and the mask binds them read-only', () => {
    const home = scratch('dh-home-');
    const base = scratch('dh-base-');
    ensureOperatorProtectedPaths({ home, env: {}, orgRoot: base });
    const fs = restrictions({ home, base, platform: 'linux' }).filesystem;
    const args = authorityMaskArgs({ home, env: {}, roots: [base], orgRoot: base });
    for (const p of ['.npmrc', '.config/npm', '.config/git', '.bashrc', '.profile', '.ssh']) {
      expect(fs.denyWrite, p).toContain(join(home, p));
      expect(bound(args, '--ro-bind', join(home, p)), p).toBeGreaterThan(-1);
    }
  });

  it('on macOS a missing one is still denied, by path (seatbelt), when its parent exists', () => {
    const home = scratch('dh-home-');
    const base = scratch('dh-base-');
    const fs = restrictions({ home, base, platform: 'darwin' }).filesystem;
    expect(fs.denyWrite).toContain(join(home, '.bash_profile'));
    expect(fs.denyWrite).toContain(join(home, '.npmrc'));
    // ~/.config is missing: denying ~/.config/npm would make seatbelt deny
    // creating ~/.config itself (the SDK denies every ancestor), so it is left out.
    expect(fs.denyWrite).not.toContain(join(home, '.config', 'npm'));
    // Linux keeps dropping what does not exist (bwrap binds only existing paths).
    const linux = restrictions({ home, base, platform: 'linux' }).filesystem;
    expect(linux.denyWrite).not.toContain(join(home, '.bash_profile'));
  });
});

describe('(3) a custom MONOMIND_HOME cannot be renamed aside through an ancestor', () => {
  it('the SDK sandbox makes each one a mount point (allowWrite), and nothing outside the writable roots', () => {
    const home = scratch('dh-home-');
    const base = scratch('dh-base-');
    const mm = join(base, 'repo', 'x', 'mm');
    mkdirSync(mm, { recursive: true });
    const fs = restrictions({ home, base, env: { MONOMIND_HOME: mm } }).filesystem;
    for (const d of [join(base, 'repo', 'x'), mm])
      expect(fs.allowWrite, d).toContain(d);
    expect(fs.denyWrite).toContain(join(mm, 'deps'));
    expect(fs.allowWrite.some((d) => d === '/' || d === '/home')).toBe(false);
  });

  it('the mask binds each ancestor before the monomind home it holds', () => {
    const home = scratch('dh-home-');
    const base = scratch('dh-base-');
    const mm = join(base, 'a', 'b', 'mm');
    mkdirSync(mm, { recursive: true });
    const args = authorityMaskArgs({ home, env: { MONOMIND_HOME: mm }, roots: [base], orgRoot: base });
    const ro = bound(args, '--ro-bind', mm);
    expect(ro).toBeGreaterThan(-1);
    for (const d of [join(base, 'a'), join(base, 'a', 'b')]) {
      const at = bound(args, '--bind', d);
      expect(at, d).toBeGreaterThan(-1);
      expect(at, d).toBeLessThan(ro);
    }
    expect(bound(args, '--ro-bind', join(mm, 'deps'))).toBeGreaterThan(-1);
  });
});

describe.runIf(authorityMaskAvailability().available)('inside the real mask', () => {
  it('(3) a role can neither rename an ancestor of MONOMIND_HOME aside nor plant a deps dir', () => {
    const home = scratch('dh-home-');
    const base = scratch('dh-base-');
    const mm = join(base, 'a', 'b', 'mm');
    mkdirSync(mm, { recursive: true });
    const env = { MONOMIND_HOME: mm };
    const [cmd, argv] = maskedCommand(
      authorityMaskArgs({ home, env, roots: [base], orgRoot: base }),
      'bash',
      [
        '-c',
        `mv ${base}/a ${base}/a-aside 2>/dev/null && echo RENAMED-A; ` +
          `mv ${base}/a/b ${base}/a/b-aside 2>/dev/null && echo RENAMED-B; ` +
          `mv ${mm} ${base}/a/b/mm-aside 2>/dev/null && echo RENAMED-MM; ` +
          `mkdir ${mm}/deps/@anthropic-ai+claude-agent-sdk@0.3.289 2>/dev/null && echo PLANTED; ` +
          `echo ok > ${base}/work.txt && echo WROTE; true`,
      ],
    );
    const out = spawnSync(cmd, argv, { encoding: 'utf8' }).stdout;
    expect(out).toContain('WROTE');
    expect(out).not.toMatch(/RENAMED|PLANTED/);
    expect(existsSync(join(base, 'a-aside'))).toBe(false);
    expect(readdirSync(join(mm, 'deps'))).toEqual([]);
  });

  it('(3) a custom MONOMIND_HOME inside the org root stays read-only (#538 re-applies it)', () => {
    const home = scratch('dh-home-');
    const root = scratch('dh-root-');
    const mm = join(root, 'tools', 'mm');
    mkdirSync(mm, { recursive: true });
    const env = { MONOMIND_HOME: mm };
    const [cmd, argv] = maskedCommand(
      authorityMaskArgs({ home, env, roots: [root], orgRoot: root, cwd: root }),
      'bash',
      [
        '-c',
        `touch ${mm}/planted 2>/dev/null && echo PLANTED; ` +
          `mkdir ${mm}/deps/x 2>/dev/null && echo DEPS; ` +
          `mv ${root}/tools ${root}/tools-aside 2>/dev/null && echo MOVED; ` +
          `touch ${root}/ok && echo ROOTW; true`,
      ],
    );
    const out = spawnSync(cmd, argv, { encoding: 'utf8' }).stdout;
    expect(out).toContain('ROOTW');
    expect(out).not.toMatch(/PLANTED|DEPS|MOVED/);
    expect(existsSync(join(mm, 'planted'))).toBe(false);
  });

  it('(2) a role can write none of the stubbed npm and shell config', () => {
    const home = scratch('dh-home-');
    const base = scratch('dh-base-');
    ensureOperatorProtectedPaths({ home, env: {}, orgRoot: base });
    const [cmd, argv] = maskedCommand(
      authorityMaskArgs({ home, env: {}, roots: [base], orgRoot: base }),
      'bash',
      [
        '-c',
        `echo registry=evil > ${home}/.npmrc 2>/dev/null && echo NPMRC; ` +
          `echo registry=evil > ${home}/.config/npm/npmrc 2>/dev/null && echo XDGNPM; ` +
          `echo evil >> ${home}/.bashrc 2>/dev/null && echo BASHRC; ` +
          `echo '[core]' > ${home}/.config/git/config 2>/dev/null && echo GITXDG; ` +
          `mv ${home}/.npmrc ${home}/.npmrc-aside 2>/dev/null && echo MOVED; true`,
      ],
    );
    const out = spawnSync(cmd, argv, { encoding: 'utf8' }).stdout;
    expect(out).not.toMatch(/NPMRC|XDGNPM|BASHRC|GITXDG|MOVED/);
    expect(readFileSync(join(home, '.npmrc'), 'utf8')).toBe('');
    expect(existsSync(join(home, '.config', 'npm', 'npmrc'))).toBe(false);
  });
});
