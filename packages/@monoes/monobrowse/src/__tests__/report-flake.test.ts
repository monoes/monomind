/**
 * RIG-14 — flake detection across repeated runs.
 *
 * The load-bearing assertion in here is that a check which passed some runs
 * and failed others never produces a `pass` verdict. That is the whole story:
 * the failure mode is a red check being re-run until it is green.
 */
import { describe, expect, it } from 'vitest';
import { buildReport } from '../report/analyze.js';
import { DEFAULT_BUDGET, parseBudget } from '../report/budget.js';
import {
  analyzeFlake,
  ruledOutFailureRate,
  signalSignature,
  summarizeFlake,
} from '../report/flake.js';
import type { Budget, CaptureData, Report } from '../report/types.js';

function capture(partial: Partial<CaptureData> = {}): CaptureData {
  return {
    url: 'https://shop.test/checkout',
    finalUrl: 'https://shop.test/checkout',
    title: 'Checkout',
    capturedAt: '2026-09-21T10:00:00.000Z',
    durationMs: 1000,
    console: [],
    pageErrors: [],
    requests: [],
    vitals: { lcp: 2000, cls: 0.01, inp: 50 },
    a11y: [],
    screenshots: [],
    notes: [],
    ...partial,
  };
}

const run = (partial: Partial<CaptureData> = {}, budget: Budget = DEFAULT_BUDGET): Report =>
  buildReport(capture(partial), budget);

const err = (text: string) => ({ type: 'error', text, timestamp: 0 });

describe('analyzeFlake verdict', () => {
  it('passes when every check held across every run', () => {
    const flake = analyzeFlake([run(), run(), run(), run(), run()]);
    expect(flake.verdict).toBe('pass');
    expect(flake.runs).toBe(5);
    expect(flake.checks.every((c) => c.stable)).toBe(true);
    expect(flake.headline).toContain('PASS');
  });

  it('refuses to call a check that passed sometimes a pass', () => {
    // Three clean runs, two with a console error — exactly the case that gets
    // shipped as green after a re-run.
    const runs = [
      run(),
      run({ console: [err('boom')] }),
      run(),
      run({ console: [err('boom')] }),
      run(),
    ];
    const flake = analyzeFlake(runs);
    expect(flake.verdict).toBe('flaky');
    const check = flake.checks.find((c) => c.key === 'maxConsoleErrors');
    expect(check).toMatchObject({ runs: 5, passed: 3, failed: 2, stable: false });
    expect(check?.flakeRate).toBeCloseTo(0.4, 5);
    expect(flake.headline).toContain('FLAKY');
    expect(flake.headline).toContain('failed 2 of 5');
  });

  it('fails outright when a check failed in every run', () => {
    const runs = [run({ console: [err('boom')] }), run({ console: [err('boom')] })];
    const flake = analyzeFlake(runs);
    expect(flake.verdict).toBe('fail');
    expect(flake.headline).toBe('FAIL — 1 check(s) failed in all 2 runs.');
  });

  it('prefers flaky over fail when one check is unstable and another always fails', () => {
    const budget = parseBudget({ lcp: 1000 });
    const runs = [
      run({ console: [err('boom')] }, budget),
      run({}, budget), // lcp still breaches; the console error does not recur
    ];
    const flake = analyzeFlake(runs);
    expect(flake.checks.find((c) => c.key === 'lcpMs')?.failed).toBe(2);
    expect(flake.verdict).toBe('flaky');
  });

  it('records the measured value for every run, not just the failing ones', () => {
    const runs = [run({ vitals: { lcp: 1900 } }), run({ vitals: { lcp: 3400 } })];
    const lcp = analyzeFlake(runs).checks.find((c) => c.key === 'lcpMs');
    expect(lcp?.actuals).toEqual(['1900ms', '3400ms']);
  });

  it('ignores budgets that are not enforced', () => {
    const budget = parseBudget({ ttfb: null, fcp: null });
    const keys = analyzeFlake([run({}, budget)]).checks.map((c) => c.key);
    expect(keys).not.toContain('ttfbMs');
    expect(keys).not.toContain('fcpMs');
  });

  it('throws rather than inventing a verdict from no runs', () => {
    expect(() => analyzeFlake([])).toThrow(/at least one run/);
  });
});

describe('analyzeFlake signals', () => {
  it('reports how many runs an intermittent console error appeared in', () => {
    const runs = [run(), run({ console: [err('Failed to fetch /cart')] }), run(), run(), run()];
    const signal = analyzeFlake(runs).signals.find((s) => s.kind === 'console');
    expect(signal).toMatchObject({ runs: 1, total: 5, signature: 'Failed to fetch /cart' });
  });

  it('does not call an error that happened every run a flake', () => {
    const runs = [run({ console: [err('always')] }), run({ console: [err('always')] })];
    expect(analyzeFlake(runs).signals).toEqual([]);
  });

  it('groups the same error carrying a different request id', () => {
    const runs = [
      run({ console: [err('Request 1043321 failed')] }),
      run({ console: [err('Request 9910412 failed')] }),
      run(),
    ];
    const signals = analyzeFlake(runs).signals;
    expect(signals.length).toBe(1);
    expect(signals[0]).toMatchObject({ runs: 2, total: 3 });
  });

  it('reports an intermittently failing request', () => {
    const failing = {
      requests: [
        { url: 'https://api.test/cart', method: 'GET', status: 503, failed: true },
        { url: 'https://api.test/ok', method: 'GET', status: 200, failed: false },
      ],
    };
    const signals = analyzeFlake([run(), run(failing), run()]).signals;
    expect(signals).toEqual([
      { kind: 'request', signature: '503 https://api.test/cart', runs: 1, total: 3 },
    ]);
  });
});

describe('signalSignature', () => {
  it('normalises ids, hex and long numbers so one error is one signal', () => {
    expect(signalSignature('Request 1043321 failed')).toBe('Request <n> failed');
    expect(signalSignature('trace 3f2a1b4c-0000-4aaa-8bbb-1234567890ab lost')).toBe(
      'trace <uuid> lost',
    );
    expect(signalSignature('at 0xDEADBEEF')).toBe('at <hex>');
  });

  it('leaves short numbers alone — a 404 is part of the message', () => {
    expect(signalSignature('GET returned 404')).toBe('GET returned 404');
  });
});

describe('analyzeFlake metrics', () => {
  it('reports the range a metric varied across, which is the readable form', () => {
    const runs = [1900, 3400, 2100, 2000, 2050].map((lcp) => run({ vitals: { lcp } }));
    const lcp = analyzeFlake(runs).metrics.find((m) => m.key === 'lcp');
    expect(lcp).toMatchObject({ min: 1900, max: 3400, measured: 5, total: 5, unstable: true });
    expect(lcp?.spread).toBe(1500);
  });

  it('does not flag a metric that barely moved', () => {
    const runs = [2000, 2050, 2010].map((lcp) => run({ vitals: { lcp } }));
    expect(analyzeFlake(runs).metrics.find((m) => m.key === 'lcp')?.unstable).toBe(false);
  });

  it('counts how many runs actually measured the metric', () => {
    const runs = [
      run({ vitals: { lcp: 2000 } }),
      run({ vitals: {} }),
      run({ vitals: { lcp: 2100 } }),
    ];
    expect(analyzeFlake(runs).metrics.find((m) => m.key === 'lcp')?.measured).toBe(2);
  });
});

describe('confidence', () => {
  it('states what a clean window actually rules out rather than implying certainty', () => {
    const flake = analyzeFlake([run(), run(), run(), run(), run()]);
    expect(flake.confidence).toBe('high');
    expect(flake.confidenceNote).toContain('95% confidence');
    expect(flake.confidenceNote).toContain('45%');
  });

  it('is low after a single run, and says why', () => {
    const flake = analyzeFlake([run()]);
    expect(flake.confidence).toBe('low');
    expect(flake.confidenceNote).toContain('1 run');
  });

  it('is high for an observed flake, because both outcomes were seen', () => {
    const flake = analyzeFlake([run(), run({ console: [err('boom')] })]);
    expect(flake.confidence).toBe('high');
    expect(flake.confidenceNote).toContain('observed, not inferred');
  });

  it('shrinks the ruled-out rate as runs are added', () => {
    expect(ruledOutFailureRate(1)).toBeCloseTo(0.95, 5);
    expect(ruledOutFailureRate(5)).toBeCloseTo(0.4507, 3);
    expect(ruledOutFailureRate(20)).toBeCloseTo(0.1391, 3);
    expect(ruledOutFailureRate(5)).toBeGreaterThan(ruledOutFailureRate(20));
  });
});

describe('summarizeFlake', () => {
  it('is one line naming the verdict and the confidence', () => {
    const line = summarizeFlake(analyzeFlake([run(), run({ console: [err('boom')] })]));
    expect(line).toMatch(/^FLAKY — /);
    expect(line).toContain('Confidence: high.');
  });
});
