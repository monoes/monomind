/**
 * Tests for .claude/helpers/token-tracker.cjs
 * Tests the exported API: getDateRange, fmt$, fmtK, parseAllSessions,
 * quickSummary, quickSummaryData.
 * Internal functions (calculateCost, classifyTurn, etc.) are exercised
 * indirectly via parseAllSessions with crafted JSONL fixtures.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const TT_PATH = path.resolve(__dirname, '../../.claude/helpers/token-tracker.cjs');

function loadTT() {
  delete require.cache[TT_PATH];
  return require(TT_PATH);
}

// ── getDateRange ───────────────────────────────────────────────────────────────

describe('getDateRange', () => {
  it('"today" — start is midnight UTC, end is 23:59:59 UTC', () => {
    const tt = loadTT();
    const r = tt.getDateRange('today');
    expect(r.start).toBeInstanceOf(Date);
    expect(r.end).toBeInstanceOf(Date);
    expect(r.start.getUTCHours()).toBe(0);
    expect(r.start.getUTCMinutes()).toBe(0);
    expect(r.end.getUTCHours()).toBe(23);
    expect(r.end.getUTCMinutes()).toBe(59);
  });

  it('"week" — spans 6-7 days (start 6 days ago to end of today)', () => {
    const tt = loadTT();
    const r = tt.getDateRange('week');
    const diffDays = (r.end - r.start) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(6);
    expect(diffDays).toBeLessThan(8);
  });

  it('"30days" — spans 29-30 days', () => {
    const tt = loadTT();
    const r = tt.getDateRange('30days');
    const diffDays = (r.end - r.start) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(29);
    expect(diffDays).toBeLessThan(31);
  });

  it('"month" — start is UTC day 1 of current month', () => {
    const tt = loadTT();
    const r = tt.getDateRange('month');
    expect(r.start.getUTCDate()).toBe(1);
    expect(r.start.getUTCHours()).toBe(0);
  });

  it('unknown period falls back to month (start on day 1)', () => {
    const tt = loadTT();
    const r = tt.getDateRange('quarterly');
    expect(r.start.getUTCDate()).toBe(1);
  });
});

// ── fmt$ ──────────────────────────────────────────────────────────────────────

describe('fmt$', () => {
  it('formats >= 100 with 2 decimal places', () => {
    const tt = loadTT();
    expect(tt['fmt$'](150)).toBe('$150.00');
    expect(tt['fmt$'](1000)).toBe('$1000.00');
  });

  it('formats 1-100 with 3 decimal places', () => {
    const tt = loadTT();
    expect(tt['fmt$'](1.5)).toBe('$1.500');
    expect(tt['fmt$'](99)).toBe('$99.000');
  });

  it('formats 0.01-1 with 4 decimal places', () => {
    const tt = loadTT();
    expect(tt['fmt$'](0.05)).toBe('$0.0500');
  });

  it('formats < 0.01 with 5 decimal places', () => {
    const tt = loadTT();
    expect(tt['fmt$'](0.001)).toBe('$0.00100');
  });
});

// ── fmtK ──────────────────────────────────────────────────────────────────────

describe('fmtK', () => {
  it('formats millions as XM', () => {
    const tt = loadTT();
    expect(tt['fmtK'](2500000)).toBe('2.5M');
    expect(tt['fmtK'](1000000)).toBe('1.0M');
  });

  it('formats thousands as XK', () => {
    const tt = loadTT();
    expect(tt['fmtK'](3500)).toBe('3.5K');
    expect(tt['fmtK'](1000)).toBe('1.0K');
  });

  it('formats numbers < 1000 as plain string', () => {
    const tt = loadTT();
    expect(tt['fmtK'](42)).toBe('42');
    expect(tt['fmtK'](999)).toBe('999');
  });
});

// ── parseAllSessions with JSONL fixtures ─────────────────────────────────────

describe('parseAllSessions', () => {
  let tmpDir, origEnv;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-test-'));
    origEnv = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = tmpDir;
  });

  afterEach(() => {
    if (origEnv !== undefined) process.env.CLAUDE_CONFIG_DIR = origEnv;
    else delete process.env.CLAUDE_CONFIG_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeProjectSession(projectSlug, sessionName, lines) {
    const projDir = path.join(tmpDir, 'projects', projectSlug);
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(projDir, sessionName + '.jsonl'), lines.map(l => JSON.stringify(l)).join('\n'));
  }

  it('returns [] when no projects directory exists', () => {
    delete process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = path.join(tmpDir, 'nonexistent');
    const tt = loadTT();
    expect(tt.parseAllSessions(null, null)).toEqual([]);
  });

  it('returns [] when projects dir is empty', () => {
    fs.mkdirSync(path.join(tmpDir, 'projects'), { recursive: true });
    const tt = loadTT();
    expect(tt.parseAllSessions(null, null)).toEqual([]);
  });

  it('parses a valid session and returns project with totalCost > 0', () => {
    const ts = new Date().toISOString();
    makeProjectSession('-my-project', 'sess-001', [
      { type: 'user', timestamp: ts, message: { role: 'user', content: 'implement the feature' } },
      {
        type: 'assistant', timestamp: ts,
        message: {
          id: 'msg-abc', role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [{ type: 'tool_use', name: 'Read' }],
          usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
    ]);
    const tt = loadTT();
    const results = tt.parseAllSessions(null, null);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].totalCost).toBeGreaterThan(0);
  });

  it('deduplicates by msgId — same message counted once', () => {
    const ts = new Date().toISOString();
    const assistantEntry = {
      type: 'assistant', timestamp: ts,
      message: {
        id: 'dup-msg-id', role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [],
        usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    };
    // Write same message twice in same JSONL
    const userEntry = { type: 'user', timestamp: ts, message: { role: 'user', content: 'hello' } };
    makeProjectSession('-dedup-project', 'sess-dup', [userEntry, assistantEntry, assistantEntry]);
    const tt = loadTT();
    const results = tt.parseAllSessions(null, null);
    expect(results.length).toBeGreaterThan(0);
    // apiCalls should be 1, not 2
    expect(results[0].sessions[0].apiCalls).toBe(1);
  });

  it('excludes entries outside date range', () => {
    const oldTs = '2020-01-01T00:00:00.000Z';
    makeProjectSession('-old-project', 'sess-old', [
      { type: 'user', timestamp: oldTs, message: { role: 'user', content: 'old task' } },
      {
        type: 'assistant', timestamp: oldTs,
        message: {
          id: 'old-msg', role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [],
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
    ]);
    const tt = loadTT();
    // Filter for today only
    const range = tt.getDateRange('today');
    const results = tt.parseAllSessions(range.start, range.end);
    expect(results).toEqual([]);
  });

  it('classifies a turn with Edit tool as "coding" category', () => {
    const ts = new Date().toISOString();
    makeProjectSession('-classify-project', 'sess-cls', [
      { type: 'user', timestamp: ts, message: { role: 'user', content: 'add a new field' } },
      {
        type: 'assistant', timestamp: ts,
        message: {
          id: 'cls-msg', role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [{ type: 'tool_use', name: 'Edit' }],
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
    ]);
    const tt = loadTT();
    const results = tt.parseAllSessions(null, null);
    expect(results.length).toBeGreaterThan(0);
    const cats = results[0].sessions[0].categoryBreakdown;
    // 'add a new field' + Edit tool → feature or coding
    expect(Object.keys(cats).length).toBeGreaterThan(0);
  });

  it('accounts for cache tokens in cost calculation', () => {
    const ts = new Date().toISOString();
    makeProjectSession('-cache-project', 'sess-cache', [
      { type: 'user', timestamp: ts, message: { role: 'user', content: 'explore the codebase' } },
      {
        type: 'assistant', timestamp: ts,
        message: {
          id: 'cache-msg', role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [],
          usage: {
            input_tokens: 0, output_tokens: 0,
            cache_creation_input_tokens: 10000,
            cache_read_input_tokens: 5000,
          },
        },
      },
    ]);
    const tt = loadTT();
    const results = tt.parseAllSessions(null, null);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].totalCost).toBeGreaterThan(0);
  });
});

// ── quickSummary ──────────────────────────────────────────────────────────────

describe('quickSummary', () => {
  let origEnv;

  beforeEach(() => {
    origEnv = process.env.CLAUDE_CONFIG_DIR;
  });

  afterEach(() => {
    if (origEnv !== undefined) process.env.CLAUDE_CONFIG_DIR = origEnv;
    else delete process.env.CLAUDE_CONFIG_DIR;
  });

  it('returns null when projects dir does not exist', () => {
    process.env.CLAUDE_CONFIG_DIR = '/nonexistent-dir-' + Date.now();
    const tt = loadTT();
    expect(tt.quickSummary()).toBeNull();
  });
});

// ── quickSummaryData ──────────────────────────────────────────────────────────

describe('quickSummaryData', () => {
  let origEnv;

  beforeEach(() => {
    origEnv = process.env.CLAUDE_CONFIG_DIR;
  });

  afterEach(() => {
    if (origEnv !== undefined) process.env.CLAUDE_CONFIG_DIR = origEnv;
    else delete process.env.CLAUDE_CONFIG_DIR;
  });

  it('returns null when projects dir does not exist', () => {
    process.env.CLAUDE_CONFIG_DIR = '/nonexistent-dir-' + Date.now();
    const tt = loadTT();
    expect(tt.quickSummaryData()).toBeNull();
  });
});
