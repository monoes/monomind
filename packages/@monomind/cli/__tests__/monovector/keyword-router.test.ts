/**
 * Tests for the KeywordRouter facade in src/monovector/index.ts (#96).
 *
 * Regression: update() used to be a no-op returning 0 while getStats()
 * returned hardcoded zeros, so `monomind route feedback` silently discarded
 * user feedback. The router must persist feedback to route-outcomes.jsonl
 * and report stats derived from that store.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKeywordRouter } from '../../src/monovector/index.js';

describe('createKeywordRouter feedback persistence (#96)', () => {
  let dir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'keyword-router-'));
    // The router resolves its store at construction time from process.cwd()
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(dir);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  const outcomesFile = () => join(dir, '.monomind', 'route-outcomes.jsonl');

  it('update() persists feedback to route-outcomes.jsonl', async () => {
    const router = createKeywordRouter();
    await router.update('implement auth', 'coder', 0.9);
    expect(existsSync(outcomesFile())).toBe(true);
    const lines = readFileSync(outcomesFile(), 'utf8').trim().split('\n');
    expect(lines.length).toBe(1);
    const rec = JSON.parse(lines[0]);
    expect(rec.task).toBe('implement auth');
    expect(rec.agentActuallyUsed).toBe('coder');
    expect(rec.measuredSuccess).toBe(true);
    expect(rec.quality).toBe(0.9);
  });

  it('update() joins onto the latest unresolved route record instead of duplicating', async () => {
    const router = createKeywordRouter();
    // Simulate a recommendation recorded at route time (no outcome yet)
    const { recordRoute } = await import('../../src/monovector/route-outcomes.js');
    await recordRoute(join(dir, '.monomind'), {
      routeId: 'r1',
      ts: Date.now(),
      task: 'implement auth',
      recommendedAgent: 'coder',
      routingMethod: 'keyword',
      confidence: 0.75,
      learningMode: 'js',
    });
    await router.update('implement auth', 'coder', -0.5);
    const lines = readFileSync(outcomesFile(), 'utf8').trim().split('\n');
    expect(lines.length).toBe(1); // joined, not appended
    const rec = JSON.parse(lines[0]);
    expect(rec.routeId).toBe('r1');
    expect(rec.measuredSuccess).toBe(false);
    expect(rec.quality).toBe(-0.5);
  });

  it('getStats() reflects recorded outcomes (not hardcoded zeros)', async () => {
    const router = createKeywordRouter();
    const before = await router.getStats();
    expect(before.outcomeCount).toBe(0);
    expect(before.accuracy).toBeNull();

    await router.update('task a', 'coder', 1);
    await router.update('task b', 'tester', -1);
    const stats = await router.getStats();
    expect(stats.outcomeCount).toBe(2);
    expect(stats.accuracy).toBe(0.5);
  });

  it('export/import/reset round-trip the outcome store', async () => {
    const router = createKeywordRouter();
    await router.update('task a', 'coder', 1);
    const exported = await router.export();
    expect(exported.length).toBe(1);

    await router.reset();
    expect((await router.export()).length).toBe(0);
    expect((await router.getStats()).outcomeCount).toBe(0);

    await router.import(exported);
    expect((await router.export()).length).toBe(1);
    expect((await router.getStats()).outcomeCount).toBe(1);
  });

  it('route() labels decisions as keyword routing honestly', async () => {
    const router = createKeywordRouter();
    const decision = await router.route('write unit tests for the parser');
    expect(decision.agentType).toBe('tester');
    expect(decision.reasoning).toContain('keyword');
  });
});
