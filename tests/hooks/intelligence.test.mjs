/**
 * Tests for .claude/helpers/intelligence.cjs
 * Uses process.env.CLAUDE_PROJECT_DIR injection before each fresh require()
 * so module-level DATA_DIR / SESSION_DIR resolve to the isolated tmpDir.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const INTL_PATH = path.resolve(__dirname, '../../.claude/helpers/intelligence.cjs');
const ORIG_ENV = process.env.CLAUDE_PROJECT_DIR;

let tmpDir;

function loadIntl() {
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  delete require.cache[INTL_PATH];
  return require(INTL_PATH);
}

function dataDir(dir) { return path.join(dir, '.monomind', 'data'); }
function storePath(dir) { return path.join(dataDir(dir), 'auto-memory-store.json'); }
function rankedPath(dir) { return path.join(dataDir(dir), 'ranked-context.json'); }
function pendingPath(dir) { return path.join(dataDir(dir), 'pending-insights.jsonl'); }

function seedStore(dir, entries) {
  fs.mkdirSync(dataDir(dir), { recursive: true });
  fs.writeFileSync(storePath(dir), JSON.stringify(entries));
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intl-test-'));
});

afterEach(() => {
  if (ORIG_ENV !== undefined) process.env.CLAUDE_PROJECT_DIR = ORIG_ENV;
  else delete process.env.CLAUDE_PROJECT_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── init ───────────────────────────────────────────────────────────────────────

describe('intelligence.init', () => {
  it('returns { nodes, edges } object', () => {
    const intl = loadIntl();
    const result = intl.init();
    expect(result).toHaveProperty('nodes');
    expect(result).toHaveProperty('edges');
    expect(typeof result.nodes).toBe('number');
  });

  it('creates ranked-context.json', () => {
    const intl = loadIntl();
    intl.init();
    expect(fs.existsSync(rankedPath(tmpDir))).toBe(true);
  });

  it('nodes count reflects seeded store entries', () => {
    seedStore(tmpDir, [
      { id: 'e1', content: 'first entry about auth', summary: 'auth', category: 'default', confidence: 0.8 },
      { id: 'e2', content: 'second entry about testing', summary: 'test', category: 'default', confidence: 0.7 },
    ]);
    const intl = loadIntl();
    const result = intl.init();
    expect(result.nodes).toBe(2);
  });

  it('deduplicates entries with the same id', () => {
    seedStore(tmpDir, [
      { id: 'dup', content: 'original', summary: 'orig' },
      { id: 'dup', content: 'duplicate', summary: 'dup' },
      { id: 'unique', content: 'unique entry', summary: 'unique' },
    ]);
    const intl = loadIntl();
    const result = intl.init();
    expect(result.nodes).toBe(2); // 'dup' counted once + 'unique'
  });
});

// ── getContext ─────────────────────────────────────────────────────────────────

describe('intelligence.getContext', () => {
  it('returns null for empty prompt', () => {
    const intl = loadIntl();
    intl.init();
    expect(intl.getContext('')).toBeNull();
  });

  it('returns null for null prompt', () => {
    const intl = loadIntl();
    intl.init();
    expect(intl.getContext(null)).toBeNull();
  });

  it('returns null when no entries exist', () => {
    const intl = loadIntl();
    expect(intl.getContext('implement authentication')).toBeNull();
  });

  it('returns [INTELLIGENCE] context string when matching entries exist', () => {
    seedStore(tmpDir, [
      { id: 'e1', content: 'implement feature authentication oauth jwt', summary: 'auth', category: 'default', confidence: 0.8 },
    ]);
    const intl = loadIntl();
    intl.init();
    const ctx = intl.getContext('implement authentication');
    expect(ctx).toContain('[INTELLIGENCE]');
  });

  it('returns null when prompt has no word overlap with entries', () => {
    seedStore(tmpDir, [
      { id: 'e1', content: 'authentication oauth jwt token', summary: 'auth', category: 'default', confidence: 0.8 },
    ]);
    const intl = loadIntl();
    intl.init();
    expect(intl.getContext('zzzzunrelated1234zzzz')).toBeNull();
  });
});

// ── recordEdit ─────────────────────────────────────────────────────────────────

describe('intelligence.recordEdit', () => {
  it('does not throw for a file path', () => {
    const intl = loadIntl();
    expect(() => intl.recordEdit('/src/auth.ts')).not.toThrow();
  });

  it('handles ring buffer past 50 entries without throwing', () => {
    const intl = loadIntl();
    for (let i = 0; i < 60; i++) intl.recordEdit('/file' + i + '.ts');
  });
});

// ── consolidate ────────────────────────────────────────────────────────────────

describe('intelligence.consolidate', () => {
  it('returns { entries, edges, newEntries } shape', () => {
    const intl = loadIntl();
    const result = intl.consolidate();
    expect(result).toHaveProperty('entries');
    expect(result).toHaveProperty('edges');
    expect(result).toHaveProperty('newEntries');
  });

  it('returns entries=0 when no pending-insights.jsonl exists', () => {
    const intl = loadIntl();
    expect(intl.consolidate().entries).toBe(0);
  });

  it('counts lines in pending-insights.jsonl', () => {
    fs.mkdirSync(dataDir(tmpDir), { recursive: true });
    fs.writeFileSync(pendingPath(tmpDir), '{"a":1}\n{"b":2}\n{"c":3}\n');
    const intl = loadIntl();
    expect(intl.consolidate().entries).toBe(3);
  });

  it('clears pending-insights.jsonl after consolidation', () => {
    fs.mkdirSync(dataDir(tmpDir), { recursive: true });
    fs.writeFileSync(pendingPath(tmpDir), '{"a":1}\n{"b":2}\n');
    const intl = loadIntl();
    intl.consolidate();
    expect(fs.readFileSync(pendingPath(tmpDir), 'utf-8')).toBe('');
  });
});

// ── feedback ───────────────────────────────────────────────────────────────────

describe('intelligence.feedback', () => {
  it('does not throw for success=true', () => {
    const intl = loadIntl();
    expect(() => intl.feedback(true)).not.toThrow();
  });

  it('does not throw for success=false', () => {
    const intl = loadIntl();
    expect(() => intl.feedback(false)).not.toThrow();
  });

  it('appends a valid JSON line to intelligence-outcomes.jsonl', () => {
    fs.mkdirSync(dataDir(tmpDir), { recursive: true });
    const intl = loadIntl();
    intl.feedback(true);
    const outPath = path.join(dataDir(tmpDir), 'intelligence-outcomes.jsonl');
    expect(fs.existsSync(outPath)).toBe(true);
    const line = JSON.parse(fs.readFileSync(outPath, 'utf-8').trim());
    expect(line.success).toBe(true);
    expect(typeof line.ts).toBe('number');
  });
});

// ── stats ──────────────────────────────────────────────────────────────────────

describe('intelligence.stats', () => {
  it('does not throw with json=false', () => {
    const intl = loadIntl();
    intl.init();
    expect(() => intl.stats(false)).not.toThrow();
  });

  it('does not throw with json=true', () => {
    const intl = loadIntl();
    intl.init();
    expect(() => intl.stats(true)).not.toThrow();
  });
});
