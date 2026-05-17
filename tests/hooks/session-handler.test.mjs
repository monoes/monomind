/**
 * Tests for .claude/helpers/handlers/session-handler.cjs
 * Builds a minimal mock hCtx and calls handler.handleEnd(hCtx) directly.
 * Verifies: consolidation lock, routing-feedback.jsonl, session.end(), worker cleanup.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SH_PATH = path.resolve(__dirname, '../../.claude/helpers/handlers/session-handler.cjs');

function loadSH() {
  delete require.cache[SH_PATH];
  return require(SH_PATH);
}

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-test-'));
  fs.mkdirSync(path.join(tmpDir, '.monomind'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function makeHCtx(overrides = {}) {
  return {
    hookInput: {},
    CWD: tmpDir,
    session: null,
    intelligence: null,
    getLearningService: async () => null,
    runWithTimeout: async (fn) => fn(),
    _hooksModule: null,
    ...overrides,
  };
}

// ── consolidation lock ─────────────────────────────────────────────────────────

describe('session-handler consolidation lock', () => {
  it('skips consolidation when lock file exists', async () => {
    const sh = loadSH();
    const lockPath = path.join(tmpDir, '.monomind', 'consolidation.lock');
    fs.writeFileSync(lockPath, '1', 'utf-8');
    const mockConsolidate = vi.fn();
    const hCtx = makeHCtx({
      intelligence: { consolidate: mockConsolidate },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sh.handleEnd(hCtx);
    expect(mockConsolidate).not.toHaveBeenCalled();
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('daemon holds lock');
  });

  it('calls consolidation when no lock file', async () => {
    const sh = loadSH();
    const mockConsolidate = vi.fn().mockResolvedValue({ entries: 0, edges: 0, newEntries: 0 });
    const hCtx = makeHCtx({
      intelligence: { consolidate: mockConsolidate },
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await sh.handleEnd(hCtx);
    expect(mockConsolidate).toHaveBeenCalled();
  });

  it('logs consolidated count when entries > 0', async () => {
    const sh = loadSH();
    const hCtx = makeHCtx({
      intelligence: {
        consolidate: vi.fn().mockResolvedValue({ entries: 5, edges: 3, newEntries: 2 }),
        feedback: vi.fn(),
      },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sh.handleEnd(hCtx);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Consolidated: 5 entries');
  });
});

// ── session.end() ──────────────────────────────────────────────────────────────

describe('session-handler session end', () => {
  it('calls session.end() when session is provided', async () => {
    const sh = loadSH();
    const mockEnd = vi.fn();
    const hCtx = makeHCtx({
      session: { end: mockEnd },
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await sh.handleEnd(hCtx);
    expect(mockEnd).toHaveBeenCalled();
  });

  it('prints fallback message when session is null', async () => {
    const sh = loadSH();
    const hCtx = makeHCtx({ session: null });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sh.handleEnd(hCtx);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Session ended');
  });

  it('does not throw when session.end() throws', async () => {
    const sh = loadSH();
    const hCtx = makeHCtx({
      session: { end: () => { throw new Error('session-end-fail'); } },
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(sh.handleEnd(hCtx)).resolves.not.toThrow();
  });
});

// ── routing feedback ───────────────────────────────────────────────────────────

describe('session-handler routing feedback', () => {
  it('writes routing-feedback.jsonl when last-route.json exists', async () => {
    const sh = loadSH();
    const routeFile = path.join(tmpDir, '.monomind', 'last-route.json');
    fs.writeFileSync(routeFile, JSON.stringify({ agent: 'coder', confidence: 0.9 }), 'utf-8');
    const hCtx = makeHCtx({
      intelligence: { feedback: vi.fn() },
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await sh.handleEnd(hCtx);
    const feedbackFile = path.join(tmpDir, '.monomind', 'routing-feedback.jsonl');
    expect(fs.existsSync(feedbackFile)).toBe(true);
  });

  it('feedback entry has required fields', async () => {
    const sh = loadSH();
    const routeFile = path.join(tmpDir, '.monomind', 'last-route.json');
    fs.writeFileSync(routeFile, JSON.stringify({ agent: 'backend-dev', confidence: 0.85 }), 'utf-8');
    const hCtx = makeHCtx({
      hookInput: { sessionId: 'test-session-123' },
      intelligence: { feedback: vi.fn() },
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await sh.handleEnd(hCtx);
    const feedbackFile = path.join(tmpDir, '.monomind', 'routing-feedback.jsonl');
    const line = JSON.parse(fs.readFileSync(feedbackFile, 'utf-8').trim());
    expect(line).toHaveProperty('timestamp');
    expect(line).toHaveProperty('suggestedAgent');
    expect(line.suggestedAgent).toBe('backend-dev');
    expect(line).toHaveProperty('intelligenceFeedback');
  });

  it('skips feedback when no last-route.json', async () => {
    const sh = loadSH();
    const hCtx = makeHCtx({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await sh.handleEnd(hCtx);
    const feedbackFile = path.join(tmpDir, '.monomind', 'routing-feedback.jsonl');
    expect(fs.existsSync(feedbackFile)).toBe(false);
  });

  it('sessionSuccess=false when majority of outcomes are failures', async () => {
    const sh = loadSH();
    const routeFile = path.join(tmpDir, '.monomind', 'last-route.json');
    fs.writeFileSync(routeFile, JSON.stringify({ agent: 'coder', confidence: 0.7 }), 'utf-8');

    // Write mostly-failure outcomes within 30-minute window
    const outcomesFile = path.join(tmpDir, '.monomind', 'intelligence-outcomes.jsonl');
    const now = Date.now();
    const lines = [
      JSON.stringify({ ts: now - 1000, success: false }),
      JSON.stringify({ ts: now - 2000, success: false }),
      JSON.stringify({ ts: now - 3000, success: true }),
    ].join('\n') + '\n';
    fs.writeFileSync(outcomesFile, lines, 'utf-8');

    const mockFeedback = vi.fn();
    const hCtx = makeHCtx({ intelligence: { feedback: mockFeedback } });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await sh.handleEnd(hCtx);
    // sessionSuccess should be false — majority (2/3) are failures
    expect(mockFeedback).toHaveBeenCalledWith(false);
  });
});

// ── worker dispatch cleanup ────────────────────────────────────────────────────

describe('session-handler worker dispatch cleanup', () => {
  it('moves pending dispatch files to processed/', async () => {
    const sh = loadSH();
    const dispatchDir = path.join(tmpDir, '.monomind', 'worker-dispatch');
    fs.mkdirSync(dispatchDir, { recursive: true });
    fs.writeFileSync(path.join(dispatchDir, 'pending-001.json'), '{}', 'utf-8');
    fs.writeFileSync(path.join(dispatchDir, 'pending-002.json'), '{}', 'utf-8');

    const hCtx = makeHCtx({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await sh.handleEnd(hCtx);

    const processedDir = path.join(dispatchDir, 'processed');
    expect(fs.existsSync(processedDir)).toBe(true);
    const processedFiles = fs.readdirSync(processedDir);
    expect(processedFiles.length).toBe(2);
  });

  it('logs pending count when dispatch files present', async () => {
    const sh = loadSH();
    const dispatchDir = path.join(tmpDir, '.monomind', 'worker-dispatch');
    fs.mkdirSync(dispatchDir, { recursive: true });
    fs.writeFileSync(path.join(dispatchDir, 'pending-xyz.json'), '{}', 'utf-8');

    const hCtx = makeHCtx({});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sh.handleEnd(hCtx);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('WORKER_CLEANUP');
  });

  it('does not throw when no dispatch directory exists', async () => {
    const sh = loadSH();
    const hCtx = makeHCtx({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(sh.handleEnd(hCtx)).resolves.not.toThrow();
  });
});
