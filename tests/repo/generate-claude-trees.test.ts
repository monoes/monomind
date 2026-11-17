/**
 * Guard for `scripts/generate-claude-trees.mjs`, which writes the gitignored
 * derived copies of the root `.claude/` tree (the npm-shipped package tree and
 * the .agents / .gemini / .kimi-code trees). Tested against a fixture repo so
 * the live trees are not touched.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkTrees,
  compileGeneratedSkills,
  diffTrees,
  planTrees,
  probe,
  writeTrees,
} from '../../scripts/generate-claude-trees.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PKG = 'packages/@monomind/cli';
const created: string[] = [];

const locked: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of locked.splice(0)) chmodSync(dir, 0o755);
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function write(root: string, rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function makeFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'generate-claude-trees-'));
  created.push(root);
  write(root, '.claude/skills/alpha/SKILL.md', 'alpha\n');
  write(root, '.claude/skills/alpha/references/r.md', 'ref\n');
  write(root, '.claude/skills/monoagent-image/SKILL.md', 'repo-only skill\n');
  write(root, '.claude/agents/core/coder.md', 'coder\n');
  write(root, '.claude/helpers/hook.cjs', 'hook\n');
  write(root, '.claude/helpers/pre-commit', 'git hook\n');
  write(root, '.claude/settings.json', '{}\n');
  write(root, '.claude/settings.local.json', 'machine-local\n');
  write(root, '.claude/mcp.json', 'repo-only\n');
  write(root, `${PKG}/claude-overlay/agents/squad/boss.md`, 'overlay only\n');
  return root;
}

const kimiConvert = () => ({
  agents: new Map([['coder.md', 'kimi coder\n']]),
  pluginCommands: new Map(),
  skills: new Map([['alpha', 'kimi alpha\n']]),
});

describe('generate-claude-trees', () => {
  it('derives the package, platform and kimi trees from .claude plus the overlay', () => {
    const root = makeFixture();
    const wanted = planTrees({ root, kimiConvert });
    writeTrees({ outRoot: root, wanted });
    const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

    expect(read(`${PKG}/.claude/skills/alpha/SKILL.md`)).toBe('alpha\n');
    expect(read(`${PKG}/.claude/agents/squad/boss.md`)).toBe('overlay only\n');
    expect(read(`${PKG}/.claude/settings.json`)).toBe('{}\n');
    expect(read('.agents/skills/alpha/references/r.md')).toBe('ref\n');
    expect(read('.gemini/helpers/hook.cjs')).toBe('hook\n');
    expect(read('.kimi-code/agents/coder.md')).toBe('kimi coder\n');
    expect(read('.kimi-code/skills/alpha/SKILL.md')).toBe('kimi alpha\n');
    expect(read('.kimi-code/skills/alpha/references/r.md')).toBe('ref\n');

    // Repo-only and machine-local files never reach the shipped tree.
    for (const rel of [
      `${PKG}/.claude/mcp.json`,
      `${PKG}/.claude/settings.local.json`,
      `${PKG}/.claude/helpers/pre-commit`,
      `${PKG}/.claude/skills/monoagent-image/SKILL.md`,
      '.gemini/helpers/pre-commit',
    ]) {
      expect(existsSync(join(root, rel)), rel).toBe(false);
    }
  });

  it('is idempotent and removes stale files from generated trees only', () => {
    const root = makeFixture();
    const wanted = planTrees({ root, kimiConvert });
    writeTrees({ outRoot: root, wanted });
    write(root, `${PKG}/.claude/agents/core/stale.md`, 'stale\n');
    write(root, '.gemini/helpers/statusline.sh', 'tracked extra\n');
    write(root, '.gemini/settings.json', 'hand-written\n');

    expect(diffTrees({ outRoot: root, wanted }).stale).toEqual([
      `${PKG}/.claude/agents/core/stale.md`,
    ]);
    const second = writeTrees({ outRoot: root, wanted });
    expect(second.written).toEqual([]);
    expect(second.removed).toEqual([`${PKG}/.claude/agents/core/stale.md`]);
    expect(existsSync(join(root, '.gemini/helpers/statusline.sh'))).toBe(true);
    expect(existsSync(join(root, '.gemini/settings.json'))).toBe(true);
  });

  it('reports a diverged generated file', () => {
    const root = makeFixture();
    const wanted = planTrees({ root, kimiConvert });
    writeTrees({ outRoot: root, wanted });
    write(root, '.agents/skills/alpha/SKILL.md', 'hand edit\n');
    expect(diffTrees({ outRoot: root, wanted }).diverged).toEqual([
      '.agents/skills/alpha/SKILL.md',
    ]);
  });

  it('falls back to every file on disk with a warning when git cannot list .claude/ (#796)', () => {
    const root = makeFixture(); // a temp dir, not a git checkout
    write(root, '.claude/skills/alpha/untracked-local.md', 'machine-local\n');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const wanted = planTrees({ root, kimiConvert });
    expect(wanted.has(`${PKG}/.claude/skills/alpha/untracked-local.md`)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/untracked machine-local files/);
  });

  it('fails instead of falling back when strict (release builds, #796)', () => {
    const root = makeFixture();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => planTrees({ root, kimiConvert, strict: true })).toThrow(
      /git ls-files .*ships only git-tracked \.claude\/ files/s,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('reports the stderr of a failing monodesign compile instead of discarding it (#796)', () => {
    const root = makeFixture();
    write(
      root,
      'packages/@monoes/monodesign/scripts/sync-skill.mjs',
      "process.stderr.write('sync-skill exploded\\n'); process.exit(3);\n",
    );
    expect(() => compileGeneratedSkills(root)).toThrow(/monodesign[\s\S]*sync-skill exploded/);
  });

  it('regenerates the live repo deterministically and completely', async () => {
    expect(await checkTrees({ root: REPO_ROOT, kimi: false })).toEqual([]);
  }, 120_000);

  describe('probe (#789)', () => {
    /** The fixture as a git checkout: the probe plans from `git ls-files`. */
    const gitFixture = (): string => {
      const root = realpathSync(makeFixture());
      execFileSync('git', ['init', '-q'], { cwd: root });
      execFileSync('git', ['add', '-A'], { cwd: root });
      return root;
    };
    const lock = (dir: string) => {
      chmodSync(dir, 0o555);
      locked.push(dir);
    };
    const asRoot = process.getuid?.() === 0;

    it('passes on a fresh checkout and leaves nothing behind', () => {
      const root = gitFixture();
      const before = readdirSync(root).sort();
      expect(probe(root)).toEqual([]);
      expect(readdirSync(root).sort()).toEqual(before);
      expect(existsSync(join(root, PKG, '.claude'))).toBe(false);
    });

    it.skipIf(asRoot)(
      'fails when a destination refuses writes and something there needs writing',
      () => {
        const root = gitFixture();
        writeTrees({ outRoot: root, wanted: planTrees({ root }), withKimi: false });
        rmSync(join(root, PKG, '.claude/agents/core/coder.md'));
        lock(join(root, PKG, '.claude/agents'));
        expect(() => probe(root)).toThrow(
          /cannot write under .*\.claude\/agents \(EACCES\), and 1 file\(s\) there need writing, e\.g\. .*core\/coder\.md[\s\S]*\.claude\/commands/,
        );
        // The release preflight probes the operator's checkout: host only.
        expect(probe(root, { hostOnly: true })).toEqual([]);
      },
    );

    it.skipIf(asRoot)('passes with a note when the refused destination is already current', () => {
      const root = gitFixture();
      writeTrees({ outRoot: root, wanted: planTrees({ root }), withKimi: false });
      lock(join(root, PKG, '.claude/agents'));
      const notes = probe(root);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatch(
        /\.claude\/agents are refused here \(EACCES\), but every file there is current/,
      );
    });

    // The 2.29.4 builder: the SDK's seatbelt profile denies writes below any
    // `.claude/agents` or `.claude/commands` under the session's cwd, however
    // allowWrite is set (claude-agent-sdk 0.3.319 sandbox runtime).
    const seatbelt =
      process.platform === 'darwin' &&
      spawnSync('sandbox-exec', ['-p', '(version 1)(allow default)', '/usr/bin/true']).status === 0;
    it.skipIf(!seatbelt)('catches the SDK seatbelt rule before the build does', () => {
      const root = gitFixture();
      mkdirSync(join(root, 'scripts'));
      copyFileSync(
        join(REPO_ROOT, 'scripts/generate-claude-trees.mjs'),
        join(root, 'scripts/generate-claude-trees.mjs'),
      );
      const esc = (p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const tmp = realpathSync(tmpdir());
      const deny = ['.claude/agents', '.claude/commands']
        .map(
          (d) =>
            `(subpath ${JSON.stringify(`${root}/${d}`)}) (regex ${JSON.stringify(`^${esc(root)}/(.*/)?${esc(d)}/.*(/.*)?$`)})`,
        )
        .join(' ');
      const profile =
        `(version 1)(allow default)(deny file-write*)` +
        `(allow file-write* (subpath ${JSON.stringify(root)}) (subpath ${JSON.stringify(tmp)}) (literal "/dev/null"))` +
        `(deny file-write* ${deny})`;
      const run = (...args: string[]) =>
        spawnSync(
          'sandbox-exec',
          ['-p', profile, process.execPath, 'scripts/generate-claude-trees.mjs', ...args],
          {
            cwd: root,
            encoding: 'utf8',
          },
        );

      const build = run('--no-kimi');
      expect(build.status).toBe(1);
      expect(build.stderr).toMatch(
        /EPERM: operation not permitted, mkdir '.*\/\.claude\/agents\/core'/,
      );
      const stale = run('--probe');
      expect(stale.status).toBe(1);
      expect(stale.stderr).toMatch(
        /cannot write under .*\.claude\/agents \(EPERM\)[\s\S]*from outside that\s+sandbox/,
      );

      writeTrees({ outRoot: root, wanted: planTrees({ root }), withKimi: false }); // the publisher
      const fresh = run('--probe');
      expect(fresh.status, fresh.stderr).toBe(0);
      expect(fresh.stdout).toMatch(/\.claude\/agents are refused here \(EPERM\)/);
      expect(run('--no-kimi').stdout).toMatch(/0 written, 0 removed/);
    });
  });
});
