/**
 * Tests for:
 *   .claude/helpers/handlers/compact-handler.cjs
 *   .claude/helpers/handlers/budget-status-handler.cjs
 *   .claude/helpers/handlers/loops-status-handler.cjs
 *   .claude/helpers/handlers/stats-handler.cjs
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function loadHandler(name) {
  const p = path.resolve(__dirname, '../../.claude/helpers/handlers/' + name);
  delete require.cache[p];
  return require(p);
}

function capture(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try { fn(); } finally { console.log = orig; }
  return lines;
}

async function captureAsync(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try { await fn(); } finally { console.log = orig; }
  return lines;
}

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uh-test-'));
  fs.mkdirSync(path.join(tmpDir, '.monomind'), { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── compact-handler ────────────────────────────────────────────────────────────

describe('compact-handler', () => {
  function makeCtx(overrides = {}) {
    return {
      CWD: tmpDir,
      intelligence: null,
      runWithTimeout: async (fn) => fn(),
      _injectCompactGraphMap: () => {},
      ...overrides,
    };
  }

  it('logs [COMPACT] Manual for mode=manual', async () => {
    const lines = await captureAsync(() =>
      loadHandler('compact-handler.cjs').handle(makeCtx(), 'manual')
    );
    expect(lines.find(l => l.includes('[COMPACT]') && l.includes('Manual'))).toBeTruthy();
    expect(lines.find(l => l.includes('GOLDEN RULE'))).toBeUndefined();
  });

  it('logs [COMPACT] Auto + GOLDEN RULE for mode=auto', async () => {
    const lines = await captureAsync(() =>
      loadHandler('compact-handler.cjs').handle(makeCtx(), 'auto')
    );
    expect(lines.find(l => l.includes('[COMPACT]') && l.includes('Auto'))).toBeTruthy();
    expect(lines.find(l => l.includes('GOLDEN RULE'))).toBeTruthy();
  });

  it('calls intelligence.consolidate() when present', async () => {
    let called = false;
    const ctx = makeCtx({ intelligence: { consolidate: () => { called = true; } } });
    await captureAsync(() => loadHandler('compact-handler.cjs').handle(ctx, 'manual'));
    expect(called).toBe(true);
  });

  it('skips consolidate when intelligence is null', async () => {
    // Should not throw
    const ctx = makeCtx({ intelligence: null });
    await expect(captureAsync(() =>
      loadHandler('compact-handler.cjs').handle(ctx, 'manual')
    )).resolves.toBeInstanceOf(Array);
  });

  it('logs [COMPACT_CONTEXT] when last-route.json exists', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.monomind', 'last-route.json'),
      JSON.stringify({ agent: 'coder', confidence: 0.87 })
    );
    const lines = await captureAsync(() =>
      loadHandler('compact-handler.cjs').handle(makeCtx(), 'manual')
    );
    const ctxLine = lines.find(l => l.includes('[COMPACT_CONTEXT]'));
    expect(ctxLine).toBeTruthy();
    expect(ctxLine).toContain('coder');
    expect(ctxLine).toContain('87%');
  });

  it('shows ? for confidence when last-route.json has no confidence field', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.monomind', 'last-route.json'),
      JSON.stringify({ agent: 'tester' })
    );
    const lines = await captureAsync(() =>
      loadHandler('compact-handler.cjs').handle(makeCtx(), 'auto')
    );
    expect(lines.find(l => l.includes('[COMPACT_CONTEXT]') && l.includes('?%'))).toBeTruthy();
  });

  it('skips [COMPACT_CONTEXT] when last-route.json is absent', async () => {
    const lines = await captureAsync(() =>
      loadHandler('compact-handler.cjs').handle(makeCtx(), 'manual')
    );
    expect(lines.find(l => l.includes('[COMPACT_CONTEXT]'))).toBeUndefined();
  });

  it('calls _injectCompactGraphMap', async () => {
    let called = false;
    const ctx = makeCtx({ _injectCompactGraphMap: () => { called = true; } });
    await captureAsync(() => loadHandler('compact-handler.cjs').handle(ctx, 'manual'));
    expect(called).toBe(true);
  });
});

// ── budget-status-handler ─────────────────────────────────────────────────────

describe('budget-status-handler', () => {
  function makeCtx(budgetData) {
    return { _getBudgetStatus: () => budgetData };
  }

  it('logs "No budget data yet" when _getBudgetStatus returns null', () => {
    const lines = capture(() => loadHandler('budget-status-handler.cjs').handle(makeCtx(null)));
    expect(lines.find(l => l.includes('No budget data yet'))).toBeTruthy();
  });

  it('logs Today/Month/Status lines when budget data is present', () => {
    const b = { todayCost: 1.23, dailyLimit: 5, dailyPct: 24, monthCost: 45.6, monthlyLimit: 100, monthlyPct: 45, breached: false, spike: false, alert: false, autoTuned: false };
    const lines = capture(() => loadHandler('budget-status-handler.cjs').handle(makeCtx(b)));
    expect(lines.find(l => l.startsWith('Today:'))).toBeTruthy();
    expect(lines.find(l => l.startsWith('Month:'))).toBeTruthy();
    expect(lines.find(l => l.startsWith('Status:'))).toBeTruthy();
  });

  it('shows Status: OK when no flags set', () => {
    const b = { todayCost: 0, dailyLimit: 5, dailyPct: 0, monthCost: 0, monthlyLimit: 100, monthlyPct: 0, breached: false, spike: false, alert: false, autoTuned: false };
    const lines = capture(() => loadHandler('budget-status-handler.cjs').handle(makeCtx(b)));
    expect(lines.find(l => l.includes('Status:  OK'))).toBeTruthy();
  });

  it('shows Status: BREACHED when breached=true', () => {
    const b = { todayCost: 6, dailyLimit: 5, dailyPct: 120, monthCost: 6, monthlyLimit: 100, monthlyPct: 6, breached: true, spike: false, alert: false, autoTuned: false };
    const lines = capture(() => loadHandler('budget-status-handler.cjs').handle(makeCtx(b)));
    expect(lines.find(l => l.includes('BREACHED'))).toBeTruthy();
  });

  it('shows Status: SPIKE when spike=true and not breached', () => {
    const b = { todayCost: 3, dailyLimit: 5, dailyPct: 60, monthCost: 3, monthlyLimit: 100, monthlyPct: 3, breached: false, spike: true, alert: false, autoTuned: false };
    const lines = capture(() => loadHandler('budget-status-handler.cjs').handle(makeCtx(b)));
    expect(lines.find(l => l.includes('SPIKE'))).toBeTruthy();
  });

  it('shows Status: ALERT when alert=true and not spiking', () => {
    const b = { todayCost: 2, dailyLimit: 5, dailyPct: 40, monthCost: 2, monthlyLimit: 100, monthlyPct: 2, breached: false, spike: false, alert: true, autoTuned: false };
    const lines = capture(() => loadHandler('budget-status-handler.cjs').handle(makeCtx(b)));
    expect(lines.find(l => l.includes('ALERT'))).toBeTruthy();
  });

  it('appends [auto-tuned] to Today line when autoTuned=true', () => {
    const b = { todayCost: 1, dailyLimit: 5, dailyPct: 20, monthCost: 1, monthlyLimit: 100, monthlyPct: 1, breached: false, spike: false, alert: false, autoTuned: true };
    const lines = capture(() => loadHandler('budget-status-handler.cjs').handle(makeCtx(b)));
    expect(lines.find(l => l.includes('[auto-tuned]'))).toBeTruthy();
  });

  it('includes cost amounts in Today/Month lines', () => {
    const b = { todayCost: 1.23, dailyLimit: 5, dailyPct: 24, monthCost: 45.67, monthlyLimit: 100, monthlyPct: 45, breached: false, spike: false, alert: false, autoTuned: false };
    const lines = capture(() => loadHandler('budget-status-handler.cjs').handle(makeCtx(b)));
    expect(lines.find(l => l.includes('$1.23'))).toBeTruthy();
    expect(lines.find(l => l.includes('$45.67'))).toBeTruthy();
  });
});

// ── loops-status-handler ──────────────────────────────────────────────────────

describe('loops-status-handler', () => {
  function makeCtx() { return { CWD: tmpDir }; }

  function writeLoop(name, data) {
    const loopsDir = path.join(tmpDir, '.monomind', 'loops');
    fs.mkdirSync(loopsDir, { recursive: true });
    fs.writeFileSync(path.join(loopsDir, name), JSON.stringify(data));
  }

  it('logs "No loops directory." when .monomind/loops is absent', () => {
    const lines = capture(() => loadHandler('loops-status-handler.cjs').handle(makeCtx()));
    expect(lines.find(l => l.includes('No loops directory.'))).toBeTruthy();
  });

  it('logs "No loops." when loops dir exists but is empty', () => {
    fs.mkdirSync(path.join(tmpDir, '.monomind', 'loops'), { recursive: true });
    const lines = capture(() => loadHandler('loops-status-handler.cjs').handle(makeCtx()));
    expect(lines.find(l => l.includes('No loops.'))).toBeTruthy();
  });

  it('shows Active section for recent loop (lastRunAt < 6h ago)', () => {
    writeLoop('loop-1.json', { command: '/monomind:do', type: 'do', currentRep: 3, maxReps: 10, status: 'running', lastRunAt: Date.now() - 60000 });
    const lines = capture(() => loadHandler('loops-status-handler.cjs').handle(makeCtx()));
    expect(lines.find(l => l.includes('Active (1)'))).toBeTruthy();
    expect(lines.find(l => l.includes('/monomind:do') && l.includes('3/10'))).toBeTruthy();
  });

  it('shows Stale section for old loop (lastRunAt > 6h ago)', () => {
    writeLoop('loop-old.json', { command: '/monomind:repeat', type: 'repeat', currentRep: 5, status: 'idle', lastRunAt: Date.now() - 7 * 3600 * 1000 });
    const lines = capture(() => loadHandler('loops-status-handler.cjs').handle(makeCtx()));
    expect(lines.find(l => l.includes('Stale (1'))).toBeTruthy();
    expect(lines.find(l => l.includes('/monomind:repeat') && l.includes('h ago'))).toBeTruthy();
  });

  it('ignores files with -hil in the name', () => {
    writeLoop('loop-hil-1.json', { command: '/monomind:do', type: 'do', status: 'running', lastRunAt: Date.now() });
    const lines = capture(() => loadHandler('loops-status-handler.cjs').handle(makeCtx()));
    expect(lines.find(l => l.includes('Active'))).toBeUndefined();
    expect(lines.find(l => l.includes('No loops.'))).toBeTruthy();
  });

  it('ignores .stop files', () => {
    writeLoop('loop-1.stop', { command: '/monomind:do' });
    const lines = capture(() => loadHandler('loops-status-handler.cjs').handle(makeCtx()));
    expect(lines.find(l => l.includes('No loops.'))).toBeTruthy();
  });

  it('uses startedAt when lastRunAt is absent', () => {
    writeLoop('loop-new.json', { command: '/monomind:do', type: 'do', status: 'starting', startedAt: Date.now() - 30000 });
    const lines = capture(() => loadHandler('loops-status-handler.cjs').handle(makeCtx()));
    expect(lines.find(l => l.includes('Active (1)'))).toBeTruthy();
  });

  it('shows both Active and Stale when mixed', () => {
    writeLoop('loop-active.json', { command: '/a', type: 'do', status: 'running', lastRunAt: Date.now() - 1000 });
    writeLoop('loop-stale.json', { command: '/b', type: 'do', status: 'idle', lastRunAt: Date.now() - 8 * 3600 * 1000 });
    const lines = capture(() => loadHandler('loops-status-handler.cjs').handle(makeCtx()));
    expect(lines.find(l => l.includes('Active (1)'))).toBeTruthy();
    expect(lines.find(l => l.includes('Stale (1'))).toBeTruthy();
  });

  it('handles malformed loop JSON without crashing', () => {
    fs.mkdirSync(path.join(tmpDir, '.monomind', 'loops'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.monomind', 'loops', 'bad.json'), 'not-json');
    const lines = capture(() => loadHandler('loops-status-handler.cjs').handle(makeCtx()));
    expect(lines.find(l => l.includes('No loops.'))).toBeTruthy();
  });
});

// ── stats-handler ─────────────────────────────────────────────────────────────

describe('stats-handler', () => {
  function makeCtx(overrides = {}) {
    return { intelligence: null, args: [], ...overrides };
  }

  it('logs [WARN] when intelligence is null', async () => {
    const lines = await captureAsync(() =>
      loadHandler('stats-handler.cjs').handle(makeCtx())
    );
    expect(lines.find(l => l.includes('[WARN]') && l.includes('Intelligence module not available'))).toBeTruthy();
  });

  it('logs [WARN] when intelligence has no stats method', async () => {
    const lines = await captureAsync(() =>
      loadHandler('stats-handler.cjs').handle(makeCtx({ intelligence: {} }))
    );
    expect(lines.find(l => l.includes('[WARN]'))).toBeTruthy();
  });

  it('calls intelligence.stats() when available', async () => {
    let calledWith = null;
    const ctx = makeCtx({ intelligence: { stats: (json) => { calledWith = json; } } });
    await captureAsync(() => loadHandler('stats-handler.cjs').handle(ctx));
    expect(calledWith).toBe(false);
  });

  it('passes true to intelligence.stats() when args includes --json', async () => {
    let calledWith = null;
    const ctx = makeCtx({
      intelligence: { stats: (json) => { calledWith = json; } },
      args: ['--json'],
    });
    await captureAsync(() => loadHandler('stats-handler.cjs').handle(ctx));
    expect(calledWith).toBe(true);
  });

  it('does not throw when intelligence.stats() throws', async () => {
    const ctx = makeCtx({
      intelligence: { stats: () => { throw new Error('db locked'); } },
    });
    // stats-handler delegates to runWithTimeout in the parent — but here it calls
    // Promise.resolve() which catches synchronous throws. Verify no unhandled rejection.
    await expect(captureAsync(() =>
      loadHandler('stats-handler.cjs').handle(ctx)
    )).resolves.toBeInstanceOf(Array);
  });
});
