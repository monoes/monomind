/**
 * Tests for .claude/helpers/utils/monograph-resolve.cjs (#328): where the hooks
 * find @monoes/monograph, how they rebuild with it, and what they say when
 * they can't.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MOD_PATH = path.resolve(__dirname, '../../.claude/helpers/utils/monograph-resolve.cjs');

function loadMod() {
  delete require.cache[MOD_PATH];
  return require(MOD_PATH);
}

// A fake @monoes/monograph whose buildAsync runs `body`.
function fakeMonograph(pkgDir, { version = '1.0.0', body = '' } = {}) {
  fs.mkdirSync(path.join(pkgDir, 'dist', 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({
      name: '@monoes/monograph',
      version,
      type: 'module',
      exports: { '.': { import: './dist/src/index.js' } },
    }),
  );
  fs.writeFileSync(
    path.join(pkgDir, 'dist', 'src', 'index.js'),
    `export async function buildAsync(dir) {${body}}\n`,
  );
  return path.join(pkgDir, 'dist', 'src', 'index.js');
}

function waitFor(pred, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  return pred();
}

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

// A git repo whose monograph.db records the first commit, `extra` commits ago.
function staleGraphRepo(dir, extra) {
  git(dir, 'init', '-q');
  git(
    dir,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'c0',
  );
  const first = git(dir, 'rev-parse', 'HEAD');
  for (let i = 0; i < extra; i++) {
    git(
      dir,
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      `c${i + 1}`,
    );
  }
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(path.join(dir, '.monomind'), { recursive: true });
  const db = new DatabaseSync(path.join(dir, '.monomind', 'monograph.db'));
  db.exec('CREATE TABLE index_meta (key TEXT PRIMARY KEY, value TEXT)');
  db.prepare("INSERT INTO index_meta VALUES ('last_commit_hash', ?)").run(first);
  db.close();
  return first;
}

const NOWHERE = { globalRoot: null, npxCacheDir: '/nonexistent-npx-cache', pathEnv: '' };

// Wait for detached rebuilds to exit so removing `tmp` can't race their last
// writes (rebuild-status.json, build.log). Polls asynchronously so this
// process can reap them.
async function waitForExit(pids, ms = 10000) {
  const end = Date.now() + ms;
  for (const pid of pids) {
    while (Date.now() < end) {
      try {
        process.kill(pid, 0);
      } catch {
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}

let tmp;
let project;
let children;
beforeEach(() => {
  children = [];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-resolve-'));
  project = path.join(tmp, 'project');
  fs.mkdirSync(project, { recursive: true });
});
afterEach(async () => {
  await waitForExit(children);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('resolveMonographEntry', () => {
  it('finds a global npm install and returns an absolute entry path', () => {
    const globalRoot = path.join(tmp, 'global');
    const entry = fakeMonograph(path.join(globalRoot, '@monoes', 'monograph'));
    const hit = loadMod().resolveMonographEntry(project, { ...NOWHERE, globalRoot });
    expect(hit.source).toBe('global');
    expect(hit.entry).toBe(entry);
    expect(path.isAbsolute(hit.entry)).toBe(true);
  });

  it('finds the copy bundled with a global monomind CLI', () => {
    const globalRoot = path.join(tmp, 'global');
    const entry = fakeMonograph(
      path.join(globalRoot, 'monomind', 'node_modules', '@monoes', 'monograph'),
    );
    const hit = loadMod().resolveMonographEntry(project, { ...NOWHERE, globalRoot });
    expect(hit).toMatchObject({ source: 'global', entry });
  });

  it('finds the newest copy in the npx cache the MCP server uses', () => {
    const cache = path.join(tmp, 'npm-cache');
    fakeMonograph(path.join(cache, '_npx', 'aaa', 'node_modules', '@monoes', 'monograph'), {
      version: '1.5.0',
    });
    const newer = fakeMonograph(
      path.join(cache, '_npx', 'bbb', 'node_modules', '@monoes', 'monograph'),
      { version: '1.10.2' },
    );
    const hit = loadMod().resolveMonographEntry(project, { ...NOWHERE, npxCacheDir: cache });
    expect(hit).toMatchObject({ source: 'npx', entry: newer, version: '1.10.2' });
  });

  it('prefers the project install over global and npx copies', () => {
    const globalRoot = path.join(tmp, 'global');
    fakeMonograph(path.join(globalRoot, '@monoes', 'monograph'));
    const local = fakeMonograph(path.join(project, 'node_modules', '@monoes', 'monograph'));
    const hit = loadMod().resolveMonographEntry(project, { ...NOWHERE, globalRoot });
    expect(hit).toMatchObject({ source: 'local', entry: local });
  });

  it('ignores a dist/src/index.js that is not @monoes/monograph', () => {
    fs.mkdirSync(path.join(project, 'dist', 'src'), { recursive: true });
    fs.writeFileSync(path.join(project, 'dist', 'src', 'index.js'), 'export {}\n');
    fs.writeFileSync(path.join(project, 'package.json'), '{"name":"my-app"}');
    expect(loadMod().resolveMonographEntry(project, NOWHERE)).toBeNull();
  });

  it('returns null when nothing resolves', () => {
    expect(loadMod().resolveMonographEntry(project, NOWHERE)).toBeNull();
  });
});

describe('startRebuild', () => {
  it('imports the resolved copy by absolute URL, then removes the lock', () => {
    const marker = path.join(tmp, 'built');
    const globalRoot = path.join(tmp, 'global');
    fakeMonograph(path.join(globalRoot, '@monoes', 'monograph'), {
      body: `(await import('node:fs')).writeFileSync(${JSON.stringify(marker)}, dir);`,
    });
    const mod = loadMod();
    const resolved = mod.resolveMonographEntry(project, { ...NOWHERE, globalRoot });
    const lockPath = path.join(project, '.monomind', 'graph', '.rebuild-lock');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, String(process.pid));
    const r = mod.startRebuild(project, { resolved, lockPath });
    children.push(r.pid);
    expect(r.mode).toBe('module');
    expect(waitFor(() => fs.existsSync(marker))).toBe(true);
    expect(fs.readFileSync(marker, 'utf-8')).toBe(project);
    expect(waitFor(() => !fs.existsSync(lockPath))).toBe(true);
    expect(waitFor(() => mod.readRebuildStatus(project)?.ok === true)).toBe(true);
  });

  it('falls back to `monomind monograph build` when no package resolves', () => {
    const argsFile = path.join(tmp, 'cli-args');
    const bin = path.join(project, 'node_modules', '.bin', 'monomind');
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin, `#!/bin/sh\necho "$@" > ${JSON.stringify(argsFile)}\n`);
    fs.chmodSync(bin, 0o755);
    const r = loadMod().startRebuild(project, { resolved: null });
    children.push(r.pid);
    expect(r.mode).toBe('cli');
    expect(
      waitFor(() => fs.existsSync(argsFile) && fs.readFileSync(argsFile, 'utf-8')),
    ).toBeTruthy();
    expect(fs.readFileSync(argsFile, 'utf-8').trim()).toBe(`monograph build --path ${project}`);
  });

  it('records a native-module failure with the allow-scripts fix', () => {
    const globalRoot = path.join(tmp, 'global');
    fakeMonograph(path.join(globalRoot, '@monoes', 'monograph'), {
      body: `throw new Error('Could not locate the bindings file. Tried: better_sqlite3.node');`,
    });
    const mod = loadMod();
    const resolved = mod.resolveMonographEntry(project, { ...NOWHERE, globalRoot });
    children.push(mod.startRebuild(project, { resolved }).pid);
    expect(waitFor(() => mod.readRebuildStatus(project)?.ok === false)).toBe(true);
    const status = mod.readRebuildStatus(project);
    expect(status.reason).toBe('native');
    expect(status.fix).toBe('npm i -g --allow-scripts=better-sqlite3 @monoes/monograph');
  });

  it('writes one build.log line for a repeated unresolvable failure', () => {
    const mod = loadMod();
    const saved = process.env.PATH;
    process.env.PATH = '';
    try {
      for (let i = 0; i < 5; i++)
        expect(mod.startRebuild(project, { resolved: null }).mode).toBe('none');
    } finally {
      process.env.PATH = saved;
    }
    const log = fs.readFileSync(path.join(project, '.monomind', 'graph', 'build.log'), 'utf-8');
    expect(log.trim().split('\n')).toHaveLength(1);
    expect(log).toContain('npm i -g --allow-scripts=better-sqlite3 @monoes/monograph');
    const status = mod.readRebuildStatus(project);
    expect(status).toMatchObject({ ok: false, reason: 'unresolvable', repeats: 5 });
  });
});

describe('capBuildLog', () => {
  it('moves a build.log over 1 MB aside', () => {
    const mod = loadMod();
    const log = path.join(project, '.monomind', 'graph', 'build.log');
    fs.mkdirSync(path.dirname(log), { recursive: true });
    fs.writeFileSync(log, 'x'.repeat(mod.BUILD_LOG_MAX_BYTES + 1));
    mod.capBuildLog(project);
    expect(fs.existsSync(log)).toBe(false);
    expect(fs.statSync(`${log}.1`).size).toBe(mod.BUILD_LOG_MAX_BYTES + 1);
  });
});

describe('claimRebuildLock', () => {
  function lockWith(pid, ageMs) {
    const lock = path.join(project, '.rebuild-lock');
    fs.writeFileSync(lock, String(pid));
    const t = new Date(Date.now() - ageMs);
    fs.utimesSync(lock, t, t);
    return lock;
  }
  // A PID that is certainly not running: a child that already exited.
  const deadPid = () => {
    const { pid } = require('node:child_process').spawnSync(process.execPath, ['-e', '0']);
    return pid;
  };

  it('treats a lock whose PID has exited as stale once past the cooldown', () => {
    const lock = lockWith(deadPid(), 60 * 1000);
    expect(loadMod().claimRebuildLock(lock, 5000, 10 * 60 * 1000)).toBe(true);
    expect(fs.readFileSync(lock, 'utf-8')).toBe(String(process.pid));
  });

  it('keeps a lock whose PID is still running', () => {
    const lock = lockWith(process.pid, 60 * 1000);
    expect(loadMod().claimRebuildLock(lock, 5000, 10 * 60 * 1000)).toBe(false);
  });

  it('keeps a dead-PID lock inside the cooldown', () => {
    const lock = lockWith(deadPid(), 1000);
    expect(loadMod().claimRebuildLock(lock, 5000, 10 * 60 * 1000)).toBe(false);
  });
});

describe('diagnose + sessionWarning', () => {
  it('warns once at SessionStart when the graph is stale and nothing can rebuild it', () => {
    staleGraphRepo(project, 3);
    const mod = loadMod();
    const diag = mod.diagnose(project, NOWHERE);
    expect(diag).toMatchObject({ canRebuild: false, behind: 3, dbExists: true });
    expect(mod.sessionWarning(diag)).toBe(
      '[MONOGRAPH_WARN] The monograph graph is 3 commit(s) behind HEAD and the hooks cannot rebuild it: ' +
        '@monoes/monograph not found by the hooks (project, global npm root, npx cache) — run: ' +
        'npm i -g --allow-scripts=better-sqlite3 @monoes/monograph',
    );
  });

  it('says nothing when the graph is at HEAD', () => {
    staleGraphRepo(project, 0);
    const mod = loadMod();
    expect(mod.sessionWarning(mod.diagnose(project, NOWHERE))).toBeNull();
  });

  it('can rebuild through the monomind CLI on PATH', () => {
    const binDir = path.join(tmp, 'bin');
    fs.mkdirSync(binDir);
    fs.writeFileSync(path.join(binDir, 'monomind'), '#!/bin/sh\n');
    staleGraphRepo(project, 2);
    const mod = loadMod();
    const diag = mod.diagnose(project, { ...NOWHERE, pathEnv: binDir });
    expect(diag.canRebuild).toBe(true);
    expect(mod.sessionWarning(diag)).toBeNull();
  });
});

describe('graphOffNoticeOnce', () => {
  it('says once that the gate and hints are off when the hooks cannot open the graph', () => {
    staleGraphRepo(project, 0);
    const mod = loadMod();
    expect(mod.graphOffNoticeOnce(project, null)).toMatch(
      /^\[MONOGRAPH_OFF\] The hooks cannot load/,
    );
    expect(mod.graphOffNoticeOnce(project, null)).toBeNull();
  });

  it('says once that the graph is past the 50-commit limit', () => {
    staleGraphRepo(project, 51);
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(project, '.monomind', 'monograph.db'));
    try {
      const mod = loadMod();
      expect(mod.graphOffNoticeOnce(project, db)).toMatch(/is 51 commits behind HEAD \(limit 50\)/);
      expect(mod.graphOffNoticeOnce(project, db)).toBeNull();
    } finally {
      db.close();
    }
  });
});
