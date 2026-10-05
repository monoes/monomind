// packages/@monomind/cli/__tests__/orgrt/sandbox-stubs-exclude.test.ts
// While a run holds sandbox stubs in the repo root, `git status` must not list them: the runtime lists them in
// the repo's info/exclude for as long as they exist, and takes its block out again when they are gone.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SandboxStubs, sandboxStubPaths } from '../../src/orgrt/sandbox-stubs.js';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function repo() {
  const base = mkdtempSync(join(tmpdir(), 'stubex-'));
  dirs.push(base);
  const cwd = join(base, 'repo');
  const home = join(base, 'home');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(join(home, '.claude'), { recursive: true });
  const git = (...a: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });
  git('init', '-q');
  writeFileSync(join(cwd, 'README.md'), 'x\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  const paths = sandboxStubPaths({ cwd, home, writableRoots: [cwd, home], env: {} });
  return { base, cwd, home, paths, git, status: () => git('status', '--porcelain').trim() };
}

describe('stubs held in a git repo root', () => {
  it('are not listed by git status while held, and the exclude block is gone after release', () => {
    const r = repo();
    const stubs = new SandboxStubs(null);
    stubs.hold('run-1', r.paths);
    expect(r.status()).toBe('');
    stubs.release('run-1');
    expect(r.status()).toBe('');
    expect(readFileSync(join(r.cwd, '.git', 'info', 'exclude'), 'utf8')).not.toMatch(/monomind sandbox stubs/);
  });

  it('keeps a real file of the same name visible and never excludes it', () => {
    const r = repo();
    writeFileSync(join(r.cwd, '.bashrc'), 'export A=1\n');
    const stubs = new SandboxStubs(null);
    stubs.hold('run-1', r.paths);
    expect(r.status()).toContain('.bashrc');
    stubs.release('run-1');
  });

  it('keeps the block while another holder’s stubs still exist, and works in a linked worktree', () => {
    const r = repo();
    const first = new SandboxStubs(null);
    first.hold('run-1', r.paths);
    const second = new SandboxStubs(null);
    second.hold('run-2', r.paths); // exists already: not its own, so it holds nothing
    second.release('run-2');
    expect(r.status()).toBe('');
    first.release('run-1');
    const wt = join(r.base, 'wt');
    r.git('worktree', 'add', '-q', wt, '-b', 'b');
    const wpaths = sandboxStubPaths({ cwd: wt, home: r.home, writableRoots: [wt, r.home], env: {} });
    const stubs = new SandboxStubs(null);
    stubs.hold('run-3', wpaths);
    const out = execFileSync('git', ['status', '--porcelain'], { cwd: wt, encoding: 'utf8' }).trim();
    expect(out).toBe('');
    stubs.release('run-3');
  });
});
