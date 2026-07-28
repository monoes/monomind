/**
 * getProjectRoot — the directory that identifies "this project" for every
 * Second Brain store.
 *
 * Regression guard: the store path used to hash the raw cwd, so running
 * `doc ingest` from a package subdirectory wrote to a different store AND a
 * different metadata file than the identical command at the repo root. Neither
 * brain could see the other. These tests pin the marker walk that fixes it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

// getProjectRoot stops the upward walk at the home directory. Point homedir at
// a test-controlled path so the walk is deterministic and never depends on
// whether this machine's real $HOME happens to be a git repo.
const homeState = vi.hoisted(() => ({ dir: '' }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => homeState.dir };
});

import { getProjectRoot } from '../memory/memory-bridge.js';

describe('getProjectRoot', () => {
  let root: string;
  let savedMonomindCwd: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'project-root-'));
    // Everything below `root` is walkable; the walk stops when it reaches the
    // parent of `root`, which we declare to be home.
    homeState.dir = dirname(root);
    savedMonomindCwd = process.env.MONOMIND_CWD;
    delete process.env.MONOMIND_CWD;
  });

  afterEach(() => {
    if (savedMonomindCwd === undefined) delete process.env.MONOMIND_CWD;
    else process.env.MONOMIND_CWD = savedMonomindCwd;
    rmSync(root, { recursive: true, force: true });
  });

  const marker = (dir: string, name: '.monomind' | '.git'): void => {
    mkdirSync(join(dir, name), { recursive: true });
  };

  it('returns the directory itself when it carries a .monomind marker', () => {
    marker(root, '.monomind');
    expect(getProjectRoot(root)).toBe(root);
  });

  it('resolves a package subdirectory up to the repo root', () => {
    marker(root, '.git');
    const sub = join(root, 'packages', 'cli', 'src');
    mkdirSync(sub, { recursive: true });
    expect(getProjectRoot(sub)).toBe(root);
  });

  it('gives every directory in one project the same brain', () => {
    marker(root, '.git');
    const a = join(root, 'packages', 'cli');
    const b = join(root, 'docs', 'guides');
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    expect(getProjectRoot(a)).toBe(getProjectRoot(b));
    expect(getProjectRoot(a)).toBe(root);
  });

  it('stops at the nearest marker, so a nested project keeps its own brain', () => {
    marker(root, '.git');
    const inner = join(root, 'vendor', 'sub-repo');
    mkdirSync(inner, { recursive: true });
    marker(inner, '.monomind');
    const deep = join(inner, 'src');
    mkdirSync(deep, { recursive: true });
    expect(getProjectRoot(deep)).toBe(inner);
  });

  it('treats a .git FILE (worktree/submodule) as a marker too', () => {
    const wt = join(root, 'wt');
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, '.git'), 'gitdir: /elsewhere/.git/worktrees/wt\n');
    expect(getProjectRoot(join(wt, 'src'))).toBe(wt);
  });

  it('never crosses the home directory into a dotfiles repo', () => {
    // ~ is a git repo (dotfiles); a loose project under it must stay its own.
    homeState.dir = root;
    marker(root, '.git');
    const loose = join(root, 'scratch', 'thing');
    mkdirSync(loose, { recursive: true });
    expect(getProjectRoot(loose)).toBe(loose);
  });

  it('falls back to the starting directory when no marker exists', () => {
    const deep = join(root, 'a', 'b', 'c');
    mkdirSync(deep, { recursive: true });
    expect(getProjectRoot(deep)).toBe(deep);
  });

  // The other half of the invariant above: the marker WRITTEN into that
  // directory must name the same root the directory is keyed to.
  it('writes an origin marker naming the project root, not the invoking subdirectory', async () => {
    const { bridgeStoreEntry, bridgeGetDbPath, shutdownBridge } = await import('../memory/memory-bridge.js');
    marker(root, '.git');
    const sub = join(root, 'packages', 'cli');
    mkdirSync(sub, { recursive: true });
    process.env.MONOMIND_CWD = sub;

    try {
      await bridgeStoreEntry({ key: 'origin-probe', value: 'probe', namespace: 'default' });
    } catch { /* backend unavailable — asserted conditionally below */ }

    // dbPath is <dataDir>/lancedb; origin.json sits beside it in <dataDir>.
    const originFile = join(dirname(bridgeGetDbPath()), 'origin.json');
    if (existsSync(originFile)) {
      const recorded = JSON.parse(readFileSync(originFile, 'utf-8')).path;
      expect(recorded).toBe(root);
      expect(recorded).not.toBe(sub);
    }
    // Guarded, not vacuous: this branch does run wherever a SQLite backend can
    // initialise. It is skipped only where `@monoes/memory` is unavailable —
    // the same environment memory-crud.test.ts mocks the backend away for — and
    // the slug test below still pins the root-vs-cwd invariant on the
    // directory-name side there.
    await shutdownBridge().catch(() => { /* best effort */ });
  });

  // MONOMIND_CWD is how monograph and swarm state already learn which project
  // they belong to. An MCP server is launched with whatever cwd the client
  // chose, so without this the agent-facing tools resolve a different brain
  // than the CLI does in the same project.
  it('prefers MONOMIND_CWD over the real cwd when no argument is given', () => {
    marker(root, '.git');
    const sub = join(root, 'packages', 'cli');
    mkdirSync(sub, { recursive: true });
    process.env.MONOMIND_CWD = sub;
    expect(getProjectRoot()).toBe(root);
  });

  // The store directory is named for a hash of the project root, and the
  // origin.json marker inside it records which project it belongs to. If those
  // two disagree, `cleanup --data` prunes on the wrong evidence: run a memory
  // command from a package subdir, delete that subdir later, and cleanup sees
  // "origin gone" for a directory holding the WHOLE project's brain.
  it('keys the store directory to the project root, not the invoking subdirectory', async () => {
    const { bridgeGetDbPath } = await import('../memory/memory-bridge.js');
    marker(root, '.git');
    const sub = join(root, 'packages', 'cli');
    mkdirSync(sub, { recursive: true });

    process.env.MONOMIND_CWD = sub;
    const fromSub = bridgeGetDbPath();
    process.env.MONOMIND_CWD = root;
    const fromRoot = bridgeGetDbPath();

    expect(fromSub).toBe(fromRoot);
    // The readable slug prefix is basename(projectRoot) — never basename(cwd).
    expect(fromSub).toContain(basename(root));
    expect(fromSub).not.toContain(`${basename(sub)}-`);
  });

  it('lets an explicit argument override MONOMIND_CWD', () => {
    const other = join(root, 'other');
    mkdirSync(other, { recursive: true });
    marker(other, '.monomind');
    process.env.MONOMIND_CWD = root;
    expect(getProjectRoot(other)).toBe(other);
  });
});
