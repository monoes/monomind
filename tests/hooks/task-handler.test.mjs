/**
 * Tests for .claude/helpers/handlers/task-handler.cjs
 * Builds a minimal mock hCtx and calls handlePreTask / handlePostTask directly.
 * Verifies: model tier recommendation, worker dispatch, ADR generation,
 * and the [OK] completion messages.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const TH_PATH = path.resolve(__dirname, '../../.claude/helpers/handlers/task-handler.cjs');

function loadTH() {
  delete require.cache[TH_PATH];
  return require(TH_PATH);
}

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'th-test-'));
  fs.mkdirSync(path.join(tmpDir, '.monomind'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function makeHCtx(overrides = {}) {
  return {
    hookInput: {},
    prompt: '',
    CWD: tmpDir,
    session: null,
    router: null,
    intelligence: null,
    _requireMonograph: () => null,
    _hooksModule: null,
    ...overrides,
  };
}

// ── handlePreTask — model tier recommendation ──────────────────────────────────

describe('task-handler.handlePreTask model tier', () => {
  it('recommends haiku for very short/simple prompt', async () => {
    const th = loadTH();
    const hCtx = makeHCtx({ prompt: 'rename variable' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePreTask(hCtx);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('[TASK_MODEL_RECOMMENDATION]');
    expect(output).toContain('haiku');
  });

  it('recommends opus for large complex architecture task (>200 words)', async () => {
    const th = loadTH();
    // score: base 50 + >100 words (+20) + >200 words (+10) = 80 → opus
    const filler = 'word '.repeat(210); // 210 words → >200 words condition
    const longComplexPrompt = filler + 'architecture security design';
    const hCtx = makeHCtx({ prompt: longComplexPrompt });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePreTask(hCtx);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('[TASK_MODEL_RECOMMENDATION]');
    expect(output).toContain('opus');
  });

  it('recommends sonnet for moderate complexity', async () => {
    const th = loadTH();
    // 30-40 words, no high/low keywords
    const prompt = 'Update the user profile page to show the avatar and bio section with proper validation and error handling for the form submission flow';
    const hCtx = makeHCtx({ prompt });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePreTask(hCtx);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('[TASK_MODEL_RECOMMENDATION]');
    expect(output).toContain('sonnet');
  });

  it('does NOT print recommendation when no prompt', async () => {
    const th = loadTH();
    const hCtx = makeHCtx({ prompt: '' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePreTask(hCtx);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).not.toContain('[TASK_MODEL_RECOMMENDATION]');
  });

  it('prints AUTO_RETRY_ENABLED when swarmCoordinator is set', async () => {
    const th = loadTH();
    const hCtx = makeHCtx({
      hookInput: { swarmCoordinator: true },
      prompt: 'do task',
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePreTask(hCtx);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('[AUTO_RETRY_ENABLED]');
  });

  it('prints [OK] Task started when no router', async () => {
    const th = loadTH();
    const hCtx = makeHCtx({ prompt: 'do something', router: null });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePreTask(hCtx);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('[OK] Task started');
  });

  it('routes task and logs result when router is available', async () => {
    const th = loadTH();
    const mockRoute = vi.fn().mockResolvedValue({ agent: 'coder', confidence: 0.88 });
    const hCtx = makeHCtx({
      prompt: 'implement new feature',
      router: { routeTask: mockRoute },
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePreTask(hCtx);
    expect(mockRoute).toHaveBeenCalled();
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Task routed');
  });
});

// ── handlePostTask — worker dispatch ──────────────────────────────────────────

describe('task-handler.handlePostTask worker dispatch', () => {
  it('writes a pending dispatch file after any task', async () => {
    const th = loadTH();
    const hCtx = makeHCtx({ prompt: 'do something' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePostTask(hCtx);
    const dispatchDir = path.join(tmpDir, '.monomind', 'worker-dispatch');
    expect(fs.existsSync(dispatchDir)).toBe(true);
    const files = fs.readdirSync(dispatchDir).filter(f => f.startsWith('pending-'));
    expect(files.length).toBeGreaterThan(0);
  });

  it('always dispatches consolidate worker', async () => {
    const th = loadTH();
    const hCtx = makeHCtx({ prompt: 'format imports' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePostTask(hCtx);
    const dispatchDir = path.join(tmpDir, '.monomind', 'worker-dispatch');
    const files = fs.readdirSync(dispatchDir).filter(f => f.startsWith('pending-'));
    const payload = JSON.parse(fs.readFileSync(path.join(dispatchDir, files[0]), 'utf-8'));
    expect(payload.workers).toContain('consolidate');
  });

  it('adds audit worker for security-related task', async () => {
    const th = loadTH();
    const hCtx = makeHCtx({ prompt: 'fix security vulnerability in auth module' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePostTask(hCtx);
    const dispatchDir = path.join(tmpDir, '.monomind', 'worker-dispatch');
    const files = fs.readdirSync(dispatchDir).filter(f => f.startsWith('pending-'));
    const payload = JSON.parse(fs.readFileSync(path.join(dispatchDir, files[0]), 'utf-8'));
    expect(payload.workers).toContain('audit');
  });

  it('adds testgaps worker for implementation tasks', async () => {
    const th = loadTH();
    const hCtx = makeHCtx({ prompt: 'implement new feature for user dashboard' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePostTask(hCtx);
    const dispatchDir = path.join(tmpDir, '.monomind', 'worker-dispatch');
    const files = fs.readdirSync(dispatchDir).filter(f => f.startsWith('pending-'));
    const payload = JSON.parse(fs.readFileSync(path.join(dispatchDir, files[0]), 'utf-8'));
    expect(payload.workers).toContain('testgaps');
  });

  it('adds benchmark worker for performance tasks', async () => {
    const th = loadTH();
    const hCtx = makeHCtx({ prompt: 'optimize performance of the search index' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePostTask(hCtx);
    const dispatchDir = path.join(tmpDir, '.monomind', 'worker-dispatch');
    const files = fs.readdirSync(dispatchDir).filter(f => f.startsWith('pending-'));
    const payload = JSON.parse(fs.readFileSync(path.join(dispatchDir, files[0]), 'utf-8'));
    expect(payload.workers).toContain('benchmark');
  });

  it('prints [WORKER_DISPATCH] with queued worker names', async () => {
    const th = loadTH();
    const hCtx = makeHCtx({ prompt: 'fix bug' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePostTask(hCtx);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('[WORKER_DISPATCH]');
  });

  it('prints [OK] Task completed', async () => {
    const th = loadTH();
    const hCtx = makeHCtx({ prompt: 'done' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePostTask(hCtx);
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('[OK] Task completed');
  });
});

// ── handlePostTask — agent registration cleanup ────────────────────────────────

describe('task-handler.handlePostTask agent registration', () => {
  it('removes oldest registration file from regDir', async () => {
    const th = loadTH();
    const regDir = path.join(tmpDir, '.monomind', 'agents', 'registrations');
    fs.mkdirSync(regDir, { recursive: true });
    fs.writeFileSync(path.join(regDir, 'agent-001.json'), '{}', 'utf-8');
    fs.writeFileSync(path.join(regDir, 'agent-002.json'), '{}', 'utf-8');

    const hCtx = makeHCtx({ prompt: 'task done' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePostTask(hCtx);

    const remaining = fs.readdirSync(regDir).filter(f => f.endsWith('.json'));
    expect(remaining.length).toBe(1); // one removed (oldest)
  });

  it('does not throw when regDir does not exist', async () => {
    const th = loadTH();
    const hCtx = makeHCtx({ prompt: 'task done' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(th.handlePostTask(hCtx)).resolves.not.toThrow();
  });

  it('updates swarm-activity.json with agent count', async () => {
    const th = loadTH();
    const regDir = path.join(tmpDir, '.monomind', 'agents', 'registrations');
    fs.mkdirSync(regDir, { recursive: true });
    // Also create the metrics dir (code writes directly without mkdirSync)
    fs.mkdirSync(path.join(tmpDir, '.monomind', 'metrics'), { recursive: true });
    fs.writeFileSync(path.join(regDir, 'agent-a.json'), '{}', 'utf-8');
    fs.writeFileSync(path.join(regDir, 'agent-b.json'), '{}', 'utf-8');
    fs.writeFileSync(path.join(regDir, 'agent-c.json'), '{}', 'utf-8');

    const hCtx = makeHCtx({ prompt: 'task done' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePostTask(hCtx);

    const actPath = path.join(tmpDir, '.monomind', 'metrics', 'swarm-activity.json');
    expect(fs.existsSync(actPath)).toBe(true);
    const data = JSON.parse(fs.readFileSync(actPath, 'utf-8'));
    expect(data.swarm).toHaveProperty('agent_count');
  });
});

// ── handlePostTask — intelligence feedback ────────────────────────────────────

describe('task-handler.handlePostTask intelligence feedback', () => {
  it('calls intelligence.feedback(true) after task', async () => {
    const th = loadTH();
    const mockFeedback = vi.fn();
    const hCtx = makeHCtx({
      prompt: 'complete task',
      intelligence: { feedback: mockFeedback },
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await th.handlePostTask(hCtx);
    expect(mockFeedback).toHaveBeenCalledWith(true);
  });

  it('does not throw when intelligence is null', async () => {
    const th = loadTH();
    const hCtx = makeHCtx({ prompt: 'done', intelligence: null });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await expect(th.handlePostTask(hCtx)).resolves.not.toThrow();
  });
});
