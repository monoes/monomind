/**
 * Tests for .claude/helpers/utils/telemetry.cjs
 * All functions use module-level CWD. Invalidate require cache before each test
 * and inject CLAUDE_PROJECT_DIR so reads/writes land in tmpDir.
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

function loadTelemetry(cwd) {
  process.env.CLAUDE_PROJECT_DIR = cwd;
  delete require.cache[TELE_PATH];
  return require(TELE_PATH);
}

let tmpDir;
let _origDate;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tele-test-'));
  _origDate = global.Date;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.CLAUDE_PROJECT_DIR;
  global.Date = _origDate;
});

// ── _recordRecentEdit ────────────────────────────────────────────────────────

describe('telemetry._recordRecentEdit', () => {
  it('does nothing when filePath is falsy', () => {
    const t = loadTelemetry(tmpDir);
    expect(() => t._recordRecentEdit(null)).not.toThrow();
    expect(() => t._recordRecentEdit('')).not.toThrow();
  });

  it('creates .monomind/metrics/recent-edits.json', () => {
    const t = loadTelemetry(tmpDir);
    t._recordRecentEdit('/src/foo.ts');
    expect(fs.existsSync(path.join(tmpDir, '.monomind', 'metrics', 'recent-edits.json'))).toBe(true);
  });

  it('adds file to edits array', () => {
    const t = loadTelemetry(tmpDir);
    t._recordRecentEdit('/src/bar.ts');
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, '.monomind', 'metrics', 'recent-edits.json'), 'utf-8'));
    expect(data.edits[0].file).toBe('/src/bar.ts');
    expect(data.edits[0].editedAt).toBeDefined();
  });

  it('deduplicates: same file appears only once (moved to front)', () => {
    const t = loadTelemetry(tmpDir);
    t._recordRecentEdit('/src/a.ts');
    t._recordRecentEdit('/src/b.ts');
    t._recordRecentEdit('/src/a.ts'); // re-record a
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, '.monomind', 'metrics', 'recent-edits.json'), 'utf-8'));
    const files = data.edits.map(e => e.file);
    expect(files.filter(f => f === '/src/a.ts').length).toBe(1);
    expect(files[0]).toBe('/src/a.ts'); // most recent at front
  });

  it('caps edits array at 10 entries', () => {
    const t = loadTelemetry(tmpDir);
    for (let i = 0; i < 15; i++) t._recordRecentEdit(`/src/file${i}.ts`);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, '.monomind', 'metrics', 'recent-edits.json'), 'utf-8'));
    expect(data.edits.length).toBeLessThanOrEqual(10);
  });
});

// ── _getRecentEdits ──────────────────────────────────────────────────────────

describe('telemetry._getRecentEdits', () => {
  it('returns [] when no recent-edits.json exists', () => {
    const t = loadTelemetry(tmpDir);
    expect(t._getRecentEdits()).toEqual([]);
  });

  it('returns recently stored edit (within 2 hours)', () => {
    const t = loadTelemetry(tmpDir);
    t._recordRecentEdit('/src/fresh.ts');
    const result = t._getRecentEdits();
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].file).toBe('/src/fresh.ts');
  });

  it('filters out edits older than 2 hours', () => {
    const t = loadTelemetry(tmpDir);
    const metricsDir = path.join(tmpDir, '.monomind', 'metrics');
    fs.mkdirSync(metricsDir, { recursive: true });
    const staleEdit = { file: '/old/file.ts', editedAt: Date.now() - 3 * 60 * 60 * 1000 };
    fs.writeFileSync(path.join(metricsDir, 'recent-edits.json'), JSON.stringify({ edits: [staleEdit] }));
    const result = t._getRecentEdits();
    expect(result.length).toBe(0);
  });
});

// ── _recordToolCall ──────────────────────────────────────────────────────────

describe('telemetry._recordToolCall', () => {
  it('creates .monomind/metrics/tool-calls.json', () => {
    const t = loadTelemetry(tmpDir);
    t._recordToolCall('Read:file');
    expect(fs.existsSync(path.join(tmpDir, '.monomind', 'metrics', 'tool-calls.json'))).toBe(true);
  });

  it('increments call count for a signature', () => {
    const t = loadTelemetry(tmpDir);
    t._recordToolCall('Read:foo');
    t._recordToolCall('Read:foo');
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, '.monomind', 'metrics', 'tool-calls.json'), 'utf-8'));
    expect(data.calls['Read:foo']).toBe(2);
  });

  it('returns exact call count (2 on second call)', () => {
    const t = loadTelemetry(tmpDir);
    t._recordToolCall('Edit:file');
    const count = t._recordToolCall('Edit:file');
    expect(count).toBe(2);
  });

  it('tracks multiple different signatures independently', () => {
    const t = loadTelemetry(tmpDir);
    t._recordToolCall('Read:a');
    t._recordToolCall('Write:b');
    t._recordToolCall('Read:a');
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, '.monomind', 'metrics', 'tool-calls.json'), 'utf-8'));
    expect(data.calls['Read:a']).toBe(2);
    expect(data.calls['Write:b']).toBe(1);
  });

  it('resets count when startedAt is more than 4 hours ago', () => {
    const t = loadTelemetry(tmpDir);
    const metricsDir = path.join(tmpDir, '.monomind', 'metrics');
    fs.mkdirSync(metricsDir, { recursive: true });
    const stale = { startedAt: Date.now() - 5 * 60 * 60 * 1000, calls: { 'Read:x': 10 } };
    fs.writeFileSync(path.join(metricsDir, 'tool-calls.json'), JSON.stringify(stale));
    const count = t._recordToolCall('Read:x');
    expect(count).toBe(1);
    const data = JSON.parse(fs.readFileSync(path.join(metricsDir, 'tool-calls.json'), 'utf-8'));
    expect(data.calls['Read:x']).toBe(1);
  });
});

// ── _getBudgetStatus ─────────────────────────────────────────────────────────

describe('telemetry._getBudgetStatus', () => {
  it('returns null when token-summary.json does not exist', () => {
    const t = loadTelemetry(tmpDir);
    expect(t._getBudgetStatus()).toBeNull();
  });

  it('returns budget object when token-summary.json exists', () => {
    const t = loadTelemetry(tmpDir);
    const metricsDir = path.join(tmpDir, '.monomind', 'metrics');
    fs.mkdirSync(metricsDir, { recursive: true });
    fs.writeFileSync(path.join(metricsDir, 'token-summary.json'), JSON.stringify({ todayCost: 5.0, monthCost: 50.0 }));
    const result = t._getBudgetStatus();
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('todayCost', 5.0);
    expect(result).toHaveProperty('monthCost', 50.0);
    expect(result).toHaveProperty('dailyLimit');
    expect(result).toHaveProperty('monthlyLimit');
    expect(result).toHaveProperty('dailyPct');
    expect(result).toHaveProperty('monthlyPct');
    expect(result).toHaveProperty('alert');
    expect(result).toHaveProperty('breached');
  });

  it('alert=true when dailyPct >= 80', () => {
    const t = loadTelemetry(tmpDir);
    const metricsDir = path.join(tmpDir, '.monomind', 'metrics');
    fs.mkdirSync(metricsDir, { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.monomind'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.monomind', 'budget.json'), JSON.stringify({ dailyLimit: 10, monthlyLimit: 300 }));
    fs.writeFileSync(path.join(metricsDir, 'token-summary.json'), JSON.stringify({ todayCost: 9, monthCost: 30 }));
    const result = t._getBudgetStatus();
    expect(result.alert).toBe(true);
    expect(result.dailyPct).toBeGreaterThanOrEqual(80);
  });

  it('breached=true when cost exceeds limit', () => {
    const t = loadTelemetry(tmpDir);
    const metricsDir = path.join(tmpDir, '.monomind', 'metrics');
    fs.mkdirSync(metricsDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.monomind', 'budget.json'), JSON.stringify({ dailyLimit: 10, monthlyLimit: 300 }));
    fs.writeFileSync(path.join(metricsDir, 'token-summary.json'), JSON.stringify({ todayCost: 11, monthCost: 30 }));
    const result = t._getBudgetStatus();
    expect(result.breached).toBe(true);
  });

  it('auto-tunes dailyLimit when no budget.json and dailyAvg > 5 for >= 7 days', () => {
    const t = loadTelemetry(tmpDir);
    const metricsDir = path.join(tmpDir, '.monomind', 'metrics');
    fs.mkdirSync(metricsDir, { recursive: true });
    // 8 days into month, $80 total → $10/day avg > 5
    fs.writeFileSync(path.join(metricsDir, 'token-summary.json'), JSON.stringify({ todayCost: 12, monthCost: 80 }));
    global.Date = class extends _origDate {
      getUTCDate() { return 8; }
    };
    const result = t._getBudgetStatus();
    expect(result.autoTuned).toBe(true);
    expect(result.dailyLimit).toBeGreaterThan(10);
    expect(fs.existsSync(path.join(tmpDir, '.monomind', 'budget.json'))).toBe(true);
  });

  it('spike=true when todayCost > 2x rolling daily average and > $5', () => {
    const t = loadTelemetry(tmpDir);
    const metricsDir = path.join(tmpDir, '.monomind', 'metrics');
    fs.mkdirSync(metricsDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.monomind', 'budget.json'), JSON.stringify({ dailyLimit: 100, monthlyLimit: 3000 }));
    // rollingDaily = 30/15 = $2/day; todayCost = $7 > 2×2=4 and > $5
    fs.writeFileSync(path.join(metricsDir, 'token-summary.json'), JSON.stringify({ todayCost: 7, monthCost: 30 }));
    global.Date = class extends _origDate {
      getUTCDate() { return 15; }
    };
    const result = t._getBudgetStatus();
    expect(result.spike).toBe(true);
    expect(result.alert).toBe(true);
  });

  it('uses default limits (50/1500) when no budget.json and dailyAvg does not trigger auto-tune', () => {
    const t = loadTelemetry(tmpDir);
    const metricsDir = path.join(tmpDir, '.monomind', 'metrics');
    fs.mkdirSync(metricsDir, { recursive: true });
    // 3 days into month, $6 total → $2/day avg < 5 → no auto-tune
    fs.writeFileSync(path.join(metricsDir, 'token-summary.json'), JSON.stringify({ todayCost: 2, monthCost: 6 }));
    global.Date = class extends _origDate {
      getUTCDate() { return 3; }
    };
    const result = t._getBudgetStatus();
    expect(result.autoTuned).toBe(false);
    expect(result.dailyLimit).toBe(50);
    expect(result.monthlyLimit).toBe(1500);
  });
});

// ── _recordHookLatency ───────────────────────────────────────────────────────

describe('telemetry._recordHookLatency', () => {
  it('creates .monomind/metrics/hook-latency.json', () => {
    const t = loadTelemetry(tmpDir);
    t._recordHookLatency('pre-task', 25);
    expect(fs.existsSync(path.join(tmpDir, '.monomind', 'metrics', 'hook-latency.json'))).toBe(true);
  });

  it('accumulates count, total, max, mean per handler', () => {
    const t = loadTelemetry(tmpDir);
    t._recordHookLatency('post-task', 10);
    t._recordHookLatency('post-task', 30);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, '.monomind', 'metrics', 'hook-latency.json'), 'utf-8'));
    expect(data['post-task'].count).toBe(2);
    expect(data['post-task'].total).toBe(40);
    expect(data['post-task'].max).toBe(30);
    expect(data['post-task'].mean).toBe(20);
  });

  it('max does not decrease when a smaller value is recorded after a larger one', () => {
    const t = loadTelemetry(tmpDir);
    t._recordHookLatency('post-task', 30);
    t._recordHookLatency('post-task', 10);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, '.monomind', 'metrics', 'hook-latency.json'), 'utf-8'));
    expect(data['post-task'].max).toBe(30);
  });

  it('tracks multiple handlers independently', () => {
    const t = loadTelemetry(tmpDir);
    t._recordHookLatency('pre-edit', 5);
    t._recordHookLatency('post-edit', 15);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, '.monomind', 'metrics', 'hook-latency.json'), 'utf-8'));
    expect(data['pre-edit']).toBeDefined();
    expect(data['post-edit']).toBeDefined();
  });
});

// ── _recordDecisionMarkers ───────────────────────────────────────────────────

describe('telemetry._recordDecisionMarkers', () => {
  it('does nothing for falsy or non-string input', () => {
    const t = loadTelemetry(tmpDir);
    t._recordDecisionMarkers(null);
    t._recordDecisionMarkers(42);
    const decisionsFile = path.join(tmpDir, '.monomind', 'decisions.jsonl');
    expect(fs.existsSync(decisionsFile)).toBe(false);
  });

  it('does nothing when prompt has no decision markers', () => {
    const t = loadTelemetry(tmpDir);
    t._recordDecisionMarkers('just a regular message without decisions');
    const decisionsFile = path.join(tmpDir, '.monomind', 'decisions.jsonl');
    expect(fs.existsSync(decisionsFile)).toBe(false);
  });

  it('creates .monomind dir and appends to decisions.jsonl without pre-existing dir', () => {
    const t = loadTelemetry(tmpDir);
    // No manual mkdirSync — the function must create the dir itself
    t._recordDecisionMarkers("Let's go with the functional approach for the component design.");
    const decisionsFile = path.join(tmpDir, '.monomind', 'decisions.jsonl');
    expect(fs.existsSync(decisionsFile)).toBe(true);
    const lines = fs.readFileSync(decisionsFile, 'utf-8').split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    const entry = JSON.parse(lines[0]);
    expect(entry).toHaveProperty('ts');
    expect(entry).toHaveProperty('excerpts');
  });

  it('detects "we decided" as a decision marker', () => {
    const t = loadTelemetry(tmpDir);
    t._recordDecisionMarkers('We decided to use TypeScript for the new module.');
    const decisionsFile = path.join(tmpDir, '.monomind', 'decisions.jsonl');
    expect(fs.existsSync(decisionsFile)).toBe(true);
  });
});
