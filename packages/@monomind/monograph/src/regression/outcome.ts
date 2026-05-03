// Three-variant regression outcome model: Pass, Exceeded, Skipped.

import type { CountDelta } from './counts.js';

export type RegressionOutcomeKind = 'pass' | 'exceeded' | 'skipped';

export interface RegressionOutcomePass {
  kind: 'pass';
  delta: number;
  tolerance: number;
  toleranceKind: 'absolute' | 'percent';
}

export interface RegressionOutcomeExceeded {
  kind: 'exceeded';
  delta: number;
  tolerance: number;
  toleranceKind: 'absolute' | 'percent';
  exceeded: CountDelta[];
}

export interface RegressionOutcomeSkipped {
  kind: 'skipped';
  reason: string;
}

export type RegressionOutcome =
  | RegressionOutcomePass
  | RegressionOutcomeExceeded
  | RegressionOutcomeSkipped;

export function regressionOutcomeToJson(outcome: RegressionOutcome): string {
  if (outcome.kind === 'skipped') {
    return JSON.stringify({ status: 'skipped', reason: outcome.reason });
  }
  return JSON.stringify({
    status: outcome.kind,
    delta: outcome.delta,
    tolerance: outcome.tolerance,
    tolerance_kind: outcome.toleranceKind,
    exceeded: outcome.kind === 'exceeded' ? outcome.exceeded : undefined,
  });
}

export function printRegressionOutcome(outcome: RegressionOutcome): string {
  switch (outcome.kind) {
    case 'pass':
      return `✓ Regression check passed (delta=${outcome.delta}, tolerance=${outcome.tolerance})`;
    case 'exceeded':
      return [
        `✗ Regression check EXCEEDED (delta=${outcome.delta}, tolerance=${outcome.tolerance})`,
        ...outcome.exceeded.map(d => `  ${d.key}: ${d.baseline} → ${d.current} (+${d.delta})`),
      ].join('\n');
    case 'skipped':
      return `⚠ Regression check skipped: ${outcome.reason}`;
  }
}

export function makePassOutcome(
  delta: number,
  tolerance: number,
  toleranceKind: 'absolute' | 'percent' = 'absolute',
): RegressionOutcomePass {
  return { kind: 'pass', delta, tolerance, toleranceKind };
}

export function makeExceededOutcome(
  delta: number,
  tolerance: number,
  exceeded: CountDelta[],
  toleranceKind: 'absolute' | 'percent' = 'absolute',
): RegressionOutcomeExceeded {
  return { kind: 'exceeded', delta, tolerance, toleranceKind, exceeded };
}

export function makeSkippedOutcome(reason: string): RegressionOutcomeSkipped {
  return { kind: 'skipped', reason };
}
