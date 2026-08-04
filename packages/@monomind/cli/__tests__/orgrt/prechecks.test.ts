// packages/@monomind/cli/__tests__/orgrt/prechecks.test.ts
import { describe, it, expect } from 'vitest';
import { runPrechecks } from '../../src/orgrt/prechecks.js';

describe('runPrechecks', () => {
  it('returns ok when all checks pass', async () => {
    const { ok, results } = await runPrechecks([
      { name: 'true-check', command: 'true' },
      { name: 'echo-check', command: 'echo hello' },
    ], process.cwd());
    expect(ok).toBe(true);
    expect(results).toHaveLength(2);
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('returns not-ok on first failing check and stops', async () => {
    const { ok, results } = await runPrechecks([
      { name: 'pass', command: 'true' },
      { name: 'fail', command: 'false' },
      { name: 'never-reached', command: 'echo unreachable' },
    ], process.cwd());
    expect(ok).toBe(false);
    expect(results).toHaveLength(2);
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(false);
  });

  it('returns ok for empty checks array', async () => {
    const { ok, results } = await runPrechecks([], process.cwd());
    expect(ok).toBe(true);
    expect(results).toHaveLength(0);
  });

  it('captures output from passing command', async () => {
    const { ok, results } = await runPrechecks([
      { name: 'echo-test', command: 'echo "precheck-output"' },
    ], process.cwd());
    expect(ok).toBe(true);
    expect(results[0].output).toContain('precheck-output');
  });

  it('captures output from failing command', async () => {
    const { ok, results } = await runPrechecks([
      { name: 'fail-with-msg', command: 'echo "bad state" >&2; exit 1' },
    ], process.cwd());
    expect(ok).toBe(false);
    expect(results[0].passed).toBe(false);
    expect(results[0].output).toBeTruthy();
  });
});
