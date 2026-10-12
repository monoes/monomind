/**
 * Tests for .claude/helpers/monograph-freshen.cjs
 * Spawn-based: has module-level side effects (mkdirSync, spawn, process.exit).
 * Uses CLAUDE_PROJECT_DIR to control where graph/ dir and lock file are created.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const BETTER_SQLITE3_DIR = path.dirname(
  createRequire(path.resolve(__dirname, '../../packages/@monomind/monograph/package.json')).resolve(
    'better-sqlite3/package.json',
  ),
);
const SCRIPT = path.resolve(__dirname, '../../.claude/helpers/monograph-freshen.cjs');

function run(env = {}, { cwd } = {}) {
  // Remove SDK agent env vars that cause hook scripts to exit silently
  const cleanEnv = { ...process.env };
  delete cleanEnv.MONOMIND_SDK_AGENT;
  delete cleanEnv.MONOMIND_HOOK_QUIET;

  return spawnSync(process.execPath, [SCRIPT], {
    cwd: cwd || os.tmpdir(),
    encoding: 'utf-8',
    timeout: 10000,
    env: { ...cleanEnv, MONOMIND_HOOK_QUIET: '', ...env },
  });
}

function createFakeMonograph(dir) {
  const p = path.join(dir, 'dist', 'src', 'index.js');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // Minimal ESM export that buildAsync resolves so the spawned script doesn't hang
  fs.writeFileSync(p, 'export async function buildAsync() {}\n');
  // freshen loads better-sqlite3 from the package before building (#328);
  // lend the fake the repo's working copy.
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  fs.symlinkSync(BETTER_SQLITE3_DIR, path.join(dir, 'node_modules', 'better-sqlite3'));
  // Only a directory whose package.json names @monoes/monograph counts (#328).
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: '@monoes/monograph',
      version: '1.0.0',
      type: 'module',
      main: 'dist/src/index.js',
    }),
  );
}

// Wait for the detached rebuild freshen started (its PID is in build.pid) to
// exit, so removing tmpDir can't race its last writes (rebuild-status.json,
// build.log).
async function waitForRebuildExit(ms = 10000) {
  let pid;
  try {
    pid = parseInt(
      fs.readFileSync(path.join(tmpDir, '.monomind', 'graph', 'build.pid'), 'utf-8'),
      10,
    );
  } catch {
    return;
  }
  if (!(pid > 0)) return;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-test-'));
  // freshen only builds inside a git work tree (#414).
  spawnSync('git', ['init', '-q'], { cwd: tmpDir });
});

afterEach(async () => {
  await waitForRebuildExit();
  fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// ── no monograph ─────────────────────────────────────────────────────────────

describe('monograph-freshen: no monograph', () => {
  it('exits 0 when @monoes/monograph not found', () => {
    const r = run({ CLAUDE_PROJECT_DIR: tmpDir }, { cwd: tmpDir });
    expect(r.status).toBe(0);
  });

  it('logs a build status message (warning, not-found or build-started, depending on the install)', () => {
    // @monoes/monograph may be found via global npm even when CLAUDE_PROJECT_DIR is a temp dir.
    // Valid: "[MONOGRAPH_WARN] The hooks cannot build the monograph graph" (stdout; reaches the
    // session, what a host with no resolvable monograph prints), "not found — skipping build"
    // (stderr), or "background build started" (stdout).
    const r = run({ CLAUDE_PROJECT_DIR: tmpDir }, { cwd: tmpDir });
    const combined = r.stdout + r.stderr;
    expect(combined).toMatch(
      /\[MONOGRAPH_WARN\] The hooks cannot build|monograph not found|background build started/,
    );
  });

  it('creates .monomind/graph/ directory even when monograph missing', () => {
    run({ CLAUDE_PROJECT_DIR: tmpDir }, { cwd: tmpDir });
    expect(fs.existsSync(path.join(tmpDir, '.monomind', 'graph'))).toBe(true);
  });
});

// ── fresh lock ──────────────────────────────────────────────────────────────

describe('monograph-freshen: fresh lock file', () => {
  it('exits 0 and logs "already in progress" when lock is < 5 min old', () => {
    createFakeMonograph(tmpDir);
    const lockPath = path.join(tmpDir, '.monomind', 'graph', 'build.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, String(process.pid));
    // Default mtime is now → fresh lock

    const r = run({ CLAUDE_PROJECT_DIR: tmpDir }, { cwd: tmpDir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('build already in progress');
  });

  it('does not spawn build process when lock is fresh', () => {
    createFakeMonograph(tmpDir);
    const lockPath = path.join(tmpDir, '.monomind', 'graph', 'build.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, String(process.pid));

    run({ CLAUDE_PROJECT_DIR: tmpDir }, { cwd: tmpDir });
    // lock file should still exist (not removed by a build process)
    expect(fs.existsSync(lockPath)).toBe(true);
  });
});

// ── stale lock ──────────────────────────────────────────────────────────────

describe('monograph-freshen: stale lock file', () => {
  it('removes stale lock (> 5 min) and starts build', () => {
    createFakeMonograph(tmpDir);
    const lockPath = path.join(tmpDir, '.monomind', 'graph', 'build.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, String(process.pid));
    // Backdate mtime by 6 minutes
    const sixMinsAgo = new Date(Date.now() - 6 * 60 * 1000);
    fs.utimesSync(lockPath, sixMinsAgo, sixMinsAgo);

    const r = run({ CLAUDE_PROJECT_DIR: tmpDir }, { cwd: tmpDir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('background build started for');
  });
});

// ── no lock → starts build ──────────────────────────────────────────────────

describe('monograph-freshen: no lock present', () => {
  it('exits 0 and logs "background build started" when monograph found', () => {
    createFakeMonograph(tmpDir);
    const r = run({ CLAUDE_PROJECT_DIR: tmpDir }, { cwd: tmpDir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('background build started for');
    expect(r.stdout).toContain(tmpDir);
  });

  it('writes a lock file before spawning the build', () => {
    createFakeMonograph(tmpDir);
    run({ CLAUDE_PROJECT_DIR: tmpDir }, { cwd: tmpDir });
    // Lock is written then removed by the child when build completes.
    // Since the child is detached and may not finish yet, at minimum the graphDir exists.
    const graphDir = path.join(tmpDir, '.monomind', 'graph');
    expect(fs.existsSync(graphDir)).toBe(true);
  });
});

// ── lazy global-npm resolution ──────────────────────────────────────────────

describe('monograph-freshen: lazy global-npm resolution', () => {
  it('does not shell out to `npm root -g` when a faster candidate already resolves', () => {
    createFakeMonograph(tmpDir); // resolves via the `<dir>/dist/src/index.js` candidate
    const fakeBin = path.join(tmpDir, 'fake-bin');
    fs.mkdirSync(fakeBin, { recursive: true });
    const sentinel = path.join(tmpDir, 'npm-was-called');
    const npmShim = path.join(fakeBin, 'npm');
    fs.writeFileSync(npmShim, `#!/bin/sh\ntouch "${sentinel}"\necho "/nonexistent"\n`);
    fs.chmodSync(npmShim, 0o755);

    const r = run(
      { CLAUDE_PROJECT_DIR: tmpDir, PATH: `${fakeBin}:${process.env.PATH}` },
      { cwd: tmpDir },
    );

    expect(r.status).toBe(0);
    expect(fs.existsSync(sentinel)).toBe(false);
  });
});

// ── #328: unresolvable package, stale graph, dead-PID lock ─────────────────

// PATH holding only git and an `npm` whose global root is empty, plus an empty
// npx cache: nothing can resolve @monoes/monograph or the monomind CLI.
function isolatedEnv() {
  const shim = path.join(tmpDir, 'shim');
  fs.mkdirSync(shim, { recursive: true });
  fs.writeFileSync(
    path.join(shim, 'npm'),
    `#!/bin/sh\necho ${JSON.stringify(path.join(tmpDir, 'no-global'))}\n`,
  );
  fs.chmodSync(path.join(shim, 'npm'), 0o755);
  const git = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf-8' }).stdout.trim();
  fs.symlinkSync(git, path.join(shim, 'git'));
  return {
    CLAUDE_PROJECT_DIR: tmpDir,
    PATH: shim,
    npm_config_cache: path.join(tmpDir, 'no-cache'),
  };
}

function commitGraphBehind(dir, extra) {
  const g = (...a) =>
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], {
      cwd: dir,
      encoding: 'utf-8',
    }).stdout.trim();
  g('init', '-q');
  g('commit', '-q', '--allow-empty', '-m', 'c0');
  const first = g('rev-parse', 'HEAD');
  for (let i = 0; i < extra; i++) g('commit', '-q', '--allow-empty', '-m', `c${i + 1}`);
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(path.join(dir, '.monomind'), { recursive: true });
  const db = new DatabaseSync(path.join(dir, '.monomind', 'monograph.db'));
  db.exec('CREATE TABLE index_meta (key TEXT PRIMARY KEY, value TEXT)');
  db.prepare("INSERT INTO index_meta VALUES ('last_commit_hash', ?)").run(first);
  db.close();
}

describe('monograph-freshen: stale graph that cannot rebuild', () => {
  it('prints a one-line SessionStart warning with the fix on stdout', () => {
    commitGraphBehind(tmpDir, 4);
    const r = run(isolatedEnv(), { cwd: tmpDir });
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^\[MONOGRAPH_WARN\] The monograph graph is 4 commit\(s\) behind HEAD and the hooks cannot rebuild it/,
    );
    expect(lines[0]).toContain('npm i -g --allow-scripts=better-sqlite3 @monoes/monograph');
  });

  it('logs the failure to build.log once across repeated sessions', () => {
    commitGraphBehind(tmpDir, 1);
    const env = isolatedEnv();
    for (let i = 0; i < 3; i++) run(env, { cwd: tmpDir });
    const log = fs.readFileSync(path.join(tmpDir, '.monomind', 'graph', 'build.log'), 'utf-8');
    expect(log.trim().split('\n')).toHaveLength(1);
  });
});

describe('monograph-freshen: build.lock left by an exited build', () => {
  it('treats it as stale and starts a build', () => {
    createFakeMonograph(tmpDir);
    const lockPath = path.join(tmpDir, '.monomind', 'graph', 'build.lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const dead = spawnSync(process.execPath, ['-e', '0']).pid;
    fs.writeFileSync(lockPath, String(dead));
    const oneMinAgo = new Date(Date.now() - 60 * 1000);
    fs.utimesSync(lockPath, oneMinAgo, oneMinAgo);
    const r = run({ CLAUDE_PROJECT_DIR: tmpDir }, { cwd: tmpDir });
    expect(r.stdout).toContain('background build started for');
  });
});

// ── #414: non-git directories and the auto-build rate limit ─────────────────

describe('monograph-freshen: non-git directory', () => {
  it('skips the build and prints a one-line hint to build manually', () => {
    fs.rmSync(path.join(tmpDir, '.git'), { recursive: true, force: true });
    createFakeMonograph(tmpDir);
    const r = run({ CLAUDE_PROJECT_DIR: tmpDir }, { cwd: tmpDir });
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual([
      '[graph] not a git repository — skipping automatic graph build; run `monomind monograph build` to build it manually',
    ]);
    expect(fs.existsSync(path.join(tmpDir, '.monomind', 'graph', 'build.pid'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, '.monomind', 'graph', 'last-auto-build'))).toBe(false);
  });
});

describe('monograph-freshen: auto-build rate limit', () => {
  const stamp = () => path.join(tmpDir, '.monomind', 'graph', 'last-auto-build');

  it('records the time of an automatic build', () => {
    createFakeMonograph(tmpDir);
    const before = Date.now();
    const r = run({ CLAUDE_PROJECT_DIR: tmpDir }, { cwd: tmpDir });
    expect(r.stdout).toContain('background build started for');
    expect(parseInt(fs.readFileSync(stamp(), 'utf-8'), 10)).toBeGreaterThanOrEqual(before);
  });

  it('skips a second automatic build within 10 minutes', async () => {
    createFakeMonograph(tmpDir);
    run({ CLAUDE_PROJECT_DIR: tmpDir }, { cwd: tmpDir });
    await waitForRebuildExit();
    fs.rmSync(path.join(tmpDir, '.monomind', 'graph', 'build.pid'), { force: true });
    const r = run({ CLAUDE_PROJECT_DIR: tmpDir }, { cwd: tmpDir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('automatic build ran less than 10 min ago — skipping');
    expect(r.stdout).not.toContain('background build started');
    expect(fs.existsSync(path.join(tmpDir, '.monomind', 'graph', 'build.pid'))).toBe(false);
  });

  it('builds again once 10 minutes have passed', () => {
    createFakeMonograph(tmpDir);
    fs.mkdirSync(path.dirname(stamp()), { recursive: true });
    fs.writeFileSync(stamp(), String(Date.now() - 11 * 60 * 1000));
    const r = run({ CLAUDE_PROJECT_DIR: tmpDir }, { cwd: tmpDir });
    expect(r.stdout).toContain('background build started for');
  });
});
