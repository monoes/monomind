/**
 * Tests for .claude/helpers/learning-service.mjs
 * Requires better-sqlite3 (native module). When not installed, all DB-dependent
 * tests are skipped. The dependency-check suite always runs to document the
 * correct failure behavior.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../../.claude/helpers/learning-service.mjs');
const SCRIPT_DIR = path.dirname(SCRIPT);
const require = createRequire(import.meta.url);

const betterSqlite3Available = (() => {
  try {
    require.resolve('better-sqlite3', { paths: [SCRIPT_DIR, process.cwd()] });
    return true;
  } catch { return false; }
})();

function runScript(args = [], opts = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf-8',
    timeout: 15000,
    cwd: opts.cwd || os.tmpdir(),
    env: { ...process.env, ...(opts.env || {}) },
  });
}

// ── dependency check (always runs) ──────────────────────────────────────────

describe('learning-service dependency check', () => {
  it('fails to load when better-sqlite3 is not installed', () => {
    if (betterSqlite3Available) return; // skip if installed
    const r = runScript(['help']);
    expect(r.status).not.toBe(0);
  });

  it('error output mentions better-sqlite3 when dependency missing', () => {
    if (betterSqlite3Available) return;
    const r = runScript(['help']);
    const combined = r.stdout + r.stderr;
    expect(combined.toLowerCase()).toMatch(/better-sqlite3|cannot find/i);
  });
});

// ── CLI commands (skipped when better-sqlite3 unavailable) ──────────────────

describe.skipIf(!betterSqlite3Available)('learning-service CLI: help', () => {
  it('help command exits 0', () => {
    const r = runScript(['help']);
    expect(r.status).toBe(0);
  });

  it('help output lists known subcommands', () => {
    const r = runScript(['help']);
    const out = r.stdout + r.stderr;
    expect(out).toMatch(/init|store|search|consolidate|stats/i);
  });

  it('unknown subcommand shows usage', () => {
    const r = runScript(['unknown-command-xyz']);
    const out = r.stdout + r.stderr;
    expect(out).toMatch(/usage|help|unknown/i);
  });
});

describe.skipIf(!betterSqlite3Available)('learning-service CLI: init', () => {
  it('init exits 0', () => {
    const tmpDir = require('os').tmpdir();
    const r = runScript(['init'], { env: { CLAUDE_PROJECT_DIR: tmpDir } });
    expect(r.status).toBe(0);
  });
});

describe.skipIf(!betterSqlite3Available)('learning-service CLI: stats', () => {
  it('stats exits 0 after init', () => {
    const tmpDir = require('os').tmpdir();
    runScript(['init'], { env: { CLAUDE_PROJECT_DIR: tmpDir } });
    const r = runScript(['stats'], { env: { CLAUDE_PROJECT_DIR: tmpDir } });
    expect(r.status).toBe(0);
  });
});

describe.skipIf(!betterSqlite3Available)('learning-service CLI: store and search', () => {
  it('store exits 0 with valid strategy text', () => {
    const tmpDir = require('os').tmpdir();
    runScript(['init'], { env: { CLAUDE_PROJECT_DIR: tmpDir } });
    const r = runScript(['store', 'use functional components for React hooks pattern'], { env: { CLAUDE_PROJECT_DIR: tmpDir } });
    expect(r.status).toBe(0);
  });

  it('search exits 0 with query', () => {
    const tmpDir = require('os').tmpdir();
    runScript(['init'], { env: { CLAUDE_PROJECT_DIR: tmpDir } });
    const r = runScript(['search', 'React hooks'], { env: { CLAUDE_PROJECT_DIR: tmpDir } });
    expect(r.status).toBe(0);
  });
});

describe.skipIf(!betterSqlite3Available)('learning-service CLI: consolidate', () => {
  it('consolidate exits 0', () => {
    const tmpDir = require('os').tmpdir();
    runScript(['init'], { env: { CLAUDE_PROJECT_DIR: tmpDir } });
    const r = runScript(['consolidate'], { env: { CLAUDE_PROJECT_DIR: tmpDir } });
    expect(r.status).toBe(0);
  });
});

describe.skipIf(!betterSqlite3Available)('learning-service CLI: export', () => {
  it('export exits 0', () => {
    const tmpDir = require('os').tmpdir();
    runScript(['init'], { env: { CLAUDE_PROJECT_DIR: tmpDir } });
    const r = runScript(['export'], { env: { CLAUDE_PROJECT_DIR: tmpDir } });
    expect(r.status).toBe(0);
  });
});

describe.skipIf(!betterSqlite3Available)('learning-service CLI: benchmark', () => {
  it('benchmark exits 0', () => {
    const tmpDir = require('os').tmpdir();
    runScript(['init'], { env: { CLAUDE_PROJECT_DIR: tmpDir } });
    const r = runScript(['benchmark'], { env: { CLAUDE_PROJECT_DIR: tmpDir } });
    expect(r.status).toBe(0);
  });
});
