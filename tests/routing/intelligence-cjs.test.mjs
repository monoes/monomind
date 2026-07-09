/**
 * Tests for .claude/helpers/intelligence.cjs
 * Covers: getContext(), feedback(), consolidate(), recordEdit()
 *
 * Uses CLAUDE_PROJECT_DIR injection to isolate from production data.
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
let intelligence;

function loadIntl() {
  process.env.CLAUDE_PROJECT_DIR = tmpDir;
  delete require.cache[INTL_PATH];
  return require(INTL_PATH);
}

function getDataDir() { return path.join(tmpDir, '.monomind', 'data'); }

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intl-routing-test-'));
  intelligence = loadIntl();
});

afterEach(() => {
  if (ORIG_ENV !== undefined) process.env.CLAUDE_PROJECT_DIR = ORIG_ENV;
  else delete process.env.CLAUDE_PROJECT_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('intelligence.cjs — getContext', () => {
  it('returns null for empty prompt', () => {
    const result = intelligence.getContext('');
    expect(result).toBeNull();
  });

  it('returns null for null prompt', () => {
    const result = intelligence.getContext(null);
    expect(result).toBeNull();
  });

  it('returns string or null for a valid prompt (cold start allowed)', () => {
    const result = intelligence.getContext('fix authentication bug');
    // When no entries are loaded, returns null. With entries, returns a string.
    expect(result === null || typeof result === 'string').toBe(true);
  });

  it('when result is a string, it contains the expected header line', () => {
    intelligence.init();
    const result = intelligence.getContext('authentication security login');
    if (result !== null) {
      expect(typeof result).toBe('string');
      expect(result).toContain('[INTELLIGENCE]');
    }
  });
});

describe('intelligence.cjs — recordEdit', () => {
  it('does not throw when called with a valid file path', () => {
    expect(() => intelligence.recordEdit('/some/file.ts')).not.toThrow();
  });

  it('does not throw when called with an empty string', () => {
    expect(() => intelligence.recordEdit('')).not.toThrow();
  });

  it('does not throw when called with null', () => {
    expect(() => intelligence.recordEdit(null)).not.toThrow();
  });

  it('can be called multiple times without error', () => {
    const files = ['/src/auth.ts', '/src/router.ts', '/tests/auth.test.ts'];
    for (const f of files) {
      expect(() => intelligence.recordEdit(f)).not.toThrow();
    }
  });
});

describe('intelligence.cjs — feedback', () => {
  it('feedback(true) does not throw', () => {
    expect(() => intelligence.feedback(true)).not.toThrow();
  });

  it('feedback(false) does not throw', () => {
    expect(() => intelligence.feedback(false)).not.toThrow();
  });

  it('feedback(true) appends a line to intelligence-outcomes.jsonl', () => {
    const OUTCOMES = path.join(getDataDir(), 'intelligence-outcomes.jsonl');

    intelligence.feedback(true);

    expect(fs.existsSync(OUTCOMES)).toBe(true);
    const content = fs.readFileSync(OUTCOMES, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('feedback(false) appends a line with success: false', () => {
    const OUTCOMES = path.join(getDataDir(), 'intelligence-outcomes.jsonl');

    intelligence.feedback(false);

    expect(fs.existsSync(OUTCOMES)).toBe(true);
    const lines = fs.readFileSync(OUTCOMES, 'utf8').trim().split('\n').filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last).toHaveProperty('success', false);
  });

  it('feedback(true) appends a line with success: true', () => {
    const OUTCOMES = path.join(getDataDir(), 'intelligence-outcomes.jsonl');

    intelligence.feedback(true);

    const lines = fs.readFileSync(OUTCOMES, 'utf8').trim().split('\n').filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last).toHaveProperty('success', true);
  });

  it('feedback entry has required fields: ts, success, context, recentEdits', () => {
    const OUTCOMES = path.join(getDataDir(), 'intelligence-outcomes.jsonl');

    intelligence.feedback(true);

    const lines = fs.readFileSync(OUTCOMES, 'utf8').trim().split('\n').filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last).toHaveProperty('ts');
    expect(last).toHaveProperty('success');
    expect(last).toHaveProperty('context');
    expect(last).toHaveProperty('recentEdits');
    expect(Array.isArray(last.recentEdits)).toBe(true);
  });

  it('feedback entry ts is a valid timestamp', () => {
    const OUTCOMES = path.join(getDataDir(), 'intelligence-outcomes.jsonl');

    const before = Date.now();
    intelligence.feedback(true);
    const after = Date.now();

    const lines = fs.readFileSync(OUTCOMES, 'utf8').trim().split('\n').filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.ts).toBeGreaterThanOrEqual(before);
    expect(last.ts).toBeLessThanOrEqual(after);
  });

  it('feedback captures recentEdits from disk when edits were recorded', () => {
    // Record some edits first
    intelligence.recordEdit('/src/auth.ts');
    intelligence.recordEdit('/src/router.ts');

    intelligence.feedback(true);

    const OUTCOMES = path.join(getDataDir(), 'intelligence-outcomes.jsonl');
    const lines = fs.readFileSync(OUTCOMES, 'utf8').trim().split('\n').filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.recentEdits.length).toBe(2);
    expect(last.recentEdits[0].path).toBe('/src/auth.ts');
    expect(last.recentEdits[1].path).toBe('/src/router.ts');
  });
});

describe('intelligence.cjs — consolidate', () => {
  it('returns an object with entries field', () => {
    const result = intelligence.consolidate();
    expect(result).toBeTypeOf('object');
    expect(result).toHaveProperty('entries');
  });

  it('entries field is a number', () => {
    const result = intelligence.consolidate();
    expect(typeof result.entries).toBe('number');
  });

  it('returns entries: 0 when no pending-insights.jsonl exists', () => {
    const result = intelligence.consolidate();
    expect(result.entries).toBe(0);
  });

  it('returns entries count matching lines in pending-insights.jsonl', () => {
    const dd = getDataDir();
    fs.mkdirSync(dd, { recursive: true });
    const PENDING = path.join(dd, 'pending-insights.jsonl');
    fs.writeFileSync(PENDING, '{"insight":1}\n{"insight":2}\n{"insight":3}\n', 'utf8');

    const result = intelligence.consolidate();
    expect(result.entries).toBe(3);

    // consolidate() clears the file after processing
    const remaining = fs.existsSync(PENDING) ? fs.readFileSync(PENDING, 'utf8') : '';
    expect(remaining.trim()).toBe('');
  });

  it('has edges and newEntries fields', () => {
    const result = intelligence.consolidate();
    expect(result).toHaveProperty('edges');
    expect(result).toHaveProperty('newEntries');
  });

  it('synthesizes successful outcomes with edits into auto-memory-store', () => {
    const dd = getDataDir();
    fs.mkdirSync(dd, { recursive: true });

    // Record edits and feedback
    intelligence.recordEdit('/src/auth.ts');
    intelligence.recordEdit('/src/router.ts');
    intelligence.feedback(true);

    // Now consolidate
    const result = intelligence.consolidate();
    expect(result.newEntries).toBe(1);

    // Verify the store was written
    const store = JSON.parse(fs.readFileSync(path.join(dd, 'auto-memory-store.json'), 'utf8'));
    expect(store.length).toBe(1);
    expect(store[0].files).toContain('/src/auth.ts');
    expect(store[0].files).toContain('/src/router.ts');
    // No [object Object] pollution
    expect(store[0].content).not.toContain('[object Object]');
  });
});

describe('intelligence.cjs — init', () => {
  it('returns an object with nodes field', () => {
    const result = intelligence.init();
    expect(result).toBeTypeOf('object');
    expect(result).toHaveProperty('nodes');
  });

  it('nodes is a non-negative number', () => {
    const result = intelligence.init();
    expect(typeof result.nodes).toBe('number');
    expect(result.nodes).toBeGreaterThanOrEqual(0);
  });

  it('writes ranked-context.json after init', () => {
    const RANKED = path.join(getDataDir(), 'ranked-context.json');
    intelligence.init();
    expect(fs.existsSync(RANKED)).toBe(true);
    const content = JSON.parse(fs.readFileSync(RANKED, 'utf8'));
    expect(content).toHaveProperty('version', 1);
    expect(content).toHaveProperty('entries');
    expect(Array.isArray(content.entries)).toBe(true);
  });
});
