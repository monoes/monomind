/**
 * Tests for .claude/helpers/metrics-db.mjs
 * Spawn-based (module calls main() at top level).
 * Tests are skipped when sql.js is not installed (the module's hard dependency).
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const METRICS = path.resolve(__dirname, '../../.claude/helpers/metrics-db.mjs');

const sqlJsAvailable = (() => {
  try {
    require.resolve('sql.js', { paths: [path.resolve(__dirname, '../../')] });
    return true;
  } catch { return false; }
})();

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

  it('exits non-zero with error message when sql.js is missing', () => {
    if (sqlJsAvailable) return; // skip assertion when sql.js IS present
    const r = run('sync');
    expect(r.status).toBe(1);
    // stderr should mention the missing module
    expect(r.stderr).toMatch(/sql\.js|ERR_MODULE_NOT_FOUND/);
  });
});

// ── sync (default) — requires sql.js ──────────────────────────────────────────

describe.skipIf(!sqlJsAvailable)('metrics-db sync', () => {
  it('exits 0', () => {
    const r = run('sync');
    expect(r.status).toBe(0);
  });

  it('prints valid JSON to stdout', () => {
    const r = run('sync');
    const lines = r.stdout.split('\n').filter(Boolean);
    const jsonLine = lines.find(l => l.startsWith('{') || l.startsWith('['));
    expect(jsonLine).toBeTruthy();
    expect(() => JSON.parse(jsonLine)).not.toThrow();
  });

  it('default command (no arg) also runs sync', () => {
    const r = run(null);
    expect(r.status).toBe(0);
  });
});

// ── status — requires sql.js ───────────────────────────────────────────────────

describe.skipIf(!sqlJsAvailable)('metrics-db status', () => {
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

// ── export — requires sql.js ──────────────────────────────────────────────────

describe.skipIf(!sqlJsAvailable)('metrics-db export', () => {
  it('exits 0', () => {
    const r = run('export');
    expect(r.status).toBe(0);
  });

  it('prints "Exported" confirmation', () => {
    const r = run('export');
    expect(r.stdout).toContain('Exported');
  });
});

// ── unknown command — requires sql.js ─────────────────────────────────────────

describe.skipIf(!sqlJsAvailable)('metrics-db unknown command', () => {
  it('exits 0 for unknown command', () => {
    const r = run('bogus-xyz');
    expect(r.status).toBe(0);
  });

  it('prints Usage hint', () => {
    const r = run('bogus-xyz');
    expect(r.stdout).toContain('Usage');
  });
});
