/**
 * Tests for task-handler.cjs (pre-task + post-task) and session-handler.cjs (session-end)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function makeHCtx(overrides = {}) {
  const cwd = overrides.CWD || os.tmpdir();
  return {
    hookInput: {},
    prompt: 'implement a feature',
    CWD: cwd,
    session: null,
    router: null,
    intelligence: null,
    getLearningService: async () => null,
    runWithTimeout: async (fn) => { try { return await fn(); } catch { return null; } },
    _recordDecisionMarkers: () => {},
    _requireMonograph: () => null,
    get _hooksModule() { return null; },
    set _hooksModule(_) {},
    ...overrides,
  };
}

function loadTask() {
  const p = path.resolve(__dirname, '../../.claude/helpers/handlers/task-handler.cjs');
  delete require.cache[p];
  return require(p);
}

function loadSession() {
  const p = path.resolve(__dirname, '../../.claude/helpers/handlers/session-handler.cjs');
  delete require.cache[p];
  return require(p);
}

async function capture(fn) {
  const lines = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...a) => lines.push(a.join(' '));
  console.warn = (...a) => lines.push(a.join(' '));
  try { await fn(); } finally { console.log = origLog; console.warn = origWarn; }
  return lines;
}

// ── task-handler: pre-task ────────────────────────────────────────────────────

describe('task-handler — handlePreTask', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pret-test-'));
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('logs [TASK_MODEL_RECOMMENDATION] for any non-empty prompt', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir, prompt: 'implement a feature' });
    const lines = await capture(() => loadTask().handlePreTask(hCtx));
    expect(lines.join('\n')).toContain('[TASK_MODEL_RECOMMENDATION]');
  });

  it('recommends haiku for a short simple prompt', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir, prompt: 'format the file' });
    const lines = await capture(() => loadTask().handlePreTask(hCtx));
    const rec = lines.find(l => l.includes('[TASK_MODEL_RECOMMENDATION]'));
    expect(rec).toContain('haiku');
  });

  it('recommends opus for a long architecture-level prompt', async () => {
    // score starts at 50; words>100 → +20; architecture keyword → +10; total=80 → opus
    const base = 'Design the distributed system architecture with security audit and threat model. ';
    const prompt = base.repeat(11); // 11*11=121 words, ensures >100 word threshold
    const hCtx = makeHCtx({ CWD: tmpDir, prompt });
    const lines = await capture(() => loadTask().handlePreTask(hCtx));
    const rec = lines.find(l => l.includes('[TASK_MODEL_RECOMMENDATION]'));
    expect(rec).toContain('opus');
  });

  it('logs [OK] Task started when no router', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir, router: null });
    const lines = await capture(() => loadTask().handlePreTask(hCtx));
    expect(lines.join('\n')).toContain('[OK] Task started');
  });

  it('logs [INFO] Task routed to: when router is present', async () => {
    const hCtx = makeHCtx({
      CWD: tmpDir,
      router: { routeTask: () => ({ agent: 'coder', confidence: 0.85 }) },
    });
    const lines = await capture(() => loadTask().handlePreTask(hCtx));
    expect(lines.join('\n')).toContain('[INFO] Task routed to: coder');
  });

  it('logs [AUTO_RETRY_ENABLED] when hookInput.swarmCoordinator is set', async () => {
    const hCtx = makeHCtx({
      CWD: tmpDir,
      hookInput: { swarmCoordinator: true },
    });
    const lines = await capture(() => loadTask().handlePreTask(hCtx));
    expect(lines.join('\n')).toContain('[AUTO_RETRY_ENABLED]');
  });

  it('does not log [AUTO_RETRY_ENABLED] without coordinator flag', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir });
    const lines = await capture(() => loadTask().handlePreTask(hCtx));
    expect(lines.join('\n')).not.toContain('[AUTO_RETRY_ENABLED]');
  });

  it('calls session.metric("tasks") when session is present', async () => {
    let metricArg = null;
    const hCtx = makeHCtx({
      CWD: tmpDir,
      session: { metric: (k) => { metricArg = k; } },
    });
    await capture(() => loadTask().handlePreTask(hCtx));
    expect(metricArg).toBe('tasks');
  });
});

// ── task-handler: post-task ───────────────────────────────────────────────────

describe('task-handler — handlePostTask', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postt-test-'));
    fs.mkdirSync(path.join(tmpDir, '.monomind'), { recursive: true });
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('always logs [OK] Task completed', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir });
    const lines = await capture(() => loadTask().handlePostTask(hCtx));
    expect(lines.join('\n')).toContain('[OK] Task completed');
  });

  it('queues consolidate worker after any task', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir, prompt: 'implement a feature' });
    const lines = await capture(() => loadTask().handlePostTask(hCtx));
    expect(lines.join('\n')).toContain('[WORKER_DISPATCH]');
    expect(lines.join('\n')).toContain('consolidate');
  });

  it('queues audit worker for security-related tasks', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir, prompt: 'security audit of auth module and token validation' });
    const lines = await capture(() => loadTask().handlePostTask(hCtx));
    expect(lines.join('\n')).toContain('audit');
  });

  it('queues testgaps worker for implementation tasks', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir, prompt: 'implement the new feature for user authentication' });
    const lines = await capture(() => loadTask().handlePostTask(hCtx));
    expect(lines.join('\n')).toContain('testgaps');
  });

  it('writes a pending dispatch file to worker-dispatch/', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir, prompt: 'implement feature' });
    await capture(() => loadTask().handlePostTask(hCtx));
    const dispatchDir = path.join(tmpDir, '.monomind', 'worker-dispatch');
    const files = fs.existsSync(dispatchDir) ? fs.readdirSync(dispatchDir).filter(f => f.startsWith('pending-')) : [];
    expect(files.length).toBeGreaterThan(0);
  });

  it('generates an ADR file when adr.autoGenerate=true and architect agent', async () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({ monomind: { adr: { autoGenerate: true, directory: '.monomind/adrs' } } }));
    const hCtx = makeHCtx({
      CWD: tmpDir,
      hookInput: { agentSlug: 'system-architect' },
      prompt: 'Design the architecture for the distributed event sourcing system across multiple regions',
    });
    await capture(() => loadTask().handlePostTask(hCtx));
    const adrDir = path.join(tmpDir, '.monomind', 'adrs');
    const adrs = fs.existsSync(adrDir) ? fs.readdirSync(adrDir) : [];
    expect(adrs.length).toBeGreaterThan(0);
  });
});

// ── session-handler ───────────────────────────────────────────────────────────

describe('session-handler — handleEnd', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-test-'));
    fs.mkdirSync(path.join(tmpDir, '.monomind'), { recursive: true });
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('logs [SESSION] Skipping when daemon holds consolidation lock', async () => {
    const lockPath = path.join(tmpDir, '.monomind', 'consolidation.lock');
    fs.writeFileSync(lockPath, '1');
    const hCtx = makeHCtx({ CWD: tmpDir });
    const lines = await capture(() => loadSession().handleEnd(hCtx));
    expect(lines.join('\n')).toContain('[SESSION] Skipping consolidation');
  });

  it('logs [OK] Session ended when no session module provided', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir, session: null });
    const lines = await capture(() => loadSession().handleEnd(hCtx));
    expect(lines.join('\n')).toContain('[OK] Session ended');
  });

  it('calls session.end() when session is present', async () => {
    let endCalled = false;
    const hCtx = makeHCtx({
      CWD: tmpDir,
      session: { end: () => { endCalled = true; } },
    });
    await capture(() => loadSession().handleEnd(hCtx));
    expect(endCalled).toBe(true);
  });

  it('logs [INTELLIGENCE] Consolidated when intelligence.consolidate returns entries', async () => {
    const hCtx = makeHCtx({
      CWD: tmpDir,
      intelligence: {
        consolidate: () => ({ entries: 10, edges: 4, newEntries: 2 }),
        feedback: () => {},
      },
    });
    const lines = await capture(() => loadSession().handleEnd(hCtx));
    const consLine = lines.find(l => l.includes('[INTELLIGENCE] Consolidated'));
    expect(consLine).toBeTruthy();
    expect(consLine).toContain('10');
  });

  it('does not log [INTELLIGENCE] Consolidated when no intelligence', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir, intelligence: null });
    const lines = await capture(() => loadSession().handleEnd(hCtx));
    expect(lines.find(l => l.includes('[INTELLIGENCE] Consolidated'))).toBeUndefined();
  });

  it('appends an entry to routing-feedback.jsonl when last-route.json exists', async () => {
    const routePath = path.join(tmpDir, '.monomind', 'last-route.json');
    fs.writeFileSync(routePath, JSON.stringify({ agent: 'coder', confidence: 0.9 }));
    const hCtx = makeHCtx({ CWD: tmpDir });
    await capture(() => loadSession().handleEnd(hCtx));
    const feedbackPath = path.join(tmpDir, '.monomind', 'routing-feedback.jsonl');
    expect(fs.existsSync(feedbackPath)).toBe(true);
    const lines = fs.readFileSync(feedbackPath, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines.length).toBe(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.suggestedAgent).toBe('coder');
  });

  it('does not write routing-feedback.jsonl when last-route.json is absent', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir });
    await capture(() => loadSession().handleEnd(hCtx));
    const feedbackPath = path.join(tmpDir, '.monomind', 'routing-feedback.jsonl');
    expect(fs.existsSync(feedbackPath)).toBe(false);
  });

  it('logs [WORKER_CLEANUP] when pending dispatch files exist', async () => {
    const dispatchDir = path.join(tmpDir, '.monomind', 'worker-dispatch');
    fs.mkdirSync(dispatchDir, { recursive: true });
    fs.writeFileSync(path.join(dispatchDir, 'pending-1234.json'), '{}');
    const hCtx = makeHCtx({ CWD: tmpDir });
    const lines = await capture(() => loadSession().handleEnd(hCtx));
    expect(lines.join('\n')).toContain('[WORKER_CLEANUP]');
  });

  it('does not log [WORKER_CLEANUP] when no pending dispatch files', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir });
    const lines = await capture(() => loadSession().handleEnd(hCtx));
    expect(lines.join('\n')).not.toContain('[WORKER_CLEANUP]');
  });

  it('skips intelligence consolidation when daemon holds lock', async () => {
    const lockPath = path.join(tmpDir, '.monomind', 'consolidation.lock');
    fs.writeFileSync(lockPath, '1');
    let consolidateCalled = false;
    const hCtx = makeHCtx({
      CWD: tmpDir,
      intelligence: { consolidate: () => { consolidateCalled = true; return { entries: 5, edges: 2, newEntries: 1 }; } },
    });
    await capture(() => loadSession().handleEnd(hCtx));
    expect(consolidateCalled).toBe(false);
  });
});
