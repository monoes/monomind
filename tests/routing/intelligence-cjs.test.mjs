/**
 * Tests for .claude/helpers/intelligence.cjs
 * Covers: getContext(), feedback(), consolidate(), recordEdit()
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Paths used by intelligence.cjs — relative to process.cwd() at module load time
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const OUTCOMES_PATH = path.join(PROJECT_ROOT, '.monomind', 'data', 'intelligence-outcomes.jsonl');
const RANKED_PATH = path.join(PROJECT_ROOT, '.monomind', 'data', 'ranked-context.json');
const PENDING_PATH = path.join(PROJECT_ROOT, '.monomind', 'data', 'pending-insights.jsonl');

// intelligence.cjs is required fresh each time but shares module-level state.
// We import it once — module-level state (_lastContext, _recentEdits) persists
// within the test run, which is acceptable for this test suite.
const intelligence = require('../../.claude/helpers/intelligence.cjs');

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
    // First initialize so ranked-context.json has entries (if any)
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
  let outcomesExistedBefore;
  let outcomesContentBefore;

  beforeEach(() => {
    outcomesExistedBefore = fs.existsSync(OUTCOMES_PATH);
    outcomesContentBefore = outcomesExistedBefore ? fs.readFileSync(OUTCOMES_PATH, 'utf8') : null;
  });

  afterEach(() => {
    // Restore outcomes file to its pre-test state
    if (outcomesExistedBefore) {
      fs.writeFileSync(OUTCOMES_PATH, outcomesContentBefore, 'utf8');
    } else if (fs.existsSync(OUTCOMES_PATH)) {
      fs.unlinkSync(OUTCOMES_PATH);
    }
  });

  it('feedback(true) does not throw', () => {
    expect(() => intelligence.feedback(true)).not.toThrow();
  });

  it('feedback(false) does not throw', () => {
    expect(() => intelligence.feedback(false)).not.toThrow();
  });

  it('feedback(true) appends a line to intelligence-outcomes.jsonl', () => {
    const linesBefore = outcomesExistedBefore
      ? outcomesContentBefore.trim().split('\n').filter(Boolean).length
      : 0;

    intelligence.feedback(true);

    expect(fs.existsSync(OUTCOMES_PATH)).toBe(true);
    const content = fs.readFileSync(OUTCOMES_PATH, 'utf8');
    const linesAfter = content.trim().split('\n').filter(Boolean).length;
    expect(linesAfter).toBeGreaterThan(linesBefore);
  });

  it('feedback(false) appends a line with success: false', () => {
    intelligence.feedback(false);

    expect(fs.existsSync(OUTCOMES_PATH)).toBe(true);
    const lines = fs.readFileSync(OUTCOMES_PATH, 'utf8').trim().split('\n').filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last).toHaveProperty('success', false);
  });

  it('feedback(true) appends a line with success: true', () => {
    intelligence.feedback(true);

    const lines = fs.readFileSync(OUTCOMES_PATH, 'utf8').trim().split('\n').filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last).toHaveProperty('success', true);
  });

  it('feedback entry has required fields: ts, success, context, recentEdits', () => {
    intelligence.feedback(true);

    const lines = fs.readFileSync(OUTCOMES_PATH, 'utf8').trim().split('\n').filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last).toHaveProperty('ts');
    expect(last).toHaveProperty('success');
    expect(last).toHaveProperty('context');
    expect(last).toHaveProperty('recentEdits');
    expect(Array.isArray(last.recentEdits)).toBe(true);
  });

  it('feedback entry ts is a valid timestamp', () => {
    const before = Date.now();
    intelligence.feedback(true);
    const after = Date.now();

    const lines = fs.readFileSync(OUTCOMES_PATH, 'utf8').trim().split('\n').filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.ts).toBeGreaterThanOrEqual(before);
    expect(last.ts).toBeLessThanOrEqual(after);
  });
});

describe('intelligence.cjs — consolidate', () => {
  let pendingExistedBefore;
  let pendingContentBefore;

  beforeEach(() => {
    pendingExistedBefore = fs.existsSync(PENDING_PATH);
    pendingContentBefore = pendingExistedBefore ? fs.readFileSync(PENDING_PATH, 'utf8') : null;
  });

  afterEach(() => {
    // Restore pending-insights.jsonl to its pre-test state
    if (pendingExistedBefore) {
      fs.writeFileSync(PENDING_PATH, pendingContentBefore, 'utf8');
    } else if (fs.existsSync(PENDING_PATH)) {
      fs.unlinkSync(PENDING_PATH);
    }
  });

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
    // Remove the file if it exists for this test
    if (fs.existsSync(PENDING_PATH)) {
      fs.unlinkSync(PENDING_PATH);
    }
    const result = intelligence.consolidate();
    expect(result.entries).toBe(0);
  });

  it('returns entries count matching lines in pending-insights.jsonl', () => {
    // Write 3 fake insight lines
    const dataDir = path.dirname(PENDING_PATH);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(PENDING_PATH, '{"insight":1}\n{"insight":2}\n{"insight":3}\n', 'utf8');

    const result = intelligence.consolidate();
    expect(result.entries).toBe(3);

    // consolidate() clears the file after processing
    const remaining = fs.existsSync(PENDING_PATH) ? fs.readFileSync(PENDING_PATH, 'utf8') : '';
    expect(remaining.trim()).toBe('');
  });

  it('has edges and newEntries fields', () => {
    const result = intelligence.consolidate();
    expect(result).toHaveProperty('edges');
    expect(result).toHaveProperty('newEntries');
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
    intelligence.init();
    expect(fs.existsSync(RANKED_PATH)).toBe(true);
    const content = JSON.parse(fs.readFileSync(RANKED_PATH, 'utf8'));
    expect(content).toHaveProperty('version', 1);
    expect(content).toHaveProperty('entries');
    expect(Array.isArray(content.entries)).toBe(true);
  });
});
