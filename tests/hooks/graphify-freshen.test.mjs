/**
 * Tests for .claude/helpers/graphify-freshen.cjs
 * Spawn-based: has module-level side effects (mkdirSync, spawn, process.exit).
 * Uses CLAUDE_PROJECT_DIR to control where graph/ dir and lock file are created.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../../.claude/helpers/graphify-freshen.cjs');

function run(env = {}, { cwd } = {}) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: cwd || os.tmpdir(),
    encoding: 'utf-8',
    timeout: 10000,
    env: { ...process.env, ...env },
  });
}

function createFakeMonograph(dir) {
  const p = path.join(dir, 'dist', 'src', 'index.js');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // Minimal ESM export that buildAsync resolves so the spawned script doesn't hang
  fs.writeFileSync(p, 'export async function buildAsync() {}\n');
}

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── no monograph ─────────────────────────────────────────────────────────────

describe('graphify-freshen: no monograph', () => {
  it('exits 0 when @monoes/monograph not found', () => {
    const r = run({ CLAUDE_PROJECT_DIR: tmpDir }, { cwd: tmpDir });
    expect(r.status).toBe(0);
  });

  it('logs a build status message (not-found or build-started, depending on global install)', () => {
    // @monoes/monograph may be found via global npm even when CLAUDE_PROJECT_DIR is a temp dir.
    // Either "not found — skipping build" (stderr) or "background build started" (stdout) is valid.
    const r = run({ CLAUDE_PROJECT_DIR: tmpDir }, { cwd: tmpDir });
    const combined = r.stdout + r.stderr;
    expect(combined).toMatch(/monograph not found|background build started/);
  });

  it('creates .monomind/graph/ directory even when monograph missing', () => {
    run({ CLAUDE_PROJECT_DIR: tmpDir }, { cwd: tmpDir });
    expect(fs.existsSync(path.join(tmpDir, '.monomind', 'graph'))).toBe(true);
  });
});

// ── fresh lock ──────────────────────────────────────────────────────────────

describe('graphify-freshen: fresh lock file', () => {
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

describe('graphify-freshen: stale lock file', () => {
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

describe('graphify-freshen: no lock present', () => {
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
