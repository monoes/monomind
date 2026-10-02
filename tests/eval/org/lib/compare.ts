// tests/eval/org/lib/compare.ts
//
// A scenario manifest's analysis plan applied to two arms of runs (org
// sections spec, section 10): spend over every attempt, fixture success with
// its Wilson interval, cost per accepted unit pooled over the arm (failure,
// never zero, when nothing was accepted), and a paired spend difference when
// the arms have the same number of runs. A comparison resting on very few
// runs says so instead of declaring a winner.

import type { ScenarioManifest } from './manifest.js';
import { costPerAcceptedUnit, fixtureOutcome } from './metrics.js';
import { type Interval, pairedDifference, wilsonInterval } from './stats.js';

export interface ArmRun {
  /** Everything the run spent, USD, including work cut off by a stop. */
  usd: number;
  /** Accepted artifacts per manifest unit id, from the blinded review. */
  accepted: Record<string, number>;
  interventions: number;
  falseClaims: number;
}

export interface ArmSummary {
  runs: number;
  spend_total: number;
  accepted_units: number;
  completed: number;
  fixture_success: { rate: number; lo: number; hi: number };
  cost_per_accepted_unit: { value: number | null; failed: boolean };
  interventions: number;
  false_claims: number;
}

export interface Comparison {
  control: ArmSummary;
  treatment: ArmSummary;
  paired_spend_difference: Interval | null;
  inconclusive: boolean;
  notes: string[];
}

/** Below this many runs per arm no difference is concluded. */
const MIN_RUNS_PER_ARM = 3;

function summarize(manifest: ScenarioManifest, runs: ArmRun[]): ArmSummary {
  const outcomes = runs.map((r) => fixtureOutcome(manifest, r.accepted));
  const spend = runs.reduce((s, r) => s + r.usd, 0);
  const accepted = outcomes.reduce((s, o) => s + o.accepted_units, 0);
  const completed = outcomes.filter((o) => o.completed).length;
  const [lo, hi] = wilsonInterval(completed, runs.length);
  return {
    runs: runs.length,
    spend_total: spend,
    accepted_units: accepted,
    completed,
    fixture_success: { rate: runs.length ? completed / runs.length : 0, lo, hi },
    cost_per_accepted_unit: costPerAcceptedUnit(spend, accepted),
    interventions: runs.reduce((s, r) => s + r.interventions, 0),
    false_claims: runs.reduce((s, r) => s + r.falseClaims, 0),
  };
}

export function compareArms(
  manifest: ScenarioManifest,
  control: ArmRun[],
  treatment: ArmRun[],
): Comparison {
  const notes: string[] = [];
  const paired =
    control.length === treatment.length && control.length > 0
      ? pairedDifference(
          control.map((r) => r.usd),
          treatment.map((r) => r.usd),
        )
      : null;
  if (!paired) notes.push('arms have different run counts: no paired difference');
  const small = Math.min(control.length, treatment.length) < MIN_RUNS_PER_ARM;
  if (small)
    notes.push(
      `only ${control.length} and ${treatment.length} runs per arm: fewer than ${MIN_RUNS_PER_ARM}, so no difference is concluded`,
    );
  return {
    control: summarize(manifest, control),
    treatment: summarize(manifest, treatment),
    paired_spend_difference: paired,
    inconclusive: small,
    notes,
  };
}
