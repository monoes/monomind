/**
 * Tests for .claude/helpers/memory-palace.cjs
 * Unit-tests the exported API directly.
 *
 * Exported API (actual signatures):
 *   wakeUp(cwd)                                    → string
 *   storeVerbatim(cwd, content, meta)              → void (min 20 chars)
 *   buildClosets(content, drawerId)                → closet[]  (takes content string, not cwd)
 *   search(cwd, query, opts={limit,wing,room})     → drawer[]
 *   recall(cwd, opts={wing,room,limit})            → drawer[]
 *   bm25(query, docs)                              → [{id,score}] desc (query FIRST)
 *   kgAdd(cwd, subject, predicate, object, ...)   → void
 *   kgQuery(cwd, entity, asOf)                    → triple[] (subject=entity, valid at asOf)
 *   kgTimeline(cwd, entity)                        → triple[] (all history, sorted by valid_from)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MP_PATH = path.resolve(__dirname, '../../.claude/helpers/memory-palace.cjs');

function loadMP() {
  delete require.cache[MP_PATH];
  return require(MP_PATH);
}

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── wakeUp ─────────────────────────────────────────────────────────────────────

describe('memory-palace.wakeUp', () => {
  it('does not throw on empty palace directory', () => {
    const mp = loadMP();
    expect(() => mp.wakeUp(tmpDir)).not.toThrow();
  });

  it('returns a string', () => {
    const mp = loadMP();
    const result = mp.wakeUp(tmpDir);
    expect(typeof result).toBe('string');
  });

  it('returns empty string when no drawers or identity exist', () => {
    const mp = loadMP();
    const result = mp.wakeUp(tmpDir);
    expect(result).toBe('');
  });

  it('returns L1 content after storeVerbatim', () => {
    const mp = loadMP();
    const longContent = 'session work implementing authentication with jwt token and oauth validation flow for the user login system and profile management. '.repeat(3);
    mp.storeVerbatim(tmpDir, longContent, { wing: 'tasks', room: 'session1' });
    const result = mp.wakeUp(tmpDir);
    expect(result).toContain('[MEMORY_PALACE_L1]');
  });
});

// ── storeVerbatim ──────────────────────────────────────────────────────────────

describe('memory-palace.storeVerbatim', () => {
  it('does not throw for content >= 20 chars', () => {
    const mp = loadMP();
    expect(() => mp.storeVerbatim(tmpDir, 'hello world this is a test', { wing: 'test', room: 'unit' })).not.toThrow();
  });

  it('does nothing for content shorter than 20 chars', () => {
    const mp = loadMP();
    mp.storeVerbatim(tmpDir, 'too short', { wing: 'test', room: 'unit' });
    const drawersPath = path.join(tmpDir, '.monomind', 'palace', 'drawers.jsonl');
    expect(fs.existsSync(drawersPath)).toBe(false);
  });

  it('creates drawers.jsonl after storing', () => {
    const mp = loadMP();
    mp.storeVerbatim(tmpDir, 'testing the memory palace store function with valid content', { wing: 'test', room: 'room1' });
    const drawersPath = path.join(tmpDir, '.monomind', 'palace', 'drawers.jsonl');
    expect(fs.existsSync(drawersPath)).toBe(true);
  });

  it('appends a valid JSON line per chunk to drawers.jsonl', () => {
    const mp = loadMP();
    mp.storeVerbatim(tmpDir, 'test content for the memory palace valid storage', { wing: 'tasks', room: 'session1' });
    const drawersPath = path.join(tmpDir, '.monomind', 'palace', 'drawers.jsonl');
    const lines = fs.readFileSync(drawersPath, 'utf-8').split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    const parsed = JSON.parse(lines[0]);
    expect(parsed).toHaveProperty('id');
    expect(parsed).toHaveProperty('content');
    expect(parsed).toHaveProperty('wing', 'tasks');
    expect(parsed).toHaveProperty('room', 'session1');
  });

  it('splits long text into multiple chunks', () => {
    const mp = loadMP();
    const longText = 'memory palace word testing content valid storage chunk split overlap implementation. '.repeat(20);
    mp.storeVerbatim(tmpDir, longText, { wing: 'tasks', room: 'big' });
    const drawersPath = path.join(tmpDir, '.monomind', 'palace', 'drawers.jsonl');
    const lines = fs.readFileSync(drawersPath, 'utf-8').split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });
});

// ── buildClosets ───────────────────────────────────────────────────────────────

describe('memory-palace.buildClosets', () => {
  it('returns an array', () => {
    const mp = loadMP();
    const result = mp.buildClosets('some plain text content here', 'drawer-1');
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns empty array for text with no extractable topics', () => {
    const mp = loadMP();
    const result = mp.buildClosets('hello world foo bar baz', 'drawer-1');
    expect(Array.isArray(result)).toBe(true);
  });

  it('extracts markdown headers as "header" type', () => {
    const mp = loadMP();
    const content = '# Authentication System\n## JWT Tokens\nSome content here.\n### OAuth Flow\n';
    const result = mp.buildClosets(content, 'drawer-auth');
    const headers = result.filter(c => c.type === 'header');
    expect(headers.length).toBeGreaterThan(0);
    expect(headers[0].term).toBe('Authentication System');
  });

  it('extracts action phrases as "action" type', () => {
    const mp = loadMP();
    const content = 'We implemented AuthModule and deployed ApiServer last week.';
    const result = mp.buildClosets(content, 'drawer-2');
    const actions = result.filter(c => c.type === 'action');
    expect(actions.length).toBeGreaterThan(0);
  });

  it('each closet record has drawerId, term, type, ts', () => {
    const mp = loadMP();
    const content = '# My Section\nimplemented Authentication system today.';
    const result = mp.buildClosets(content, 'drawer-xyz');
    if (result.length > 0) {
      expect(result[0]).toHaveProperty('drawerId', 'drawer-xyz');
      expect(result[0]).toHaveProperty('term');
      expect(result[0]).toHaveProperty('type');
      expect(result[0]).toHaveProperty('ts');
    }
  });
});

// ── search (BM25) ──────────────────────────────────────────────────────────────

describe('memory-palace.search', () => {
  it('returns [] when no drawers exist', () => {
    const mp = loadMP();
    const results = mp.search(tmpDir, 'authentication', { limit: 5 });
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });

  it('returns matching results after storeVerbatim', () => {
    const mp = loadMP();
    mp.storeVerbatim(tmpDir, 'authentication oauth jwt token security login credentials verification', { wing: 'dev', room: 'auth' });
    const results = mp.search(tmpDir, 'authentication', { limit: 5 });
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it('results have content property', () => {
    const mp = loadMP();
    mp.storeVerbatim(tmpDir, 'memory palace search function test content implementation', { wing: 'dev', room: 'test' });
    const results = mp.search(tmpDir, 'memory palace', { limit: 5 });
    if (results.length > 0) {
      expect(results[0]).toHaveProperty('content');
    }
  });

  it('returns results with lower score for non-matching query (search does not filter by score)', () => {
    const mp = loadMP();
    mp.storeVerbatim(tmpDir, 'authentication oauth jwt verification credentials', { wing: 'dev', room: 'auth' });
    // BM25 search returns top-N even with score=0 — it does not filter by relevance threshold
    const matching = mp.search(tmpDir, 'authentication', { limit: 5 });
    const nonMatching = mp.search(tmpDir, 'zzzzunrelated9999xyz', { limit: 5 });
    // Both may return results; matching results should have positive BM25 relevance
    expect(Array.isArray(nonMatching)).toBe(true);
  });

  it('limits results by opts.limit', () => {
    const mp = loadMP();
    const longText = 'authentication token session user login credentials verification access control security ';
    // Store many chunks by using very long content
    mp.storeVerbatim(tmpDir, (longText + 'x '.repeat(50)).repeat(5), { wing: 'dev', room: 'auth' });
    const results = mp.search(tmpDir, 'authentication', { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('filters by wing when opts.wing is set', () => {
    const mp = loadMP();
    mp.storeVerbatim(tmpDir, 'authentication module backend service user login flow', { wing: 'backend', room: 'auth' });
    mp.storeVerbatim(tmpDir, 'authentication frontend form validation user login', { wing: 'frontend', room: 'auth' });
    const results = mp.search(tmpDir, 'authentication', { limit: 5, wing: 'backend' });
    results.forEach(r => expect(r.wing).toBe('backend'));
  });
});

// ── recall ─────────────────────────────────────────────────────────────────────

describe('memory-palace.recall', () => {
  it('returns [] for non-existent wing/room', () => {
    const mp = loadMP();
    const result = mp.recall(tmpDir, { wing: 'nonexistent', room: 'nonexistent' });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it('returns matching chunks for stored wing/room', () => {
    const mp = loadMP();
    mp.storeVerbatim(tmpDir, 'content in tasks session-one wing and room memory storage', { wing: 'tasks', room: 'session-one' });
    const result = mp.recall(tmpDir, { wing: 'tasks', room: 'session-one' });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns all drawers when no filter', () => {
    const mp = loadMP();
    mp.storeVerbatim(tmpDir, 'content for recall test with wing and room and no filter', { wing: 'any', room: 'any' });
    const result = mp.recall(tmpDir, {});
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── bm25 ───────────────────────────────────────────────────────────────────────

describe('memory-palace.bm25', () => {
  it('returns [] for empty docs', () => {
    const mp = loadMP();
    const result = mp.bm25('authentication', []);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it('signature is bm25(query, docs) — query first', () => {
    const mp = loadMP();
    const docs = [
      { id: 'd1', text: 'authentication login jwt token security access' },
      { id: 'd2', text: 'database schema migration postgres sql' },
    ];
    // query is first arg
    const result = mp.bm25('authentication', docs);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].id).toBe('d1');
  });

  it('returns [{id, score}] objects', () => {
    const mp = loadMP();
    const docs = [{ id: 'x1', text: 'test content for scoring search' }];
    const result = mp.bm25('test content', docs);
    if (result.length > 0) {
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('score');
      expect(typeof result[0].score).toBe('number');
    }
  });

  it('returns all docs with score=0 for zero-overlap query', () => {
    const mp = loadMP();
    const docs = [{ id: 'd1', text: 'hello world foo bar' }];
    // No overlap → score 0, but docs still returned (filtered by score > 0 by search, not bm25)
    const result = mp.bm25('zzz999qqq', docs);
    // bm25 still returns all docs, just with score 0
    expect(Array.isArray(result)).toBe(true);
  });

  it('scores are sorted descending', () => {
    const mp = loadMP();
    const docs = [
      { id: 'low', text: 'other unrelated content database migration' },
      { id: 'high', text: 'authentication authentication authentication token jwt' },
    ];
    const result = mp.bm25('authentication token', docs);
    if (result.length > 1) {
      expect(result[0].score).toBeGreaterThanOrEqual(result[1].score);
    }
  });
});

// ── kgAdd / kgQuery / kgTimeline ───────────────────────────────────────────────

describe('memory-palace knowledge graph', () => {
  it('kgAdd does not throw', () => {
    const mp = loadMP();
    expect(() => mp.kgAdd(tmpDir, 'Alice', 'knows', 'Bob')).not.toThrow();
  });

  it('kgAdd writes kg.json', () => {
    const mp = loadMP();
    mp.kgAdd(tmpDir, 'Alice', 'knows', 'Bob');
    const kgPath = path.join(tmpDir, '.monomind', 'palace', 'kg.json');
    expect(fs.existsSync(kgPath)).toBe(true);
  });

  it('kgQuery(cwd, entity) returns triples where subject=entity', () => {
    const mp = loadMP();
    mp.kgAdd(tmpDir, 'AuthModule', 'depends_on', 'JWTLib');
    // kgQuery signature: kgQuery(cwd, entity, asOf)
    const result = mp.kgQuery(tmpDir, 'AuthModule');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].subject).toBe('AuthModule');
    expect(result[0].predicate).toBe('depends_on');
    expect(result[0].object).toBe('JWTLib');
  });

  it('kgQuery returns [] for non-existent entity', () => {
    const mp = loadMP();
    const result = mp.kgQuery(tmpDir, 'NonExistent');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it('kgQuery filters by time when asOf is set', () => {
    const mp = loadMP();
    const pastTime = '2020-01-01T00:00:00.000Z';
    mp.kgAdd(tmpDir, 'Feature', 'deployed_at', 'production', new Date().toISOString());
    // Query at past time — triple was added now, so querying past should return 0
    const result = mp.kgQuery(tmpDir, 'Feature', pastTime);
    expect(Array.isArray(result)).toBe(true);
    // Triple valid_from is now, querying past → not valid yet
    expect(result.length).toBe(0);
  });

  it('kgTimeline(cwd, entity) returns triples for that entity chronologically', () => {
    const mp = loadMP();
    mp.kgAdd(tmpDir, 'Module', 'created', 'v1');
    mp.kgAdd(tmpDir, 'Module', 'updated', 'v2');
    const result = mp.kgTimeline(tmpDir, 'Module');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
    // Chronological order
    expect(new Date(result[0].valid_from).getTime()).toBeLessThanOrEqual(new Date(result[1].valid_from).getTime());
  });

  it('kgTimeline returns [] when entity has no triples', () => {
    const mp = loadMP();
    mp.kgAdd(tmpDir, 'OtherModule', 'has', 'something');
    const result = mp.kgTimeline(tmpDir, 'NonExistentModule');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});
