/**
 * Tests for .claude/helpers/memory-palace.cjs
 * Covers: bm25(), buildClosets(), storeVerbatim(), search(), recall(),
 *         kgAdd(), kgQuery(), kgTimeline(), wakeUp()
 *
 * All functions that touch the filesystem accept a `cwd` parameter, so we
 * use a temp directory for full isolation — no real .monomind/ data is touched.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const require = createRequire(import.meta.url);
const mp = require('../../.claude/helpers/memory-palace.cjs');

// ── shared temp directory per test ───────────────────────────────────────────
let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-palace-test-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── bm25 (pure function — no filesystem) ─────────────────────────────────────
describe('bm25', () => {
  it('returns empty array for empty docs', () => {
    expect(mp.bm25('query', [])).toEqual([]);
  });

  it('returns zero scores for query with no matching tokens', () => {
    const docs = [{ id: 'a', text: 'hello world' }];
    const result = mp.bm25('zzz xyz', docs);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(0);
  });

  it('returns higher score for more relevant doc', () => {
    const docs = [
      { id: 'relevant', text: 'authentication login security token jwt' },
      { id: 'irrelevant', text: 'cooking recipes pasta ingredients' },
    ];
    const result = mp.bm25('authentication security login', docs);
    const relevant = result.find(r => r.id === 'relevant');
    const irrelevant = result.find(r => r.id === 'irrelevant');
    expect(relevant.score).toBeGreaterThan(irrelevant.score);
  });

  it('returns results sorted by descending score', () => {
    const docs = [
      { id: 'low', text: 'foo' },
      { id: 'high', text: 'authentication authentication security authentication' },
      { id: 'mid', text: 'authentication' },
    ];
    const result = mp.bm25('authentication', docs);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].score).toBeGreaterThanOrEqual(result[i + 1].score);
    }
  });

  it('each result has id and score fields', () => {
    const docs = [{ id: 'doc1', text: 'some content here' }];
    const result = mp.bm25('content', docs);
    expect(result[0]).toHaveProperty('id', 'doc1');
    expect(result[0]).toHaveProperty('score');
    expect(typeof result[0].score).toBe('number');
  });

  it('returns zero-score entry for empty query', () => {
    const docs = [{ id: 'doc1', text: 'some content' }];
    const result = mp.bm25('', docs);
    expect(result[0].score).toBe(0);
  });
});

// ── buildClosets (pure function — no filesystem) ──────────────────────────────
describe('buildClosets', () => {
  it('returns an array', () => {
    const result = mp.buildClosets('# Hello World\nSome content here.', 'drawer-1');
    expect(Array.isArray(result)).toBe(true);
  });

  it('extracts markdown section headers', () => {
    const content = '# Authentication Module\n## Security Layer\nDetails here.';
    const result = mp.buildClosets(content, 'd1');
    const headers = result.filter(r => r.type === 'header');
    expect(headers.length).toBeGreaterThan(0);
    const terms = headers.map(h => h.term);
    expect(terms).toContain('Authentication Module');
  });

  it('extracts action phrases', () => {
    const content = 'We implemented AuthService and created UserRepository for the project.';
    const result = mp.buildClosets(content, 'd2');
    const actions = result.filter(r => r.type === 'action');
    expect(actions.length).toBeGreaterThan(0);
  });

  it('each closet has drawerId, term, type, ts fields', () => {
    const result = mp.buildClosets('# Section Header\nSome content here.', 'drawer-99');
    expect(result.length).toBeGreaterThan(0);
    for (const item of result) {
      expect(item).toHaveProperty('drawerId', 'drawer-99');
      expect(item).toHaveProperty('term');
      expect(item).toHaveProperty('type');
      expect(item).toHaveProperty('ts');
    }
  });

  it('returns empty array for empty content', () => {
    const result = mp.buildClosets('', 'drawer-0');
    expect(Array.isArray(result)).toBe(true);
    // No closets from empty content
    expect(result.length).toBe(0);
  });
});

// ── storeVerbatim ─────────────────────────────────────────────────────────────
describe('storeVerbatim', () => {
  it('creates drawers.jsonl in palace dir', () => {
    const content = 'This is a test content for the memory palace storage system. '.repeat(10);
    mp.storeVerbatim(tmpDir, content, { wing: 'test', room: 'room1' });
    const drawersPath = path.join(tmpDir, '.monomind', 'palace', 'drawers.jsonl');
    expect(fs.existsSync(drawersPath)).toBe(true);
  });

  it('stores drawer with correct wing and room metadata', () => {
    const content = 'Authentication system implementation with JWT tokens and session management. '.repeat(5);
    mp.storeVerbatim(tmpDir, content, { wing: 'auth', room: 'jwt' });
    const drawersPath = path.join(tmpDir, '.monomind', 'palace', 'drawers.jsonl');
    const lines = fs.readFileSync(drawersPath, 'utf8').trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    const first = JSON.parse(lines[0]);
    expect(first.wing).toBe('auth');
    expect(first.room).toBe('jwt');
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('content');
    expect(first).toHaveProperty('score', 1.0);
  });

  it('also creates closets.jsonl', () => {
    const content = '# Auth Module\nWe implemented UserService and created AuthController for login.';
    mp.storeVerbatim(tmpDir, content, { wing: 'test', room: 'closets' });
    const closetsPath = path.join(tmpDir, '.monomind', 'palace', 'closets.jsonl');
    expect(fs.existsSync(closetsPath)).toBe(true);
  });

  it('does not store content shorter than 20 chars', () => {
    mp.storeVerbatim(tmpDir, 'short', { wing: 'test', room: 'r1' });
    const drawersPath = path.join(tmpDir, '.monomind', 'palace', 'drawers.jsonl');
    expect(fs.existsSync(drawersPath)).toBe(false);
  });

  it('does not throw for null or undefined content', () => {
    expect(() => mp.storeVerbatim(tmpDir, null, {})).not.toThrow();
    expect(() => mp.storeVerbatim(tmpDir, undefined, {})).not.toThrow();
  });
});

// ── search ────────────────────────────────────────────────────────────────────
describe('search', () => {
  beforeEach(() => {
    // Pre-populate palace with some content
    const authContent = 'Authentication system with JWT tokens and session management for secure login. '.repeat(5);
    const dbContent = 'Database connection pooling and query optimization for PostgreSQL performance. '.repeat(5);
    mp.storeVerbatim(tmpDir, authContent, { wing: 'backend', room: 'auth' });
    mp.storeVerbatim(tmpDir, dbContent, { wing: 'backend', room: 'db' });
  });

  it('returns an array', () => {
    const results = mp.search(tmpDir, 'authentication login');
    expect(Array.isArray(results)).toBe(true);
  });

  it('returns empty array when palace directory is empty', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-palace-'));
    try {
      const results = mp.search(emptyDir, 'query');
      expect(results).toEqual([]);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('returns relevant drawers for a known query', () => {
    const results = mp.search(tmpDir, 'authentication jwt session');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('content');
    expect(results[0]).toHaveProperty('wing');
  });

  it('respects limit option', () => {
    const results = mp.search(tmpDir, 'authentication', { limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('filters by wing when wing option is provided', () => {
    // Store content in a different wing
    const uiContent = 'React component rendering and CSS styling for the user interface. '.repeat(5);
    mp.storeVerbatim(tmpDir, uiContent, { wing: 'frontend', room: 'ui' });

    const results = mp.search(tmpDir, 'component ui', { wing: 'frontend' });
    for (const r of results) {
      expect(r.wing).toBe('frontend');
    }
  });

  it('creates score-diffs sidecar file on search hit', () => {
    mp.search(tmpDir, 'authentication jwt');
    const diffPath = path.join(tmpDir, '.monomind', 'palace', 'drawers-score-diffs.jsonl');
    expect(fs.existsSync(diffPath)).toBe(true);
  });
});

// ── recall ────────────────────────────────────────────────────────────────────
describe('recall', () => {
  beforeEach(() => {
    const content = 'Recall test content for the authentication and session management system. '.repeat(5);
    mp.storeVerbatim(tmpDir, content, { wing: 'recall-wing', room: 'room-a' });
  });

  it('returns an array', () => {
    const results = mp.recall(tmpDir, {});
    expect(Array.isArray(results)).toBe(true);
  });

  it('returns drawers from the specified wing', () => {
    const results = mp.recall(tmpDir, { wing: 'recall-wing' });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.wing).toBe('recall-wing');
    }
  });

  it('returns empty array for non-existent wing', () => {
    const results = mp.recall(tmpDir, { wing: 'nonexistent-wing' });
    expect(results).toEqual([]);
  });

  it('respects limit option', () => {
    // Store multiple chunks to have more drawers
    for (let i = 0; i < 3; i++) {
      const content = `Content chunk ${i} for recall limit testing in the memory system. `.repeat(8);
      mp.storeVerbatim(tmpDir, content, { wing: 'recall-wing', room: `room-${i}` });
    }
    const results = mp.recall(tmpDir, { wing: 'recall-wing', limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

// ── knowledge graph ───────────────────────────────────────────────────────────
describe('kgAdd + kgQuery + kgTimeline', () => {
  it('kgAdd does not throw', () => {
    expect(() => mp.kgAdd(tmpDir, 'AuthService', 'DEPENDS_ON', 'UserRepository')).not.toThrow();
  });

  it('kgQuery returns triples for the subject', () => {
    mp.kgAdd(tmpDir, 'AuthService', 'DEPENDS_ON', 'UserRepository');
    mp.kgAdd(tmpDir, 'AuthService', 'IMPLEMENTS', 'IAuthService');
    const results = mp.kgQuery(tmpDir, 'AuthService');
    expect(results.length).toBe(2);
    expect(results[0]).toHaveProperty('subject', 'AuthService');
    expect(results[0]).toHaveProperty('predicate');
    expect(results[0]).toHaveProperty('object');
  });

  it('kgQuery returns empty array for unknown entity', () => {
    const results = mp.kgQuery(tmpDir, 'NonExistentService');
    expect(results).toEqual([]);
  });

  it('kgTimeline returns triples sorted by valid_from', () => {
    const t1 = new Date(Date.now() - 10000).toISOString();
    const t2 = new Date().toISOString();
    mp.kgAdd(tmpDir, 'UserService', 'CREATED_AT', 'v1', t1);
    mp.kgAdd(tmpDir, 'UserService', 'UPDATED_AT', 'v2', t2);

    const timeline = mp.kgTimeline(tmpDir, 'UserService');
    expect(timeline.length).toBe(2);
    // Earlier timestamp should come first
    const time0 = new Date(timeline[0].valid_from).getTime();
    const time1 = new Date(timeline[1].valid_from).getTime();
    expect(time0).toBeLessThanOrEqual(time1);
  });

  it('kgAdd stores triple with required fields', () => {
    mp.kgAdd(tmpDir, 'OrderService', 'CALLS', 'PaymentGateway', null, 0.9, 'src-001');
    const results = mp.kgQuery(tmpDir, 'OrderService');
    expect(results.length).toBe(1);
    const triple = results[0];
    expect(triple).toHaveProperty('id');
    expect(triple).toHaveProperty('subject', 'OrderService');
    expect(triple).toHaveProperty('predicate', 'CALLS');
    expect(triple).toHaveProperty('object', 'PaymentGateway');
    expect(triple).toHaveProperty('confidence', 0.9);
    expect(triple).toHaveProperty('source_id', 'src-001');
  });
});

// ── wakeUp ────────────────────────────────────────────────────────────────────
describe('wakeUp', () => {
  it('returns a string', () => {
    const result = mp.wakeUp(tmpDir);
    expect(typeof result).toBe('string');
  });

  it('returns empty string when palace dir is empty', () => {
    const result = mp.wakeUp(tmpDir);
    expect(result).toBe('');
  });

  it('includes L0 identity content when identity.md exists', () => {
    const palaceDir = path.join(tmpDir, '.monomind', 'palace');
    fs.mkdirSync(palaceDir, { recursive: true });
    fs.writeFileSync(path.join(palaceDir, 'identity.md'), 'I am a test agent.', 'utf8');

    const result = mp.wakeUp(tmpDir);
    expect(result).toContain('[MEMORY_PALACE_L0]');
    expect(result).toContain('I am a test agent.');
  });

  it('includes L1 essential story content from stored drawers', () => {
    const content = 'Authentication and session management implementation with JWT tokens. '.repeat(8);
    mp.storeVerbatim(tmpDir, content, { wing: 'backend', room: 'auth' });

    const result = mp.wakeUp(tmpDir);
    expect(result).toContain('[MEMORY_PALACE_L1]');
  });
});
