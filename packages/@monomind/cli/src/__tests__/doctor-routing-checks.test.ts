/**
 * #425: the Routing Learning check must not report "routing accuracy 100%"
 * from a handful of records that are all marked successful.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkMonoesIntegration } from '../commands/doctor-routing-checks.js';

let dir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), 'doctor-routing-'));
  mkdirSync(join(dir, '.monomind'), { recursive: true });
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(dir, { recursive: true, force: true });
});

function writeOutcomes(outcomes: { success: boolean; used?: string }[]): void {
  const lines = outcomes.map((o, i) =>
    JSON.stringify({
      routeId: `r${i}`,
      ts: Date.now() - (outcomes.length - i) * 1000,
      task: `task ${i}`,
      recommendedAgent: 'coder',
      routingMethod: 'keyword',
      confidence: 0.8,
      learningMode: 'js',
      agentActuallyUsed: o.used ?? 'coder',
      measuredSuccess: o.success,
    }),
  );
  writeFileSync(join(dir, '.monomind', 'route-outcomes.jsonl'), `${lines.join('\n')}\n`);
}

describe('checkMonoesIntegration (Routing Learning)', () => {
  it('reports insufficient data, not a 100% pass, for 13 all-success records', async () => {
    writeOutcomes(Array.from({ length: 13 }, () => ({ success: true })));
    const r = await checkMonoesIntegration();
    expect(r.status).toBe('info');
    expect(r.message).toContain('insufficient data');
    expect(r.message).toContain('13');
    expect(r.message).not.toMatch(/(accuracy|success rate) \d+%/);
  });

  it('reports the PICK follow rate and its sample size', async () => {
    writeOutcomes([
      { success: true, used: 'coder' },
      { success: false, used: 'tester' },
    ]);
    const r = await checkMonoesIntegration();
    expect(r.message).toContain('PICK follow rate 50% (n=2)');
  });

  it('prints no accuracy when a large sample carries no failure signal', async () => {
    writeOutcomes(Array.from({ length: 40 }, () => ({ success: true })));
    const r = await checkMonoesIntegration();
    expect(r.status).toBe('warn');
    expect(r.message).not.toMatch(/(accuracy|success rate) \d+%/);
    expect(r.message).toContain('no contrasting signal');
  });

  it('reports accuracy with its sample size once the data carries both outcomes', async () => {
    writeOutcomes(Array.from({ length: 40 }, (_, i) => ({ success: i % 4 !== 0 })));
    const r = await checkMonoesIntegration();
    expect(r.status).toBe('pass');
    expect(r.message).toContain('routed-task success rate 75% (n=40)');
  });

  it('says insufficient data for a small routing-feedback fallback log', async () => {
    const recs = Array.from({ length: 13 }, () =>
      JSON.stringify({ sessionId: 's1', suggestedAgent: 'coder', intelligenceFeedback: true }),
    );
    writeFileSync(join(dir, '.monomind', 'routing-feedback.jsonl'), `${recs.join('\n')}\n`);
    const r = await checkMonoesIntegration();
    expect(r.status).toBe('info');
    expect(r.message).toContain('insufficient data');
  });

  it('is info, not pass, with no data at all', async () => {
    const r = await checkMonoesIntegration();
    expect(r.status).toBe('info');
  });
});
