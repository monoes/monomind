/**
 * Budget evaluation — the step that makes "the agent tested it" mean
 * something. Pure function of CaptureData + Budget, so CI behaviour is
 * testable without a browser.
 */

import { countA11y } from './a11y.js';
import { budgetLabel, formatThreshold } from './budget.js';
import type {
  A11yFinding,
  Budget,
  BudgetFailure,
  CaptureData,
  ConsoleEntry,
  Report,
  RequestEntry,
  VerdictValue,
} from './types.js';

/** How many concrete examples to quote in a failure's `detail`. */
const DETAIL_SAMPLE = 3;

export function consoleErrors(entries: ConsoleEntry[]): ConsoleEntry[] {
  return entries.filter((e) => e.type === 'error');
}

export function consoleWarnings(entries: ConsoleEntry[]): ConsoleEntry[] {
  return entries.filter((e) => e.type === 'warn' || e.type === 'warning');
}

export function failedRequests(requests: RequestEntry[]): RequestEntry[] {
  return requests.filter((r) => r.failed);
}

function truncate(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function sample(items: string[]): string {
  // Not `.map(truncate)`: map passes the index as the second argument, which
  // would become truncate's `max` and shave every sample down to nothing.
  const shown = items.slice(0, DETAIL_SAMPLE).map((item) => truncate(item));
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join(' | ')} (+${rest} more)` : shown.join(' | ');
}

function describeRequest(r: RequestEntry): string {
  const status = r.status !== undefined ? String(r.status) : (r.errorText ?? 'no response');
  return `${status} ${r.method} ${r.url}`;
}

interface CountCheck {
  key: keyof Budget;
  actual: number;
  detail: string;
}

interface MetricCheck {
  key: keyof Budget;
  actual: number | undefined;
  format: (v: number) => string;
}

export interface Evaluation {
  verdict: VerdictValue;
  failures: BudgetFailure[];
  /** Budgets that were set but could not be checked — the page never reported the metric. */
  unmeasured: string[];
}

export function evaluateBudget(data: CaptureData, budget: Budget): Evaluation {
  const failures: BudgetFailure[] = [];
  const unmeasured: string[] = [];

  const cErrors = consoleErrors(data.console);
  const failed = failedRequests(data.requests);
  const a11y = countA11y(data.a11y);

  const counts: CountCheck[] = [
    {
      key: 'maxConsoleErrors',
      actual: cErrors.length,
      detail: sample(cErrors.map((e) => e.text)),
    },
    {
      key: 'maxPageErrors',
      actual: data.pageErrors.length,
      detail: sample(data.pageErrors.map((e) => e.text)),
    },
    {
      key: 'maxFailedRequests',
      actual: failed.length,
      detail: sample(failed.map(describeRequest)),
    },
    {
      key: 'maxA11yErrors',
      actual: a11y.errors,
      detail: sample(
        data.a11y
          .filter((f) => f.impact === 'error')
          .map((f: A11yFinding) => `${f.rule} at ${f.locator}`),
      ),
    },
  ];

  for (const check of counts) {
    const limit = budget[check.key];
    if (limit === null) continue;
    if (check.actual > limit) {
      failures.push({
        budget: check.key,
        expected: formatThreshold(check.key, limit),
        actual: String(check.actual),
        detail: check.detail || undefined,
      });
    }
  }

  const ms = (v: number) => `${Math.round(v)}ms`;
  const score = (v: number) => v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  const metrics: MetricCheck[] = [
    { key: 'lcpMs', actual: data.vitals.lcp, format: ms },
    { key: 'clsScore', actual: data.vitals.cls, format: score },
    { key: 'inpMs', actual: data.vitals.inp, format: ms },
    { key: 'fcpMs', actual: data.vitals.fcp, format: ms },
    { key: 'ttfbMs', actual: data.vitals.ttfb, format: ms },
  ];

  for (const metric of metrics) {
    const limit = budget[metric.key];
    if (limit === null) continue;
    if (metric.actual === undefined || !Number.isFinite(metric.actual)) {
      // A page that never fires an LCP entry (no contentful paint, an
      // observer the browser does not support, a collector that timed out)
      // must not be silently graded as passing — but it is not a breach
      // either. Surface it as unmeasured and let the report say so.
      unmeasured.push(budgetLabel(metric.key));
      continue;
    }
    if (metric.actual > limit) {
      failures.push({
        budget: metric.key,
        expected: formatThreshold(metric.key, limit),
        actual: metric.format(metric.actual),
      });
    }
  }

  return { verdict: failures.length > 0 ? 'fail' : 'pass', failures, unmeasured };
}

export function buildReport(data: CaptureData, budget: Budget): Report {
  const evaluation = evaluateBudget(data, budget);
  const a11y = countA11y(data.a11y);
  return {
    ...data,
    budget,
    verdict: evaluation.verdict,
    failures: evaluation.failures,
    unmeasured: evaluation.unmeasured,
    counts: {
      consoleErrors: consoleErrors(data.console).length,
      consoleWarnings: consoleWarnings(data.console).length,
      pageErrors: data.pageErrors.length,
      requests: data.requests.length,
      failedRequests: failedRequests(data.requests).length,
      a11yErrors: a11y.errors,
      a11yWarnings: a11y.warnings,
    },
  };
}

/** One line for a CI log / agent transcript. */
export function summarizeVerdict(report: Report): string {
  if (report.verdict === 'pass') {
    return `PASS — ${report.counts.requests} requests, 0 budget failures`;
  }
  const names = report.failures.map((f) => budgetLabel(f.budget)).join(', ');
  return `FAIL — ${report.failures.length} budget failure(s): ${names}`;
}
