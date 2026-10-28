/**
 * Tests for .claude/helpers/handlers/session-handler.cjs
 * Builds a minimal mock hCtx and calls handler.handleEnd(hCtx) directly.
 * Verifies: consolidation lock, routing-feedback.jsonl, session.end().
 */

import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Session ended');
  });

  it('does not throw when session.end() throws', async () => {
    const sh = loadSH();
    const hCtx = makeHCtx({
      session: {
        end: () => {
          throw new Error('session-end-fail');
        },
      },
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
    fs.writeFileSync(
      routeFile,
      JSON.stringify({ agent: 'coder', confidence: 0.9, sessionId: 'sess-1' }),
      'utf-8',
    );
    const hCtx = makeHCtx({
      hookInput: { sessionId: 'sess-1' },
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
    fs.writeFileSync(
      routeFile,
      JSON.stringify({ agent: 'backend-dev', confidence: 0.85, sessionId: 'test-session-123' }),
      'utf-8',
    );
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
    // No evidence (no commits, no outcomes) → success flag is omitted, not defaulted to true
    expect(line.intelligenceFeedback).toBeUndefined();
  });

  it('normalizes agent labels to lowercase slugs', async () => {
    const sh = loadSH();
    const routeFile = path.join(tmpDir, '.monomind', 'last-route.json');
    fs.writeFileSync(
      routeFile,
      JSON.stringify({ agent: 'Backend Dev', confidence: 0.8, sessionId: 'sess-1' }),
      'utf-8',
    );
    const hCtx = makeHCtx({
      hookInput: { sessionId: 'sess-1' },
      intelligence: { feedback: vi.fn() },
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await sh.handleEnd(hCtx);
    const feedbackFile = path.join(tmpDir, '.monomind', 'routing-feedback.jsonl');
    const line = JSON.parse(fs.readFileSync(feedbackFile, 'utf-8').trim());
    expect(line.suggestedAgent).toBe('backend-dev');
  });

  it('skips the record when the agent is a non-agent placeholder', async () => {
    const sh = loadSH();
    const routeFile = path.join(tmpDir, '.monomind', 'last-route.json');
    fs.writeFileSync(
      routeFile,
      JSON.stringify({ agent: 'AI selecting', confidence: 0.8 }),
      'utf-8',
    );
    const hCtx = makeHCtx({ intelligence: { feedback: vi.fn() } });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await sh.handleEnd(hCtx);
    const feedbackFile = path.join(tmpDir, '.monomind', 'routing-feedback.jsonl');
    expect(fs.existsSync(feedbackFile)).toBe(false);
  });

  it('skips feedback when no last-route.json', async () => {
    const sh = loadSH();
    const hCtx = makeHCtx({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await sh.handleEnd(hCtx);
    const feedbackFile = path.join(tmpDir, '.monomind', 'routing-feedback.jsonl');
    expect(fs.existsSync(feedbackFile)).toBe(false);
  });
});
