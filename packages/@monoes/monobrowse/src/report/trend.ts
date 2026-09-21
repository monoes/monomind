/**
 * Trends across a URL's run history (RIG-13).
 *
 * The point is catching slow decay. A single run that renders in 2.4s looks
 * fine; the same page at 2.0s nine runs ago is a regression nobody filed a
 * bug for, because no individual run ever crossed the budget. So every series
 * reports two deltas — against the previous run (what just changed) and
 * against the oldest run in the window (what has been happening) — and the
 * second one is what produces a headline.
 *
 * Pure: the tests feed arrays of history records.
 */

import type { HistoryRun } from './history.js';
import type { Report, TrendDirection, TrendPoint, TrendReport, TrendSeries } from './types.js';

type Unit = 'ms' | 'score' | 'count';

interface SeriesDef {
  key: string;
  label: string;
  unit: Unit;
  read: (run: Pick<HistoryRun, 'vitals' | 'counts'>) => number | null | undefined;
}

const SERIES: SeriesDef[] = [
  { key: 'lcp', label: 'LCP', unit: 'ms', read: (r) => r.vitals.lcp },
  { key: 'fcp', label: 'FCP', unit: 'ms', read: (r) => r.vitals.fcp },
  { key: 'cls', label: 'CLS', unit: 'score', read: (r) => r.vitals.cls },
  { key: 'inp', label: 'INP', unit: 'ms', read: (r) => r.vitals.inp },
  { key: 'ttfb', label: 'TTFB', unit: 'ms', read: (r) => r.vitals.ttfb },
  {
    key: 'consoleErrors',
    label: 'Console errors',
    unit: 'count',
    read: (r) => r.counts.consoleErrors,
  },
  { key: 'pageErrors', label: 'Page errors', unit: 'count', read: (r) => r.counts.pageErrors },
  {
    key: 'failedRequests',
    label: 'Failed requests',
    unit: 'count',
    read: (r) => r.counts.failedRequests,
  },
  {
    key: 'a11yErrors',
    label: 'Accessibility errors',
    unit: 'count',
    read: (r) => r.counts.a11yErrors,
  },
];

/**
 * Smallest change worth calling a change. Chrome's own run-to-run variance on
 * a paint metric is tens of milliseconds, so without a floor every series
 * would report a direction every single run and the word would stop meaning
 * anything.
 */
function significant(unit: Unit, delta: number, base: number | null): boolean {
  const magnitude = Math.abs(delta);
  if (unit === 'count') return magnitude >= 1;
  if (unit === 'score') return magnitude >= 0.01;
  const relative = base !== null && base > 0 ? base * 0.05 : 0;
  return magnitude >= Math.max(25, relative);
}

export function formatTrendValue(unit: Unit, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (unit === 'ms') {
    return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
  }
  if (unit === 'score') return value.toFixed(3);
  return String(Math.round(value));
}

export function formatTrendDelta(unit: Unit, delta: number | null): string {
  if (delta === null || !Number.isFinite(delta) || delta === 0) return 'no change';
  const sign = delta > 0 ? '+' : '−';
  return `${sign}${formatTrendValue(unit, Math.abs(delta))}`;
}

function clean(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function buildSeries(def: SeriesDef, history: HistoryRun[], current: Report): TrendSeries {
  const points: TrendPoint[] = history.map((run) => ({
    capturedAt: run.capturedAt,
    value: clean(def.read(run)),
  }));
  const currentValue = clean(def.read({ vitals: current.vitals, counts: current.counts }));
  points.push({ capturedAt: current.capturedAt, value: currentValue });

  const priorWithValues = points.slice(0, -1).filter((p) => p.value !== null);
  const previous = priorWithValues.length
    ? (priorWithValues[priorWithValues.length - 1].value as number)
    : null;
  const oldest = priorWithValues.length ? (priorWithValues[0].value as number) : null;

  const deltaFromPrevious =
    currentValue !== null && previous !== null ? currentValue - previous : null;
  const deltaFromOldest = currentValue !== null && oldest !== null ? currentValue - oldest : null;

  let direction: TrendDirection = 'flat';
  if (currentValue === null || previous === null) {
    direction = 'new';
  } else if (deltaFromPrevious !== null && significant(def.unit, deltaFromPrevious, previous)) {
    // Every metric here is lower-is-better, so the sign maps straight across.
    direction = deltaFromPrevious > 0 ? 'regressed' : 'improved';
  }

  const series: TrendSeries = {
    key: def.key,
    label: def.label,
    unit: def.unit,
    points,
    current: currentValue,
    previous,
    oldest,
    deltaFromPrevious,
    deltaFromOldest,
    direction,
  };

  // The creep sentence: drift across the whole window, which is invisible run
  // to run. Needs at least three prior points to be worth asserting.
  if (
    priorWithValues.length >= 3 &&
    deltaFromOldest !== null &&
    oldest !== null &&
    significant(def.unit, deltaFromOldest, oldest)
  ) {
    const verb = deltaFromOldest > 0 ? 'crept up' : 'come down';
    series.creep =
      `${def.label} has ${verb} ${formatTrendValue(def.unit, Math.abs(deltaFromOldest))} ` +
      `over ${points.length} runs (${formatTrendValue(def.unit, oldest)} → ${formatTrendValue(def.unit, currentValue)}).`;
  }
  return series;
}

/**
 * Rank the creep sentences so the report leads with the worst. Regressions
 * first, then by how far the metric moved relative to where it started.
 */
function headlinesFor(series: TrendSeries[], history: HistoryRun[], current: Report): string[] {
  const regressions = series
    .filter((s) => s.creep && (s.deltaFromOldest ?? 0) > 0)
    .sort((a, b) => {
      const ratio = (s: TrendSeries) =>
        s.oldest && s.oldest > 0 ? Math.abs(s.deltaFromOldest ?? 0) / s.oldest : Infinity;
      return ratio(b) - ratio(a);
    })
    .map((s) => s.creep as string);

  const headlines = [...regressions];

  // A verdict flip is the loudest thing that can happen, so it goes first.
  const priorVerdicts = history.map((r) => r.verdict);
  const allPassed = priorVerdicts.length > 0 && priorVerdicts.every((v) => v === 'pass');
  const allFailed = priorVerdicts.length > 0 && priorVerdicts.every((v) => v === 'fail');
  if (current.verdict === 'fail' && allPassed) {
    headlines.unshift(
      `First failure in this window — the previous ${priorVerdicts.length} run(s) all passed.`,
    );
  } else if (current.verdict === 'pass' && allFailed) {
    headlines.unshift(`Back to passing — the previous ${priorVerdicts.length} run(s) all failed.`);
  }
  return headlines;
}

/**
 * Compare `current` against prior runs for the same URL.
 *
 * `history` is oldest-first and must NOT include the current run; callers
 * save the run after building the trend so a run never trends against itself.
 */
export function buildTrend(current: Report, history: HistoryRun[]): TrendReport {
  const series = SERIES.map((def) => buildSeries(def, history, current));
  return {
    runs: history.length,
    windowFrom: history.length ? history[0].capturedAt : null,
    series,
    verdictHistory: [
      ...history.map((r) => ({ capturedAt: r.capturedAt, verdict: r.verdict })),
      { capturedAt: current.capturedAt, verdict: current.verdict },
    ],
    headlines: headlinesFor(series, history, current),
  };
}
