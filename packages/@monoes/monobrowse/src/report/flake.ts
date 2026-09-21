/**
 * Flake detection across repeated runs of the same URL (RIG-14).
 *
 * The failure mode this exists to stop: a check that fails two runs in five
 * gets re-run until it is green and shipped as "passing". So the aggregate
 * verdict has a third value — `flaky` — and a check that both passed and
 * failed within the window can only produce that verdict. It is never
 * rounded down to `pass`.
 *
 * The other half is honesty about what N runs can prove. `confidenceNote`
 * states the failure rate the window actually rules out, because "5 runs
 * passed" and "this is reliable" are very different claims.
 *
 * Pure: the tests feed arrays of Reports.
 */

import { budgetLabel } from './budget.js';
import type { Budget, Report } from './types.js';

export type FlakeVerdict = 'pass' | 'fail' | 'flaky';

export interface FlakeCheck {
  key: keyof Budget;
  label: string;
  runs: number;
  passed: number;
  failed: number;
  /** Fraction of runs that failed, 0..1. */
  flakeRate: number;
  /** True when the check did the same thing every run. */
  stable: boolean;
  /** The measured value for each run, in run order. */
  actuals: string[];
}

export interface FlakeSignal {
  kind: 'console' | 'pageError' | 'request' | 'a11y';
  signature: string;
  /** Runs this signal appeared in. */
  runs: number;
  total: number;
}

export interface FlakeMetric {
  key: string;
  label: string;
  unit: 'ms' | 'score';
  /** Runs that reported the metric at all. */
  measured: number;
  total: number;
  min: number;
  max: number;
  median: number;
  spread: number;
  /** Spread as a fraction of the median. */
  spreadRatio: number;
  unstable: boolean;
}

export interface FlakeReport {
  runs: number;
  verdict: FlakeVerdict;
  checks: FlakeCheck[];
  /** Errors and failed requests that did not appear in every run. */
  signals: FlakeSignal[];
  metrics: FlakeMetric[];
  confidence: 'low' | 'moderate' | 'high';
  confidenceNote: string;
  headline: string;
}

/** Spread beyond this fraction of the median is worth flagging as unstable. */
const UNSTABLE_SPREAD_RATIO = 0.3;

const COUNT_READERS: Partial<Record<keyof Budget, (r: Report) => number>> = {
  maxConsoleErrors: (r) => r.counts.consoleErrors,
  maxPageErrors: (r) => r.counts.pageErrors,
  maxFailedRequests: (r) => r.counts.failedRequests,
  maxA11yErrors: (r) => r.counts.a11yErrors,
};

const METRIC_READERS: Partial<Record<keyof Budget, (r: Report) => number | undefined>> = {
  lcpMs: (r) => r.vitals.lcp,
  clsScore: (r) => r.vitals.cls,
  inpMs: (r) => r.vitals.inp,
  fcpMs: (r) => r.vitals.fcp,
  ttfbMs: (r) => r.vitals.ttfb,
};

function actualFor(key: keyof Budget, report: Report): string {
  const count = COUNT_READERS[key];
  if (count) return String(count(report));
  const metric = METRIC_READERS[key];
  const raw = metric?.(report);
  if (raw === undefined || !Number.isFinite(raw)) return 'not measured';
  return key === 'clsScore' ? raw.toFixed(3) : `${Math.round(raw)}ms`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function truncate(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Normalise a message so the same error reported with a different id, line or
 * timestamp still counts as the same signal. Without this, a flaky error
 * carrying a request id looks like N distinct one-off errors.
 */
export function signalSignature(text: string): string {
  return truncate(
    text
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
      .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
      // 5 digits and up, not 3: request ids, timestamps and byte offsets are
      // long, while an HTTP status code is part of what makes two errors
      // different and must survive normalisation.
      .replace(/\b\d{5,}\b/g, '<n>'),
  );
}

function collectSignals(reports: Report[]): FlakeSignal[] {
  const total = reports.length;
  const seen = new Map<
    string,
    { kind: FlakeSignal['kind']; signature: string; runs: Set<number> }
  >();

  const add = (kind: FlakeSignal['kind'], signature: string, runIndex: number) => {
    const id = `${kind}\n${signature}`;
    let entry = seen.get(id);
    if (!entry) {
      entry = { kind, signature, runs: new Set() };
      seen.set(id, entry);
    }
    entry.runs.add(runIndex);
  };

  reports.forEach((report, i) => {
    for (const e of report.console) {
      if (e.type === 'error') add('console', signalSignature(e.text), i);
    }
    for (const e of report.pageErrors) add('pageError', signalSignature(e.text), i);
    for (const r of report.requests) {
      if (r.failed) add('request', `${r.status ?? r.errorText ?? 'no response'} ${r.url}`, i);
    }
    for (const f of report.a11y) {
      if (f.impact === 'error') add('a11y', `${f.rule} at ${f.locator}`, i);
    }
  });

  return [...seen.values()]
    .filter((e) => e.runs.size < total) // present in every run is a bug, not a flake
    .map((e) => ({ kind: e.kind, signature: e.signature, runs: e.runs.size, total }))
    .sort((a, b) => b.runs - a.runs || a.signature.localeCompare(b.signature));
}

function collectMetrics(reports: Report[]): FlakeMetric[] {
  const defs: Array<[string, string, 'ms' | 'score', (r: Report) => number | undefined]> = [
    ['lcp', 'LCP', 'ms', (r) => r.vitals.lcp],
    ['fcp', 'FCP', 'ms', (r) => r.vitals.fcp],
    ['cls', 'CLS', 'score', (r) => r.vitals.cls],
    ['inp', 'INP', 'ms', (r) => r.vitals.inp],
    ['ttfb', 'TTFB', 'ms', (r) => r.vitals.ttfb],
  ];
  const out: FlakeMetric[] = [];
  for (const [key, label, unit, read] of defs) {
    const values = reports
      .map(read)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (!values.length) continue;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const mid = median(values);
    const spread = max - min;
    const spreadRatio = mid > 0 ? spread / mid : spread > 0 ? Infinity : 0;
    out.push({
      key,
      label,
      unit,
      measured: values.length,
      total: reports.length,
      min,
      max,
      median: mid,
      spread,
      spreadRatio,
      unstable: values.length > 1 && spreadRatio > UNSTABLE_SPREAD_RATIO,
    });
  }
  return out;
}

/**
 * What a window of all-passing runs actually rules out.
 *
 * If a check truly fails with probability p, N independent passing runs have
 * probability (1-p)^N. Solving (1-p)^N = 0.05 gives the largest failure rate
 * consistent with what we saw at 95% confidence — which is a far less
 * flattering number than "N runs passed" sounds.
 */
export function ruledOutFailureRate(runs: number): number {
  if (runs <= 0) return 1;
  return 1 - 0.05 ** (1 / runs);
}

function confidenceFor(
  runs: number,
  verdict: FlakeVerdict,
): { confidence: FlakeReport['confidence']; note: string } {
  if (verdict === 'flaky') {
    return {
      confidence: 'high',
      note: `Flakiness is observed, not inferred: both outcomes occurred within ${runs} runs.`,
    };
  }
  const bound = Math.round(ruledOutFailureRate(runs) * 100);
  const level = runs >= 5 ? 'high' : runs >= 3 ? 'moderate' : 'low';
  const outcome = verdict === 'pass' ? 'passed' : 'failed';
  return {
    confidence: level,
    note:
      `${runs} run${runs === 1 ? '' : 's'}, all ${outcome} consistently. That only rules out ` +
      `intermittent behaviour more frequent than about 1 run in ${Math.max(2, Math.round(100 / bound))} ` +
      `(${bound}%) at 95% confidence — re-run with a larger --repeat to tighten it.`,
  };
}

/**
 * Aggregate N runs of the same URL.
 *
 * `budget` comes from the runs themselves (they all share one), and only
 * enforced keys become checks: an unenforced budget cannot be flaky.
 */
export function analyzeFlake(reports: Report[]): FlakeReport {
  if (!reports.length) throw new Error('analyzeFlake: needs at least one run');
  const runs = reports.length;
  const budget = reports[0].budget;

  const checks: FlakeCheck[] = [];
  for (const key of Object.keys(budget) as Array<keyof Budget>) {
    if (budget[key] === null) continue;
    const failed = reports.filter((r) => r.failures.some((f) => f.budget === key)).length;
    checks.push({
      key,
      label: budgetLabel(key),
      runs,
      passed: runs - failed,
      failed,
      flakeRate: failed / runs,
      stable: failed === 0 || failed === runs,
      actuals: reports.map((r) => actualFor(key, r)),
    });
  }

  const unstableChecks = checks.filter((c) => !c.stable);
  const alwaysFailing = checks.filter((c) => c.failed === runs);
  const verdict: FlakeVerdict = unstableChecks.length
    ? 'flaky'
    : alwaysFailing.length
      ? 'fail'
      : 'pass';

  const signals = collectSignals(reports);
  const metrics = collectMetrics(reports);
  const { confidence, note } = confidenceFor(runs, verdict);

  let headline: string;
  if (verdict === 'flaky') {
    const worst = [...unstableChecks].sort((a, b) => b.failed - a.failed)[0];
    headline =
      `FLAKY — ${unstableChecks.length} check${unstableChecks.length === 1 ? '' : 's'} ` +
      `changed outcome across ${runs} runs (e.g. ${worst.label} failed ${worst.failed} of ${runs}).`;
  } else if (verdict === 'fail') {
    headline = `FAIL — ${alwaysFailing.length} check(s) failed in all ${runs} runs.`;
  } else {
    const unstableMetrics = metrics.filter((m) => m.unstable).length;
    headline =
      `PASS — every check held across all ${runs} runs` +
      (unstableMetrics ? `, though ${unstableMetrics} metric(s) varied widely.` : '.');
  }

  return {
    runs,
    verdict,
    checks,
    signals,
    metrics,
    confidence,
    confidenceNote: note,
    headline,
  };
}

/** One line for a CI log / agent transcript. */
export function summarizeFlake(flake: FlakeReport): string {
  return `${flake.headline} Confidence: ${flake.confidence}.`;
}
