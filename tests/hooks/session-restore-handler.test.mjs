/**
 * Tests for .claude/helpers/handlers/session-restore-handler.cjs
 * Covers: neural kill switch, daemon detection, registry surfacing,
 *         update notification, knowledge preload, stale helper warning.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ── Minimal hCtx factory ─────────────────────────────────────────────────────

function makeHCtx(overrides = {}) {
  const cwd = overrides.CWD || os.tmpdir();
  return {
    hookInput: {},
    session: null,
    intelligence: null,
    CWD: cwd,
    helpersDir: overrides.helpersDir || cwd, // non-existent subdir so dynamic imports fail safely
    runWithTimeout: async (fn) => { try { return await fn(); } catch { return null; } },
    _openMonographDb: () => null,
    _autoIndexKnowledge: () => 0,
    _buildKnowledgeSearchFn: () => async () => [],
    getMonographSuggestions: () => [],
    get _hooksModule() { return null; },
    set _hooksModule(_) {},
    ...overrides,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadHandler() {
  const handlerPath = path.resolve(__dirname, '../../.claude/helpers/handlers/session-restore-handler.cjs');
  delete require.cache[handlerPath];
  return require(handlerPath);
}

// Capture console.log output during a handler run
async function runCapture(hCtx) {
  const lines = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...a) => lines.push(a.join(' '));
  console.warn = (...a) => lines.push(a.join(' '));
  try {
    const handler = loadHandler();
    await handler.handleRestore(hCtx);
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
  return lines;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('session-restore-handler', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-test-'));
    fs.mkdirSync(path.join(tmpDir, '.monomind'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('completes without error when all subsystems are absent', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir });
    await expect(runCapture(hCtx)).resolves.toBeInstanceOf(Array);
  });

  it('logs session restored when no session module is provided', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir, session: null });
    const lines = await runCapture(hCtx);
    const sessionLine = lines.find(l => l.includes('Session restored') || l.includes('[OK]'));
    expect(sessionLine).toBeTruthy();
  });

  it('calls session.restore() when session module is present', async () => {
    let restoreCalled = false;
    const hCtx = makeHCtx({
      CWD: tmpDir,
      session: { restore: () => { restoreCalled = true; return true; } },
    });
    await runCapture(hCtx);
    expect(restoreCalled).toBe(true);
  });

  it('skips intelligence init when monomind.neural.enabled=false', async () => {
    const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ monomind: { neural: { enabled: false } } }));
    let initCalled = false;
    const hCtx = makeHCtx({
      CWD: tmpDir,
      intelligence: { init: () => { initCalled = true; return { nodes: 5, edges: 3 }; } },
    });
    const lines = await runCapture(hCtx);
    expect(initCalled).toBe(false);
    const neuralLine = lines.find(l => l.includes('[NEURAL]'));
    expect(neuralLine).toContain('Disabled');
  });

  it('runs intelligence init when neural kill switch is absent', async () => {
    let initCalled = false;
    const hCtx = makeHCtx({
      CWD: tmpDir,
      intelligence: { init: () => { initCalled = true; return { nodes: 5, edges: 3 }; } },
    });
    await runCapture(hCtx);
    expect(initCalled).toBe(true);
  });

  it('logs [INTELLIGENCE] Loaded when init returns nodes', async () => {
    const hCtx = makeHCtx({
      CWD: tmpDir,
      intelligence: { init: () => ({ nodes: 42, edges: 10 }) },
    });
    const lines = await runCapture(hCtx);
    const intelLine = lines.find(l => l.includes('[INTELLIGENCE]') && l.includes('42'));
    expect(intelLine).toBeTruthy();
  });

  it('logs [DAEMON_STOPPED] when daemon.pid does not exist', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir });
    const lines = await runCapture(hCtx);
    const daemonLine = lines.find(l => l.includes('[DAEMON_STOPPED]') || l.includes('[DAEMON_AUTOSTART]'));
    expect(daemonLine).toBeTruthy();
    expect(daemonLine).toContain('[DAEMON_STOPPED]');
  });

  it('logs [DAEMON_STOPPED] even when daemon.pid has a stale pid', async () => {
    const pidPath = path.join(tmpDir, '.monomind', 'daemon.pid');
    fs.writeFileSync(pidPath, '999999999'); // non-existent pid
    const hCtx = makeHCtx({ CWD: tmpDir });
    const lines = await runCapture(hCtx);
    const daemonLine = lines.find(l => l.includes('[DAEMON_STOPPED]'));
    expect(daemonLine).toBeTruthy();
  });

  it('surfaces [REGISTRY] count when registry.json has agents', async () => {
    const regPath = path.join(tmpDir, '.monomind', 'registry.json');
    fs.writeFileSync(regPath, JSON.stringify({ agents: ['a', 'b', 'c'] }));
    const hCtx = makeHCtx({ CWD: tmpDir });
    const lines = await runCapture(hCtx);
    const regLine = lines.find(l => l.includes('[REGISTRY]'));
    expect(regLine).toBeTruthy();
    expect(regLine).toContain('3');
  });

  it('does not log [REGISTRY] when registry.json is absent', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir });
    const lines = await runCapture(hCtx);
    expect(lines.find(l => l.includes('[REGISTRY]'))).toBeUndefined();
  });

  it('surfaces [UPDATE_AVAILABLE] when pending-update.json has from≠to', async () => {
    const updatePath = path.join(tmpDir, '.monomind', 'pending-update.json');
    fs.writeFileSync(updatePath, JSON.stringify({ from: '1.10.28', to: '1.10.29' }));
    const hCtx = makeHCtx({ CWD: tmpDir });
    const lines = await runCapture(hCtx);
    const updateLine = lines.find(l => l.includes('[UPDATE_AVAILABLE]'));
    expect(updateLine).toBeTruthy();
    expect(updateLine).toContain('1.10.28');
  });

  it('does not log [UPDATE_AVAILABLE] when from===to', async () => {
    const updatePath = path.join(tmpDir, '.monomind', 'pending-update.json');
    fs.writeFileSync(updatePath, JSON.stringify({ from: '1.10.29', to: '1.10.29' }));
    const hCtx = makeHCtx({ CWD: tmpDir });
    const lines = await runCapture(hCtx);
    expect(lines.find(l => l.includes('[UPDATE_AVAILABLE]'))).toBeUndefined();
  });

  it('logs [KNOWLEDGE_INDEXED] when _autoIndexKnowledge returns > 0', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir, _autoIndexKnowledge: () => 7 });
    const lines = await runCapture(hCtx);
    const kLine = lines.find(l => l.includes('[KNOWLEDGE_INDEXED]'));
    expect(kLine).toBeTruthy();
    expect(kLine).toContain('7');
  });

  it('does not log [KNOWLEDGE_INDEXED] when autoIndex returns 0', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir, _autoIndexKnowledge: () => 0 });
    const lines = await runCapture(hCtx);
    expect(lines.find(l => l.includes('[KNOWLEDGE_INDEXED]'))).toBeUndefined();
  });

  it('logs [KNOWLEDGE_PRELOADED] when search fn returns results', async () => {
    const mockResult = [{ key: 'c1', value: 'some text', score: 0.8, metadata: {} }];
    const hCtx = makeHCtx({
      CWD: tmpDir,
      _buildKnowledgeSearchFn: () => async () => mockResult,
    });
    const lines = await runCapture(hCtx);
    const kLine = lines.find(l => l.includes('[KNOWLEDGE_PRELOADED]'));
    expect(kLine).toBeTruthy();
    expect(kLine).toContain('1');
  });

  it('handles session module that throws without crashing handler', async () => {
    const hCtx = makeHCtx({
      CWD: tmpDir,
      session: { restore: () => { throw new Error('db locked'); } },
    });
    await expect(runCapture(hCtx)).resolves.toBeInstanceOf(Array);
  });

  it('writes last-update-check.json on first run', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir });
    await runCapture(hCtx);
    const checkPath = path.join(tmpDir, '.monomind', 'last-update-check.json');
    expect(fs.existsSync(checkPath)).toBe(true);
    const data = JSON.parse(fs.readFileSync(checkPath, 'utf-8'));
    expect(data.timestamp).toBeTruthy();
  });

  it('skips update check when last-update-check.json is < 24h old', async () => {
    const checkPath = path.join(tmpDir, '.monomind', 'last-update-check.json');
    fs.writeFileSync(checkPath, JSON.stringify({ timestamp: new Date().toISOString() }));
    const mtime = fs.statSync(checkPath).mtimeMs;
    const hCtx = makeHCtx({ CWD: tmpDir });
    await runCapture(hCtx);
    // File should not have been rewritten (mtime unchanged)
    expect(fs.statSync(checkPath).mtimeMs).toBe(mtime);
  });

  it('suppresses [STALE_HELPERS] when running inside the monomind dev repo', async () => {
    // Create the dev-repo sentinel: packages/@monomind/cli/package.json
    fs.mkdirSync(path.join(tmpDir, 'packages', '@monomind', 'cli'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'packages', '@monomind', 'cli', 'package.json'), '{"version":"1.0.0"}');
    const hCtx = makeHCtx({ CWD: tmpDir });
    const lines = await runCapture(hCtx);
    expect(lines.find(l => l.includes('[STALE_HELPERS]'))).toBeUndefined();
  });

  it('does not probe [CONTROL_UI] when daemon.pid and monomind.config.json are both absent', async () => {
    const hCtx = makeHCtx({ CWD: tmpDir });
    const lines = await runCapture(hCtx);
    expect(lines.find(l => l.includes('[CONTROL_UI]'))).toBeUndefined();
  });

  it('completes without error when monomind.config.json exists (probe condition)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'monomind.config.json'), JSON.stringify({ daemon: {} }));
    const hCtx = makeHCtx({ CWD: tmpDir });
    // The http probe is async fire-and-forget; handler must not throw synchronously
    await expect(runCapture(hCtx)).resolves.toBeInstanceOf(Array);
  });
});
