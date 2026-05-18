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

// Optional: @monoes/monograph for DB-fixture tests
let _mgLib = null;
try { _mgLib = require('/opt/homebrew/lib/node_modules/@monoes/monograph'); } catch (_) {}
try { if (!_mgLib) _mgLib = require('@monoes/monograph'); } catch (_) {}
const DB_SKIP = !_mgLib;

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

  it('second call also returns null and produces no db file (safe-default verification)', () => {
    const mg = loadMonograph(tmpDir);
    const db1 = mg._openMonographDb();
    const db2 = mg._openMonographDb();
    expect(db1).toBeNull();
    expect(db2).toBeNull();
    expect(fs.existsSync(path.join(tmpDir, '.monomind', 'monograph.db'))).toBe(false);
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

  it('returns [] when no monograph.db exists (single-word path also returns [])', () => {
    const mg = loadMonograph(tmpDir);
    // Returns [] due to missing DB — the 2-keyword guard is a DB-dependent check
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
    expect(() => mg.injectGodNodesContext(tmpDir)).not.toThrow();
  });

  it('does not create knowledge/chunks.jsonl when no monograph.db exists', () => {
    const mg = loadMonograph(tmpDir);
    mg.injectGodNodesContext(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, 'knowledge', 'chunks.jsonl'))).toBe(false);
  });
});

// ── DB-dependent tests (require @monoes/monograph) ────────────────────────────

// Find the monograph package root so we can symlink it into tmpDir/node_modules
// This lets _requireMonograph() inside monograph.cjs resolve the module when CWD=tmpDir.
const MONOGRAPH_PKG_DIR = (() => {
  const candidates = [
    '/opt/homebrew/lib/node_modules/@monoes/monograph',
    '/usr/local/lib/node_modules/@monoes/monograph',
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'package.json'))) return c;
  }
  try {
    let d = path.dirname(require.resolve('@monoes/monograph'));
    while (d !== path.dirname(d)) {
      if (fs.existsSync(path.join(d, 'package.json'))) return d;
      d = path.dirname(d);
    }
  } catch (_) {}
  return null;
})();

function makeFixtureDb(dir) {
  const dbDir = path.join(dir, '.monomind');
  fs.mkdirSync(dbDir, { recursive: true });
  // Symlink @monoes/monograph so _requireMonograph() can find it when CWD = dir
  if (MONOGRAPH_PKG_DIR) {
    const scopeDir = path.join(dir, 'node_modules', '@monoes');
    fs.mkdirSync(scopeDir, { recursive: true });
    const link = path.join(scopeDir, 'monograph');
    try { fs.symlinkSync(MONOGRAPH_PKG_DIR, link, 'dir'); } catch (_) {}
  }
  const dbPath = path.join(dbDir, 'monograph.db');
  const db = _mgLib.openDb(dbPath);
  return { db, dbPath };
}

describe.skipIf(DB_SKIP)('monograph.getMonographSuggestions — with DB', () => {
  it('returns matching nodes for a multi-keyword query', () => {
    const { db } = makeFixtureDb(tmpDir);
    _mgLib.insertNode(db, { id: 'src_authsvc', label: 'File', name: 'AuthService', filePath: 'src/auth/service.ts' });
    _mgLib.insertNode(db, { id: 'src_utils', label: 'File', name: 'utils', filePath: 'src/utils.ts' });
    _mgLib.insertEdge(db, { id: 'e1', sourceId: 'src_authsvc', targetId: 'src_utils', relation: 'IMPORTS', confidence: 1.0, confidenceScore: 1.0 });
    const mg = loadMonograph(tmpDir);
    const results = mg.getMonographSuggestions('authentication service module', 5);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('name');
  });

  it('returns [] when no node matches the keywords', () => {
    makeFixtureDb(tmpDir); // empty DB
    const mg = loadMonograph(tmpDir);
    const results = mg.getMonographSuggestions('nonexistentxyz foobarqux uniqueterm', 5);
    expect(results).toEqual([]);
  });
});

describe.skipIf(DB_SKIP)('monograph.getMonographNeighbors — with DB', () => {
  it('returns imports and importedBy for a known file node', () => {
    const { db } = makeFixtureDb(tmpDir);
    _mgLib.insertNode(db, { id: 'node_a', label: 'File', name: 'auth.ts', filePath: 'src/auth.ts' });
    _mgLib.insertNode(db, { id: 'node_b', label: 'File', name: 'utils.ts', filePath: 'src/utils.ts' });
    _mgLib.insertEdge(db, { id: 'e1', sourceId: 'node_a', targetId: 'node_b', relation: 'IMPORTS', confidence: 1.0, confidenceScore: 1.0 });
    const mg = loadMonograph(tmpDir);
    const result = mg.getMonographNeighbors('src/auth.ts');
    expect(result).not.toBeNull();
    expect(result.imports).toContain('utils.ts');
    expect(Array.isArray(result.importedBy)).toBe(true);
  });

  it('returns null for a file not present in the DB', () => {
    makeFixtureDb(tmpDir);
    const mg = loadMonograph(tmpDir);
    expect(mg.getMonographNeighbors('src/unknown.ts')).toBeNull();
  });
});

describe.skipIf(DB_SKIP)('monograph._findAffectedTests — with DB', () => {
  it('returns test files that import the given source file', () => {
    const { db } = makeFixtureDb(tmpDir);
    _mgLib.insertNode(db, { id: 'src_auth', label: 'File', name: 'auth.ts', filePath: 'src/auth.ts' });
    _mgLib.insertNode(db, { id: 'test_auth', label: 'File', name: 'auth.test.ts', filePath: 'tests/auth.test.ts' });
    _mgLib.insertEdge(db, { id: 'e1', sourceId: 'test_auth', targetId: 'src_auth', relation: 'IMPORTS', confidence: 1.0, confidenceScore: 1.0 });
    const mg = loadMonograph(tmpDir);
    const results = mg._findAffectedTests('src/auth.ts');
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toContain('test');
  });

  it('returns [] when no test files depend on the given file', () => {
    const { db } = makeFixtureDb(tmpDir);
    _mgLib.insertNode(db, { id: 'src_auth', label: 'File', name: 'auth.ts', filePath: 'src/auth.ts' });
    const mg = loadMonograph(tmpDir);
    expect(mg._findAffectedTests('src/auth.ts')).toEqual([]);
  });
});

describe.skipIf(DB_SKIP)('monograph.injectGodNodesContext — with DB', () => {
  it('writes a monograph-god-nodes chunk to knowledge/chunks.jsonl', () => {
    const { db } = makeFixtureDb(tmpDir);
    _mgLib.insertNode(db, { id: 'src_a', label: 'File', name: 'core.ts', filePath: 'src/core.ts' });
    _mgLib.insertNode(db, { id: 'src_b', label: 'File', name: 'helper.ts', filePath: 'src/helper.ts' });
    _mgLib.insertEdge(db, { id: 'e1', sourceId: 'src_b', targetId: 'src_a', relation: 'IMPORTS', confidence: 1.0, confidenceScore: 1.0 });
    const mg = loadMonograph(tmpDir);
    mg.injectGodNodesContext(tmpDir);
    const chunksFile = path.join(tmpDir, '.monomind', 'knowledge', 'chunks.jsonl');
    expect(fs.existsSync(chunksFile)).toBe(true);
    const lines = fs.readFileSync(chunksFile, 'utf-8').trim().split('\n').filter(Boolean);
    const godChunk = lines.map(l => JSON.parse(l)).find(c => c.id === 'monograph-god-nodes');
    expect(godChunk).toBeDefined();
    expect(godChunk.text).toContain('core.ts');
  });
});
