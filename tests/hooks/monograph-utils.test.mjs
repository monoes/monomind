/**
 * Tests for .claude/helpers/utils/monograph.cjs
 * Most functions gracefully return [] / null when no monograph.db exists.
 * DB-requiring functions are exercised at the safe-default level only.
 * Invalidate both monograph + telemetry caches before each test.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const TELE_PATH = path.resolve(__dirname, '../../.claude/helpers/utils/telemetry.cjs');
const MONO_PATH = path.resolve(__dirname, '../../.claude/helpers/utils/monograph.cjs');

function loadMonograph(cwd) {
  process.env.CLAUDE_PROJECT_DIR = cwd;
  delete require.cache[TELE_PATH];
  delete require.cache[MONO_PATH];
  return require(MONO_PATH);
}

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.CLAUDE_PROJECT_DIR;
});

// ── _openMonographDb ──────────────────────────────────────────────────────────

describe('monograph._openMonographDb', () => {
  it('returns null when monograph.db does not exist', () => {
    const mg = loadMonograph(tmpDir);
    const db = mg._openMonographDb();
    expect(db).toBeNull();
  });

  it('caches null result: second call returns same null without re-checking', () => {
    const mg = loadMonograph(tmpDir);
    const db1 = mg._openMonographDb();
    const db2 = mg._openMonographDb();
    expect(db1).toBeNull();
    expect(db2).toBeNull();
  });
});

// ── getMonographSuggestions ──────────────────────────────────────────────────

describe('monograph.getMonographSuggestions', () => {
  it('returns [] for falsy task text', () => {
    const mg = loadMonograph(tmpDir);
    expect(mg.getMonographSuggestions('', 5)).toEqual([]);
    expect(mg.getMonographSuggestions(null, 5)).toEqual([]);
  });

  it('returns [] when no monograph.db exists', () => {
    const mg = loadMonograph(tmpDir);
    expect(mg.getMonographSuggestions('implement authentication module', 5)).toEqual([]);
  });

  it('returns [] for single-word non-symbol task (requires >= 2 keywords)', () => {
    const mg = loadMonograph(tmpDir);
    expect(mg.getMonographSuggestions('hello', 5)).toEqual([]);
  });
});

// ── getMonographNeighbors ────────────────────────────────────────────────────

describe('monograph.getMonographNeighbors', () => {
  it('returns null for falsy filePath', () => {
    const mg = loadMonograph(tmpDir);
    expect(mg.getMonographNeighbors('')).toBeNull();
    expect(mg.getMonographNeighbors(null)).toBeNull();
  });

  it('returns null when no monograph.db exists', () => {
    const mg = loadMonograph(tmpDir);
    expect(mg.getMonographNeighbors('/src/foo.ts')).toBeNull();
  });
});

// ── _recordGraphTelemetry ────────────────────────────────────────────────────

describe('monograph._recordGraphTelemetry', () => {
  it('creates .monomind/metrics/graph-usage.json', () => {
    const mg = loadMonograph(tmpDir);
    mg._recordGraphTelemetry('monograph_call');
    expect(fs.existsSync(path.join(tmpDir, '.monomind', 'metrics', 'graph-usage.json'))).toBe(true);
  });

  it('increments event count', () => {
    const mg = loadMonograph(tmpDir);
    mg._recordGraphTelemetry('grep_call');
    mg._recordGraphTelemetry('grep_call');
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, '.monomind', 'metrics', 'graph-usage.json'), 'utf-8'));
    expect(data.grep_call).toBe(2);
  });

  it('accumulates tokens_saved for monograph_call events', () => {
    const mg = loadMonograph(tmpDir);
    mg._recordGraphTelemetry('monograph_call');
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, '.monomind', 'metrics', 'graph-usage.json'), 'utf-8'));
    expect(data.tokens_saved).toBeGreaterThan(0);
    expect(data.dollars_saved).toBeGreaterThan(0);
  });

  it('accumulates tokens_wasted for grep_call events', () => {
    const mg = loadMonograph(tmpDir);
    mg._recordGraphTelemetry('grep_call');
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, '.monomind', 'metrics', 'graph-usage.json'), 'utf-8'));
    expect(data.tokens_wasted).toBeGreaterThan(0);
  });

  it('tracks multiple event types independently', () => {
    const mg = loadMonograph(tmpDir);
    mg._recordGraphTelemetry('monograph_call');
    mg._recordGraphTelemetry('glob_call');
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, '.monomind', 'metrics', 'graph-usage.json'), 'utf-8'));
    expect(data.monograph_call).toBe(1);
    expect(data.glob_call).toBe(1);
  });
});

// ── _maybeRebuildMonograph ────────────────────────────────────────────────────

describe('monograph._maybeRebuildMonograph', () => {
  it('creates .monomind/metrics/graph-rebuild.json', () => {
    const mg = loadMonograph(tmpDir);
    mg._maybeRebuildMonograph();
    expect(fs.existsSync(path.join(tmpDir, '.monomind', 'metrics', 'graph-rebuild.json'))).toBe(true);
  });

  it('increments writesSinceRebuild each call', () => {
    const mg = loadMonograph(tmpDir);
    mg._maybeRebuildMonograph();
    mg._maybeRebuildMonograph();
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, '.monomind', 'metrics', 'graph-rebuild.json'), 'utf-8'));
    expect(data.writesSinceRebuild).toBe(2);
  });

  it('resets writesSinceRebuild to 0 after hitting threshold of 20', () => {
    const mg = loadMonograph(tmpDir);
    // Pre-seed the file at count 19 so next call hits threshold
    const rebuildFile = path.join(tmpDir, '.monomind', 'metrics', 'graph-rebuild.json');
    fs.mkdirSync(path.dirname(rebuildFile), { recursive: true });
    fs.writeFileSync(rebuildFile, JSON.stringify({ writesSinceRebuild: 19, lastWriteAt: Date.now() - 6 * 60 * 1000, lastRebuildAt: 0 }));
    mg._maybeRebuildMonograph();
    const data = JSON.parse(fs.readFileSync(rebuildFile, 'utf-8'));
    expect(data.writesSinceRebuild).toBe(0);
    expect(data.lastRebuildAt).toBeGreaterThan(0);
  });

  it('does not reset before threshold (< 20 writes)', () => {
    const mg = loadMonograph(tmpDir);
    for (let i = 0; i < 5; i++) mg._maybeRebuildMonograph();
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, '.monomind', 'metrics', 'graph-rebuild.json'), 'utf-8'));
    expect(data.writesSinceRebuild).toBe(5);
  });
});

// ── _findAffectedTests ────────────────────────────────────────────────────────

describe('monograph._findAffectedTests', () => {
  it('returns [] for falsy filePath', () => {
    const mg = loadMonograph(tmpDir);
    expect(mg._findAffectedTests('')).toEqual([]);
    expect(mg._findAffectedTests(null)).toEqual([]);
  });

  it('returns [] when no monograph.db exists', () => {
    const mg = loadMonograph(tmpDir);
    expect(mg._findAffectedTests('/src/auth.ts')).toEqual([]);
  });
});

// ── injectGodNodesContext ─────────────────────────────────────────────────────

describe('monograph.injectGodNodesContext', () => {
  it('does nothing when no monograph.db file exists', () => {
    const mg = loadMonograph(tmpDir);
    // Should not throw even with no db
    expect(() => mg.injectGodNodesContext(tmpDir)).not.toThrow();
  });
});
