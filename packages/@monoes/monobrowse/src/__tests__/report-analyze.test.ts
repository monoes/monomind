/**
 * Budget evaluation decides the exit code, so these cover the boundaries
 * (at the limit passes, one over fails) and the cases where a metric simply
 * was not measured — which must not silently grade as a pass.
 */
import { describe, expect, it } from 'vitest';
import {
  buildReport,
  evaluateBudget,
  failedRequests,
  summarizeVerdict,
} from '../report/analyze.js';
import { DEFAULT_BUDGET, parseBudget } from '../report/budget.js';
import type { A11yFinding, CaptureData, ConsoleEntry, RequestEntry } from '../report/types.js';

function capture(partial: Partial<CaptureData> = {}): CaptureData {
  return {
    url: 'https://example.test/',
    finalUrl: 'https://example.test/',
    title: 'Example',
    capturedAt: '2026-09-21T10:00:00.000Z',
    durationMs: 1234,
    console: [],
    pageErrors: [],
    requests: [],
    vitals: {},
    a11y: [],
    screenshots: [],
    notes: [],
    ...partial,
  };
}

const consoleEntry = (type: string, text: string): ConsoleEntry => ({
  type,
  text,
  timestamp: 0,
});

const request = (partial: Partial<RequestEntry> = {}): RequestEntry => ({
  url: 'https://example.test/api',
  method: 'GET',
  failed: false,
  ...partial,
});

const a11yError = (rule: A11yFinding['rule']): A11yFinding => ({
  rule,
  impact: 'error',
  role: 'button',
  name: null,
  locator: '#x',
  detail: 'no name',
});

describe('evaluateBudget', () => {
  it('passes a clean page against the defaults', () => {
    const result = evaluateBudget(
      capture({ vitals: { lcp: 900, cls: 0.02, inp: 80 } }),
      DEFAULT_BUDGET,
    );
    expect(result.verdict).toBe('pass');
    expect(result.failures).toEqual([]);
    expect(result.unmeasured).toEqual([]);
  });

  it('fails on a console error and names expected vs actual', () => {
    const result = evaluateBudget(
      capture({ console: [consoleEntry('error', 'Uncaught TypeError: x is not a function')] }),
      parseBudget({ lcp: null, cls: null, inp: null }),
    );
    expect(result.verdict).toBe('fail');
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      budget: 'maxConsoleErrors',
      expected: '<= 0',
      actual: '1',
    });
    expect(result.failures[0].detail).toContain('Uncaught TypeError');
  });

  it('does not count console warnings as errors', () => {
    const result = evaluateBudget(
      capture({ console: [consoleEntry('warn', 'deprecated')] }),
      parseBudget({ lcp: null, cls: null, inp: null }),
    );
    expect(result.verdict).toBe('pass');
  });

  it('fails on failed requests and quotes the first few', () => {
    const requests = [
      request({ failed: true, status: 500, url: 'https://example.test/a' }),
      request({ failed: true, errorText: 'net::ERR_NAME_NOT_RESOLVED', url: 'https://x.test/b' }),
      request({ status: 200 }),
    ];
    const result = evaluateBudget(capture({ requests }), DEFAULT_BUDGET);
    const failure = result.failures.find((f) => f.budget === 'maxFailedRequests');
    expect(failure).toBeDefined();
    expect(failure?.actual).toBe('2');
    expect(failure?.detail).toContain('500 GET https://example.test/a');
    expect(failure?.detail).toContain('net::ERR_NAME_NOT_RESOLVED');
  });

  it('treats a metric exactly at the limit as passing, and one over as failing', () => {
    const budget = parseBudget({ lcp: 2500, cls: null, inp: null });
    expect(evaluateBudget(capture({ vitals: { lcp: 2500 } }), budget).verdict).toBe('pass');
    const over = evaluateBudget(capture({ vitals: { lcp: 2501 } }), budget);
    expect(over.verdict).toBe('fail');
    expect(over.failures[0]).toMatchObject({
      budget: 'lcpMs',
      expected: '<= 2500ms',
      actual: '2501ms',
    });
  });

  it('records an unmeasured metric instead of passing it', () => {
    const result = evaluateBudget(
      capture({ vitals: {} }),
      parseBudget({ lcp: 2500, cls: null, inp: null }),
    );
    expect(result.verdict).toBe('pass');
    expect(result.unmeasured).toEqual(['LCP (Largest Contentful Paint)']);
  });

  it('skips a budget set to null entirely', () => {
    const result = evaluateBudget(
      capture({ vitals: { lcp: 99_000 } }),
      parseBudget({ lcp: null, cls: null, inp: null }),
    );
    expect(result.verdict).toBe('pass');
    expect(result.unmeasured).toEqual([]);
  });

  it('counts a11y errors but not a11y warnings against the a11y budget', () => {
    const a11y: A11yFinding[] = [
      a11yError('unlabelled-control'),
      { ...a11yError('heading-order-jump'), impact: 'warning' },
    ];
    const result = evaluateBudget(capture({ a11y }), DEFAULT_BUDGET);
    const failure = result.failures.find((f) => f.budget === 'maxA11yErrors');
    expect(failure?.actual).toBe('1');
    expect(failure?.detail).toContain('unlabelled-control at #x');
  });

  it('reports a CLS breach as a score, not milliseconds', () => {
    const result = evaluateBudget(
      capture({ vitals: { cls: 0.42 } }),
      parseBudget({ lcp: null, inp: null }),
    );
    expect(result.failures[0]).toMatchObject({
      budget: 'clsScore',
      expected: '<= 0.1',
      actual: '0.42',
    });
  });
});

describe('failedRequests', () => {
  it('selects only entries marked failed', () => {
    expect(failedRequests([request({ failed: true }), request()])).toHaveLength(1);
  });
});

describe('buildReport', () => {
  it('carries the verdict, the failure list and the headline counts', () => {
    const report = buildReport(
      capture({
        console: [consoleEntry('error', 'boom'), consoleEntry('warn', 'meh')],
        requests: [request({ failed: true, status: 404 }), request({ status: 200 })],
        a11y: [a11yError('image-missing-alt')],
        vitals: { lcp: 1000, cls: 0, inp: 10 },
      }),
      DEFAULT_BUDGET,
    );
    expect(report.verdict).toBe('fail');
    expect(report.counts).toEqual({
      consoleErrors: 1,
      consoleWarnings: 1,
      pageErrors: 0,
      requests: 2,
      failedRequests: 1,
      a11yErrors: 1,
      a11yWarnings: 0,
    });
    expect(report.failures.map((f) => f.budget).sort()).toEqual([
      'maxA11yErrors',
      'maxConsoleErrors',
      'maxFailedRequests',
    ]);
  });

  it('summarizes a pass and a fail in one line each', () => {
    const pass = buildReport(capture({ vitals: { lcp: 10, cls: 0, inp: 1 } }), DEFAULT_BUDGET);
    expect(summarizeVerdict(pass)).toContain('PASS');
    const fail = buildReport(
      capture({ pageErrors: [{ text: 'boom', timestamp: 0 }] }),
      DEFAULT_BUDGET,
    );
    expect(summarizeVerdict(fail)).toContain('FAIL');
    expect(summarizeVerdict(fail)).toContain('Uncaught page errors');
  });
});
