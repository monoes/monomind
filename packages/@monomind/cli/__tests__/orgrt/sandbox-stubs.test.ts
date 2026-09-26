// packages/@monomind/cli/__tests__/orgrt/sandbox-stubs.test.ts
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareGitGuard } from '../../src/orgrt/git-guard.js';
import { CWD_STUBS, SandboxStubs, sandboxStubPaths } from '../../src/orgrt/sandbox-stubs.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A repo cwd with `.claude/` and `.git/`, and a HOME with `.claude/`. */
function layout() {
  const base = mkdtempSync(join(tmpdir(), 'stubs-'));
  dirs.push(base);
  const cwd = join(base, 'repo');
  const home = join(base, 'home');
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  mkdirSync(join(cwd, '.git'));
  mkdirSync(join(home, '.claude'), { recursive: true });
  const paths = sandboxStubPaths({ cwd, home, writableRoots: [cwd, home], env: {} });
  return { base, cwd, home, paths };
}

const files = (paths: string[]) => paths.filter((p) => !p.endsWith('/.claude'));

describe('sandboxStubPaths', () => {
  const roots = ['/o/wt', '/o', '/h', '/t'];

  it('resolves the cwd, ~/.claude and $HOME lists', () => {
    const paths = sandboxStubPaths({ cwd: '/o/wt', home: '/h', writableRoots: roots, env: {} });
    for (const p of [
      '/o/wt/.claude',
      '/o/wt/.claude/settings.local.json',
      '/o/wt/.bashrc',
      '/o/wt/.mcp.json',
      '/o/wt/.git/config.worktree',
      '/h/.claude/local',
      '/h/.claude/ide',
      '/h/.claude-local-oauth.json',
      '/h/.mcp.json',
    ])
      expect(paths).toContain(p);
    for (const p of CWD_STUBS) expect(paths).toContain(join('/o/wt', p));
  });

  it('covers the project files of every sandbox-writable directory above the cwd', () => {
    const paths = sandboxStubPaths({ cwd: '/o/wt', home: '/h', writableRoots: roots, env: {} });
    expect(paths).toContain('/o/.claude');
    expect(paths).toContain('/o/.claude/settings.local.json');
    expect(paths).toContain('/o/.mcp.json');
    // Shell and git dotfiles are the cwd's only; `/` is not writable.
    expect(paths).not.toContain('/o/.bashrc');
    expect(paths.some((p) => p.startsWith('/.claude') || p === '/.mcp.json')).toBe(false);
    // A dir .claude is listed before the files in it.
    expect(paths.indexOf('/o/.claude')).toBeLessThan(paths.indexOf('/o/.claude/hooks'));
  });

  it('follows CLAUDE_CONFIG_DIR for the config dir and the global config files', () => {
    const paths = sandboxStubPaths({
      cwd: '/w',
      home: '/h',
      writableRoots: ['/w'],
      env: { CLAUDE_CONFIG_DIR: '/c' },
    });
    expect(paths).toContain('/c/local');
    expect(paths).toContain('/c/.claude-local-oauth.json');
    expect(paths).toContain('/h/.mcp.json');
    expect(paths.some((p) => p.startsWith('/h/.claude'))).toBe(false);
  });

  it('leaves out the git config lock and the state the CLI writes itself', () => {
    const paths = sandboxStubPaths({ cwd: '/w', home: '/h', writableRoots: ['/w'], env: {} });
    for (const p of [
      '/w/.git/config.lock',
      '/h/.claude/.credentials.json',
      '/h/.claude/.config.json',
      '/h/.claude.json',
      '/h/.claude/projects',
    ])
      expect(paths).not.toContain(p);
  });
});

describe('SandboxStubs', () => {
  it('creates every missing file as an empty read-only file, the way bwrap would', () => {
    const { paths } = layout();
    const created = new SandboxStubs(null).hold('org:run-1', paths);
    expect(created.sort()).toEqual(files(paths).sort());
    for (const p of created) {
      const st = lstatSync(p);
      expect(st.isFile()).toBe(true);
      expect(st.size).toBe(0);
      expect(st.mode & 0o777).toBe(0o444);
    }
  });

  it('creates a missing .claude directory to hold the files, and removes it when empty', () => {
    const { base } = layout();
    const cwd = join(base, 'bare');
    mkdirSync(cwd);
    const stubs = new SandboxStubs(null);
    const created = stubs.hold('o:r', sandboxStubPaths({ cwd, home: base, writableRoots: [cwd], env: {} }));
    expect(created).toContain(join(cwd, '.claude'));
    expect(lstatSync(join(cwd, '.claude')).isDirectory()).toBe(true);
    expect(created).toContain(join(cwd, '.claude', 'settings.local.json'));
    expect(stubs.release('o:r')).toContain(join(cwd, '.claude'));
    expect(existsSync(join(cwd, '.claude'))).toBe(false);
  });

  it('keeps a .claude directory it created once something else is in it', () => {
    const { base } = layout();
    const cwd = join(base, 'bare');
    mkdirSync(cwd);
    const stubs = new SandboxStubs(null);
    stubs.hold('o:r', sandboxStubPaths({ cwd, home: base, writableRoots: [cwd], env: {} }));
    mkdirSync(join(cwd, '.claude', '.cc-writes'));
    expect(stubs.release('o:r')).not.toContain(join(cwd, '.claude'));
    expect(existsSync(join(cwd, '.claude', '.cc-writes'))).toBe(true);
    expect(existsSync(join(cwd, '.claude', 'settings.local.json'))).toBe(false);
  });

  it('never touches a path that already exists, and never removes it', () => {
    const { cwd, home, paths } = layout();
    const settings = join(cwd, '.claude', 'settings.local.json');
    writeFileSync(settings, '{"permissions":{}}');
    mkdirSync(join(home, '.claude', 'hooks'));
    const emptyUserFile = join(cwd, '.mcp.json');
    writeFileSync(emptyUserFile, '');
    const stubs = new SandboxStubs(null);
    const created = stubs.hold('org:run-1', paths);
    expect(created).not.toContain(settings);
    expect(created).not.toContain(join(home, '.claude', 'hooks'));
    expect(created).not.toContain(emptyUserFile);
    expect(created).not.toContain(join(cwd, '.claude'));
    expect(lstatSync(emptyUserFile).mode & 0o222).not.toBe(0);

    const removed = stubs.release('org:run-1');
    expect(removed.sort()).toEqual(created.sort());
    expect(readFileSync(settings, 'utf8')).toBe('{"permissions":{}}');
    expect(lstatSync(join(home, '.claude', 'hooks')).isDirectory()).toBe(true);
    expect(existsSync(emptyUserFile)).toBe(true);
    expect(existsSync(join(cwd, '.claude'))).toBe(true);
    for (const p of created) expect(existsSync(p)).toBe(false);
  });

  it('skips a path whose parent is missing or not a directory', () => {
    const { base } = layout();
    const cwd = join(base, 'worktree');
    mkdirSync(cwd);
    writeFileSync(join(cwd, '.git'), 'gitdir: /elsewhere\n');
    const created = new SandboxStubs(null).hold(
      'o:r',
      sandboxStubPaths({ cwd, home: join(base, 'nohome'), writableRoots: [cwd], env: {} }),
    );
    expect(created).toContain(join(cwd, '.bashrc'));
    expect(created).not.toContain(join(cwd, '.git', 'config.worktree'));
    expect(created.some((p) => p.startsWith(join(base, 'nohome')))).toBe(false);
    expect(existsSync(join(base, 'nohome'))).toBe(false);
  });

  it('keeps a stub until the last run holding it releases it', () => {
    const { paths } = layout();
    const stubs = new SandboxStubs(null);
    const created = stubs.hold('a:run-1', paths);
    expect(stubs.hold('b:run-1', paths)).toEqual([]);
    expect(stubs.release('a:run-1')).toEqual([]);
    for (const p of created) expect(existsSync(p)).toBe(true);
    expect(stubs.release('b:run-1').sort()).toEqual(created.sort());
    for (const p of created) expect(existsSync(p)).toBe(false);
  });

  it('leaves a stub that was written to or replaced by someone else', () => {
    const { cwd, home, paths } = layout();
    const stubs = new SandboxStubs(null);
    stubs.hold('o:r', paths);
    const written = join(cwd, '.bashrc');
    chmodSync(written, 0o644);
    writeFileSync(written, 'export X=1\n');
    const replaced = join(home, '.claude', 'local');
    unlinkSync(replaced);
    writeFileSync(replaced, '');
    const removed = stubs.release('o:r');
    expect(removed).not.toContain(written);
    expect(removed).not.toContain(replaced);
    expect(readFileSync(written, 'utf8')).toBe('export X=1\n');
    expect(existsSync(replaced)).toBe(true);
  });

  it('holds nothing in a directory it cannot write', () => {
    const { cwd, home } = layout();
    chmodSync(join(home, '.claude'), 0o555);
    try {
      const created = new SandboxStubs(null).hold(
        'o:r',
        sandboxStubPaths({ cwd, home, writableRoots: [cwd], env: {} }),
      );
      expect(created.some((p) => p.startsWith(`${join(home, '.claude')}/`))).toBe(false);
      expect(created).toContain(join(cwd, '.bashrc'));
    } finally {
      chmodSync(join(home, '.claude'), 0o755);
    }
  });
});

describe('git excludes', () => {
  it("hide every cwd stub from a 'commit' role's git add", () => {
    const { base } = layout();
    const guard = prepareGitGuard({
      level: 'commit',
      stateDir: join(base, 'guard'),
      excludeSandboxPlaceholders: true,
      protectedGitDirs: [],
    });
    const excludes = readFileSync(join(base, 'guard', 'excludes'), 'utf8').split('\n');
    expect(guard).toBeDefined();
    for (const p of CWD_STUBS) expect(excludes).toContain(`/${p}`);
  });
});
