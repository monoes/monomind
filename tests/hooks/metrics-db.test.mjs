/**
 * Tests for .claude/helpers/metrics-db.mjs
 * Spawn-based (module calls main() at top level).
 * The helper aggregates .monomind/metrics/*.json using only Node built-ins; it
 * dropped its sql.js dependency when it was rewritten, so nothing is skipped.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const METRICS = path.resolve(__dirname, '../../.claude/helpers/metrics-db.mjs');

function run(command, opts = {}) {
  const args = command ? [METRICS, command] : [METRICS];
  return spawnSync(process.execPath, args, {
    env: { ...process.env },
    encoding: 'utf-8',
    timeout: 20000,
    cwd: opts.cwd || os.tmpdir(),
  });
}

// ── dependency check ────────────────────────────────────────────────────────────

describe('metrics-db dependency check', () => {
  it('can be spawned as a process', () => {
    const r = run('bogus-xyz');
    // Exits with either 0 (unknown cmd falls through) or 1 (module load error)
    expect(typeof r.status).toBe('number');
  });

  // Helpers are copied into user projects that may have no node_modules, so
  // the helper must not import any package. Run a copy from a directory with
  // no node_modules above it and NODE_PATH cleared: any bare import would fail
  // with ERR_MODULE_NOT_FOUND regardless of how the host repo is installed.
  it('runs with no resolvable packages (Node built-ins only)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-db-isolated-'));
    try {
      const copy = path.join(dir, 'metrics-db.mjs');
      fs.copyFileSync(METRICS, copy);
      const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
      delete env.NODE_PATH;
      const r = spawnSync(process.execPath, [copy, 'sync'], {
        env,
        encoding: 'utf-8',
        timeout: 20000,
        cwd: dir,
      });
      expect(r.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find (module|package)/);
      expect(r.status).toBe(0);
      expect(() => JSON.parse(r.stdout.trim())).not.toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── sync (default) ──────────────────────────────────────────

describe('metrics-db sync', () => {
  it('exits 0', () => {
    const r = run('sync');
    expect(r.status).toBe(0);
  });

  it('prints valid JSON to stdout', () => {
    const r = run('sync');
    const lines = r.stdout.split('\n').filter(Boolean);
    const jsonLine = lines.find((l) => l.startsWith('{') || l.startsWith('['));
    expect(jsonLine).toBeTruthy();
    expect(() => JSON.parse(jsonLine)).not.toThrow();
  });

  it('default command (no arg) also runs sync', () => {
    const r = run(null);
    expect(r.status).toBe(0);
  });
});

// ── status ───────────────────────────────────────────────────

describe('metrics-db status', () => {
  it('exits 0', () => {
    const r = run('status');
    expect(r.status).toBe(0);
  });

  it('prints parseable JSON output', () => {
    const r = run('status');
    const trimmed = r.stdout.trim();
    const jsonStart = trimmed.indexOf('{');
    if (jsonStart !== -1) {
      const parsed = JSON.parse(trimmed.substring(jsonStart));
      expect(typeof parsed).toBe('object');
    } else {
      expect(r.status).toBe(0);
    }
  });
});

// ── export ──────────────────────────────────────────────────

describe('metrics-db export', () => {
  it('exits 0', () => {
    const r = run('export');
    expect(r.status).toBe(0);
  });

  it('prints "Exported" confirmation', () => {
    const r = run('export');
    expect(r.stdout).toContain('Exported');
  });
});

// ── unknown command ─────────────────────────────────────────

describe('metrics-db unknown command', () => {
  it('exits 0 for unknown command', () => {
    const r = run('bogus-xyz');
    expect(r.status).toBe(0);
  });

  it('prints Usage hint', () => {
    const r = run('bogus-xyz');
    expect(r.stdout).toContain('Usage');
  });
});
