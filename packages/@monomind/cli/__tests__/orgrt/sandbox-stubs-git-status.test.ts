// packages/@monomind/cli/__tests__/orgrt/sandbox-stubs-git-status.test.ts
// An org run with workspace: repo holds mount-point stubs in the repo root (.bashrc, .gitconfig, .claude/hooks, …)
// for the whole run, so `git status` lists them while the run is alive. When the run ends they must be gone:
// the release runs of 2.23.0 to 2.24.1 were reported to leave them behind. Real processes and a real git repo in a
// temp dir (never the real HOME), no model. Covers the process ending by itself and a SIGKILL'd one whose stubs the
// next runtime reclaims.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { SandboxStubs, sandboxStubPaths } from '../../src/orgrt/sandbox-stubs.js';

const fixture = join(dirname(fileURLToPath(import.meta.url)), 'stubs-holder.fixture.ts');

const dirs: string[] = [];
const children: ChildProcess[] = [];
afterEach(() => {
  for (const c of children.splice(0)) c.kill('SIGKILL');
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function repo() {
  const base = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'stubgit-'));
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
  return { base, cwd, home, paths, status: () => git('status', '--porcelain').trim(), ledger: join(base, 'ledger', 'ledger.json') };
}

/** Runs the holder to the end of its life (or until it prints "ready" and is killed). */
function run(r: ReturnType<typeof repo>, mode: 'exit' | 'plain') {
  const child = spawn(process.execPath, ['--import', 'tsx', fixture, r.ledger, JSON.stringify(r.paths), mode], {
    env: { ...process.env, HOME: r.home, MONOMIND_ORGRT_STUBS_DIR: join(r.base, 'ledger') },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  children.push(child);
  return child;
}
const ready = (c: ChildProcess) =>
  new Promise<void>((resolve, reject) => {
    c.once('error', reject);
    c.stdout?.on('data', (d) => String(d).includes('ready') && resolve());
  });
const exited = (c: ChildProcess) => new Promise<void>((resolve) => c.once('exit', () => resolve()));

describe('a run that held stubs in the repo root leaves git status clean', () => {
  it('is dirty while the run is alive, clean once the process has ended on its own', async () => {
    const r = repo();
    const c = run(r, 'plain');
    await ready(c);
    expect(r.status()).toMatch(/\.bashrc/); // held for the whole run, by design
    const done = exited(c);
    c.kill('SIGTERM');
    await done;
    expect(r.status()).toBe('');
    const c2 = run(r, 'exit');
    await exited(c2);
    expect(r.status()).toBe('');
  }, 40_000);

  it('is clean after a SIGKILL once the next runtime has started', async () => {
    const r = repo();
    const c = run(r, 'plain');
    await ready(c);
    const done = exited(c);
    c.kill('SIGKILL');
    await done;
    expect(r.status()).toMatch(/\.bashrc/); // nothing could clean up
    new SandboxStubs(r.ledger).hold('next-run', []); // the next runtime's first hold reclaims the ledger
    expect(r.status()).toBe('');
  }, 40_000);
});
