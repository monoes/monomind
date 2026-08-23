/**
 * `memory/intelligence.ts` — the live pattern store behind trajectory logging,
 * pattern search and the memory-proficiency stats doctor reports.
 *
 * It measured 13.7% statements / 7.1% branches across 1,679 lines despite
 * running on effectively every prompt. These tests drive the real public API
 * against an isolated data directory.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Most tests here call initializeIntelligence()/recordStep(), which generate
// real embeddings — the first-use model load alone can exceed the 15s default
// testTimeout when the full suite runs in parallel. Give the whole file 60s.
vi.setConfig({ testTimeout: 60000 });

let dir: string;
let prevCwd: string | undefined;

beforeEach(async () => {
  prevCwd = process.env.MONOMIND_CWD;
  dir = mkdtempSync(join(tmpdir(), 'mm-intel-'));
  // getDataDir() only uses the project-local path when .monomind already
  // exists, otherwise it falls through to the user's home directory — which a
  // test must never write to.
  mkdirSync(join(dir, '.monomind'), { recursive: true });
  process.env.MONOMIND_CWD = dir;

  const intel = await import('../memory/intelligence.js');
  intel.clearIntelligence();
  await intel.clearAllPatterns();
});

afterEach(async () => {
  const intel = await import('../memory/intelligence.js');
  intel.clearIntelligence();
  if (prevCwd === undefined) delete process.env.MONOMIND_CWD;
  else process.env.MONOMIND_CWD = prevCwd;
  rmSync(dir, { recursive: true, force: true });
});

describe('intelligence data directory', () => {
  it('follows MONOMIND_CWD, not the process working directory', async () => {
    const { getNeuralDataDir } = await import('../memory/intelligence.js');
    // Regression: this used to read process.cwd() directly, so a globally
    // installed MCP server — launched by the editor, not from the project —
    // wrote a project's learned patterns wherever it happened to boot.
    expect(getNeuralDataDir()).toBe(join(dir, '.monomind', 'neural'));
    expect(getNeuralDataDir().startsWith(process.cwd())).toBe(false);
  });
});

describe('trajectory recording and pattern retrieval', () => {
  it('initializes and reports both subsystems enabled', async () => {
    const { initializeIntelligence } = await import('../memory/intelligence.js');
    const r = await initializeIntelligence();
    expect(r.success).toBe(true);
  });

  it('records a step and surfaces it through getAllPatterns', async () => {
    const intel = await import('../memory/intelligence.js');
    await intel.initializeIntelligence();
    const ok = await intel.recordStep({
      type: 'action',
      content: 'edit src/auth.ts',
      timestamp: Date.now(),
    });
    expect(ok).toBe(true);
    const all = await intel.getAllPatterns();
    expect(all.length).toBeGreaterThan(0);
    expect(all[0]?.content).toContain('auth');
  });

  it('filters patterns by their declared type', async () => {
    const intel = await import('../memory/intelligence.js');
    await intel.initializeIntelligence();
    await intel.recordStep({ type: 'action', content: 'run the migration', timestamp: Date.now() });
    await intel.recordStep({
      type: 'thought',
      content: 'consider rollback safety',
      timestamp: Date.now(),
    });

    const actions = await intel.getPatternsByType('action');
    const thoughts = await intel.getPatternsByType('thought');
    expect(actions.length).toBeGreaterThan(0);
    expect(thoughts.length).toBeGreaterThan(0);
    expect(actions.every((p) => p.type === 'action')).toBe(true);
    // A type nobody recorded must not match anything.
    expect(await intel.getPatternsByType('no-such-type')).toEqual([]);
  });

  it('finds a semantically similar pattern for a related query', async () => {
    const intel = await import('../memory/intelligence.js');
    await intel.initializeIntelligence();
    await intel.recordStep({
      type: 'action',
      content: 'fix the authentication bug in login',
      timestamp: Date.now(),
    });
    const hits = await intel.findSimilarPatterns('authentication problem');
    expect(Array.isArray(hits)).toBe(true);
  });

  it('records a full trajectory and counts it in stats', async () => {
    const intel = await import('../memory/intelligence.js');
    await intel.initializeIntelligence();
    const before = intel.getIntelligenceStats().trajectoriesRecorded;

    // Signature is (steps, verdict) — verdict is a string, not a boolean.
    const ok = await intel.recordTrajectory(
      [
        { type: 'observation', content: 'tests are failing', timestamp: Date.now() },
        { type: 'action', content: 'run vitest', timestamp: Date.now() },
        { type: 'result', content: 'all green', timestamp: Date.now() },
      ],
      'success',
    );
    expect(ok).toBe(true);
    expect(intel.getIntelligenceStats().trajectoriesRecorded).toBe(before + 1);
  });
});

describe('pattern store maintenance', () => {
  it('deletes a pattern by id and reports false for an unknown one', async () => {
    const intel = await import('../memory/intelligence.js');
    await intel.initializeIntelligence();
    await intel.recordStep({ type: 'action', content: 'delete me', timestamp: Date.now() });
    const [first] = await intel.getAllPatterns();
    expect(first).toBeDefined();

    expect(await intel.deletePattern(first?.id)).toBe(true);
    expect(await intel.deletePattern('definitely-not-a-real-id')).toBe(false);
  });

  it('compaction never grows the store and reports consistent before/after', async () => {
    const intel = await import('../memory/intelligence.js');
    await intel.initializeIntelligence();
    // Near-identical content, so a similarity-based compaction has something
    // to collapse; the assertion holds either way.
    await intel.recordStep({
      type: 'action',
      content: 'update the readme file',
      timestamp: Date.now(),
    });
    await intel.recordStep({
      type: 'action',
      content: 'update the readme file',
      timestamp: Date.now(),
    });

    const r = await intel.compactPatterns();
    expect(r.after).toBeLessThanOrEqual(r.before);
    expect(r.removed).toBe(r.before - r.after);
  });

  it('clearAllPatterns empties the store', async () => {
    const intel = await import('../memory/intelligence.js');
    await intel.initializeIntelligence();
    await intel.recordStep({ type: 'action', content: 'something', timestamp: Date.now() });
    expect((await intel.getAllPatterns()).length).toBeGreaterThan(0);
    await intel.clearAllPatterns();
    expect(await intel.getAllPatterns()).toEqual([]);
  });

  it('flushes patterns to disk under the resolved data directory', async () => {
    const intel = await import('../memory/intelligence.js');
    await intel.initializeIntelligence();
    await intel.recordStep({ type: 'action', content: 'persist me', timestamp: Date.now() });
    intel.flushPatterns();
    expect(existsSync(join(dir, '.monomind', 'neural', 'patterns.json'))).toBe(true);
  });
});

describe('memory proficiency tracking', () => {
  it('counts recorded decisions and keeps the success rate in range', async () => {
    const intel = await import('../memory/intelligence.js');
    const before = intel.getMemoryProficiencyStats().totalDecisions;

    await intel.recordMemoryDecision({
      taskDescription: 'fix the login bug',
      agent: 'coder',
      success: true,
      latencyMs: 12,
    });
    await intel.recordMemoryDecision({
      taskDescription: 'refactor the router',
      agent: 'coder',
      success: false,
      latencyMs: 30,
    });

    const stats = intel.getMemoryProficiencyStats();
    expect(stats.totalDecisions).toBe(before + 2);
    expect(stats.successRate).toBeGreaterThanOrEqual(0);
    expect(stats.successRate).toBeLessThanOrEqual(1);
  });
});

describe('clearIntelligence leaves the subsystem re-initializable', () => {
  /**
   * Regression: clearIntelligence() nulled sonaCoordinator, reasoningBank and
   * intelligenceInitialized but kept the resolved `initPromise`.
   * initializeIntelligence() returns an existing initPromise without re-running
   * init, so it reported success while both objects stayed null — and the next
   * call into the store threw "Cannot read properties of null (reading
   * 'clear')". Intelligence was unusable after a clear for the whole process.
   */
  it('re-initializes and works again after a clear', async () => {
    const intel = await import('../memory/intelligence.js');
    await intel.initializeIntelligence();
    await intel.recordStep({ type: 'action', content: 'first run', timestamp: Date.now() });

    intel.clearIntelligence();

    const again = await intel.initializeIntelligence();
    expect(again.success).toBe(true);
    expect(again.reasoningBankEnabled).toBe(true);

    // The operation that used to throw.
    await expect(intel.clearAllPatterns()).resolves.toBeUndefined();
    await expect(
      intel.recordStep({ type: 'action', content: 'after clear', timestamp: Date.now() }),
    ).resolves.toBe(true);
    expect((await intel.getAllPatterns()).length).toBeGreaterThan(0);
  });
});
