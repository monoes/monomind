/**
 * Tests for route-handler.cjs and edit-handler.cjs
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
    toolInput: {},
    args: [],
    prompt: 'implement a feature',
    CWD: cwd,
    session: null,
    router: null,
    intelligence: null,
    isSimpleCommand: () => false,
    getMonographSuggestions: () => [],
    _getBudgetStatus: () => null,
    _getRecentEdits: () => [],
    _recordRecentEdit: () => {},
    _recordDecisionMarkers: () => {},
    _recordGraphTelemetry: () => {},
    _findAffectedTests: () => [],
    _maybeRebuildMonograph: () => {},
    _requireMonograph: () => null,
    _openMonographDb: () => null,
    scanMicroAgentTriggers: () => ({ matches: [], injectAgents: [], takeoverAgent: null }),
    runWithTimeout: async (fn) => { try { return await fn(); } catch { return null; } },
    ...overrides,
  };
}

function loadRoute() {
  const p = path.resolve(__dirname, '../../.claude/helpers/handlers/route-handler.cjs');
  delete require.cache[p];
  return require(p);
}

function loadEdit() {
  const p = path.resolve(__dirname, '../../.claude/helpers/handlers/edit-handler.cjs');
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

// ── route-handler ─────────────────────────────────────────────────────────────

describe('route-handler', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-test-'));
    fs.mkdirSync(path.join(tmpDir, '.monomind'), { recursive: true });
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('simple command writes last-route.json and returns early (no panel)', async () => {
    const hCtx = makeHCtx({
      CWD: tmpDir,
      prompt: '/ts',
      isSimpleCommand: () => true,
      hookInput: { commandName: '/ts' },
    });
    const lines = await capture(() => loadRoute().handle(hCtx));
    const routePath = path.join(tmpDir, '.monomind', 'last-route.json');
    expect(fs.existsSync(routePath)).toBe(true);
    const data = JSON.parse(fs.readFileSync(routePath, 'utf-8'));
    expect(data.semanticRouting).toBe(false);
    expect(lines.find(l => l.includes('monomind | Primary Recommendation'))).toBeUndefined();
  });

  it('no router logs [INFO] Router not available', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir, router: null });
    const lines = await capture(() => loadRoute().handle(hCtx));
    expect(lines.join('\n')).toContain('[INFO] Router not available');
  });

  it('router result writes last-route.json with agent and confidence', async () => {
    const hCtx = makeHCtx({
      CWD: tmpDir,
      router: { routeTask: () => ({ agent: 'coder', confidence: 0.9, reason: 'test', skillMatches: [], specificAgents: [], extrasMatches: [] }) },
    });
    await capture(() => loadRoute().handle(hCtx));
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, '.monomind', 'last-route.json'), 'utf-8'));
    expect(data.agent).toBe('coder');
    expect(data.confidence).toBe(0.9);
  });

  it('shows primary recommendation panel when confidence >= 0.70', async () => {
    const hCtx = makeHCtx({
      CWD: tmpDir,
      router: { routeTask: () => ({ agent: 'coder', confidence: 0.9, reason: 'keyword', skillMatches: [], specificAgents: [], extrasMatches: [] }) },
    });
    const lines = await capture(() => loadRoute().handle(hCtx));
    expect(lines.join('\n')).toContain('monomind | Primary Recommendation');
    expect(lines.join('\n')).toContain('coder');
  });

  it('suppresses panel for low-confidence (<0.70) short prompt', async () => {
    const hCtx = makeHCtx({
      CWD: tmpDir,
      prompt: 'do stuff',
      router: { routeTask: () => ({ agent: 'China E-Commerce Operator', confidence: 0.5, reason: 'keyword', skillMatches: [], specificAgents: [], extrasMatches: [] }) },
    });
    const lines = await capture(() => loadRoute().handle(hCtx));
    expect(lines.join('\n')).not.toContain('monomind | Primary Recommendation');
  });

  it('logs [BUDGET_BREACHED] when budget is breached', async () => {
    const hCtx = makeHCtx({
      CWD: tmpDir,
      router: { routeTask: () => ({ agent: 'coder', confidence: 0.9, reason: 'kw', skillMatches: [], specificAgents: [], extrasMatches: [] }) },
      _getBudgetStatus: () => ({
        alert: true, breached: true, spike: false, autoTuned: false,
        todayCost: 15, dailyLimit: 10, dailyPct: 150,
        monthCost: 100, monthlyLimit: 200, monthlyPct: 50,
      }),
    });
    const lines = await capture(() => loadRoute().handle(hCtx));
    expect(lines.join('\n')).toContain('[BUDGET_BREACHED]');
  });

  it('logs [ROUTING_MODE] when swarm-config.json is present', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.monomind', 'swarm-config.json'),
      JSON.stringify({ topology: 'hierarchical' })
    );
    const hCtx = makeHCtx({
      CWD: tmpDir,
      router: { routeTask: () => ({ agent: 'coder', confidence: 0.9, reason: 'kw', skillMatches: [], specificAgents: [], extrasMatches: [] }) },
    });
    const lines = await capture(() => loadRoute().handle(hCtx));
    expect(lines.join('\n')).toContain('[ROUTING_MODE]');
    expect(lines.join('\n')).toContain('hierarchical');
  });

  it('does not log [ROUTING_MODE] when swarm-config.json is absent', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir, router: null });
    const lines = await capture(() => loadRoute().handle(hCtx));
    expect(lines.join('\n')).not.toContain('[ROUTING_MODE]');
  });

  it('logs MicroAgent TAKEOVER when scanMicroAgentTriggers returns a takeoverAgent', async () => {
    const hCtx = makeHCtx({
      CWD: tmpDir,
      router: { routeTask: () => ({ agent: 'coder', confidence: 0.9, reason: 'kw', skillMatches: [], specificAgents: [], extrasMatches: [] }) },
      scanMicroAgentTriggers: () => ({
        matches: [{ agentSlug: 'Database Optimizer', matchedText: 'sql query' }],
        injectAgents: [],
        takeoverAgent: 'Database Optimizer',
      }),
    });
    const lines = await capture(() => loadRoute().handle(hCtx));
    expect(lines.join('\n')).toContain('MicroAgent TAKEOVER');
    expect(lines.join('\n')).toContain('Database Optimizer');
  });
});

// ── edit-handler ──────────────────────────────────────────────────────────────

describe('edit-handler', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eh-test-'));
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it('always logs [OK] Edit recorded', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir });
    const lines = await capture(() => loadEdit().handle(hCtx));
    expect(lines.find(l => l.includes('[OK] Edit recorded'))).toBeTruthy();
  });

  it('calls session.metric("edits") when session is present', async () => {
    let metricCalled = false;
    const hCtx = makeHCtx({
      CWD: tmpDir,
      session: { metric: (k) => { if (k === 'edits') metricCalled = true; } },
    });
    await capture(() => loadEdit().handle(hCtx));
    expect(metricCalled).toBe(true);
  });

  it('calls intelligence.recordEdit with file path', async () => {
    let recordedFile = null;
    const hCtx = makeHCtx({
      CWD: tmpDir,
      hookInput: { file_path: '/some/file.ts' },
      intelligence: { recordEdit: (f) => { recordedFile = f; } },
    });
    await capture(() => loadEdit().handle(hCtx));
    expect(recordedFile).toBe('/some/file.ts');
  });

  it('logs [SECURITY_EDIT] for auth-related file paths', async () => {
    const hCtx = makeHCtx({
      CWD: tmpDir,
      hookInput: { file_path: '/src/auth/token-validator.ts' },
    });
    const lines = await capture(() => loadEdit().handle(hCtx));
    expect(lines.join('\n')).toContain('[SECURITY_EDIT]');
  });

  it('does not log [SECURITY_EDIT] for non-security files', async () => {
    const hCtx = makeHCtx({
      CWD: tmpDir,
      hookInput: { file_path: '/src/utils/formatter.ts' },
    });
    const lines = await capture(() => loadEdit().handle(hCtx));
    expect(lines.join('\n')).not.toContain('[SECURITY_EDIT]');
  });

  it('logs [AUTO_SUGGEST] for test files', async () => {
    const hCtx = makeHCtx({
      CWD: tmpDir,
      hookInput: { file_path: '/src/foo.test.ts' },
    });
    const lines = await capture(() => loadEdit().handle(hCtx));
    expect(lines.join('\n')).toContain('[AUTO_SUGGEST]');
    expect(lines.join('\n')).toContain('npm test');
  });

  it('logs [AUTO_SUGGEST] for package.json edits', async () => {
    const hCtx = makeHCtx({
      CWD: tmpDir,
      hookInput: { file_path: '/repo/package.json' },
    });
    const lines = await capture(() => loadEdit().handle(hCtx));
    expect(lines.join('\n')).toContain('[AUTO_SUGGEST]');
    expect(lines.join('\n')).toContain('npm install');
  });

  it('logs [AFFECTED_TESTS] when _findAffectedTests returns results', async () => {
    const hCtx = makeHCtx({
      CWD: tmpDir,
      hookInput: { file_path: '/src/service.ts' },
      _findAffectedTests: () => ['tests/service.test.ts'],
    });
    const lines = await capture(() => loadEdit().handle(hCtx));
    expect(lines.join('\n')).toContain('[AFFECTED_TESTS]');
    expect(lines.join('\n')).toContain('service.test.ts');
  });

  it('does not log [AFFECTED_TESTS] when editing a test file itself', async () => {
    const hCtx = makeHCtx({
      CWD: tmpDir,
      hookInput: { file_path: '/src/service.test.ts' },
      _findAffectedTests: () => ['tests/other.test.ts'], // would be returned but should be skipped
    });
    const lines = await capture(() => loadEdit().handle(hCtx));
    expect(lines.join('\n')).not.toContain('[AFFECTED_TESTS]');
  });

  it('calls _maybeRebuildMonograph on every edit', async () => {
    let called = false;
    const hCtx = makeHCtx({ CWD: tmpDir, _maybeRebuildMonograph: () => { called = true; } });
    await capture(() => loadEdit().handle(hCtx));
    expect(called).toBe(true);
  });
});
