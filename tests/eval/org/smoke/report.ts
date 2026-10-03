// tests/eval/org/smoke/report.ts
//
// The smoke tier's report (spec 10): one row per finished trial, and per
// scenario a comparison of the two contenders. One trial per contender detects
// regressions only; it never names a winner and states no interval.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScenarioManifest } from '../lib/manifest.js';
import { costPerAcceptedUnit, fixtureOutcome, runMetrics } from '../lib/metrics.js';

const here = dirname(fileURLToPath(import.meta.url));
const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const manifestFor = (scenario: string): ScenarioManifest =>
  json(join(here, '../manifests', `${scenario}.json`));

export interface TrialRow {
  name: string;
  scenario: string;
  contender: string;
  seconds: number;
  timedOut: boolean;
  /** The harness's org-wide USD stop (spend-stop.mjs) ended the run. */
  spendStopped: boolean;
  voided: boolean;
  /** Why it is void, from the trial's own files: what changed in the inputs or the real state (empty when not void). */
  voidReasons: string[];
  accepted: Record<string, number>;
  pendingReview: string[];
  missing: string[];
  completed: boolean;
  coverage: number;
  critical: string[];
  usd: number;
  usdComplete: boolean;
  tokens: number;
  cacheReadShare: number;
  crashes: number;
  rotations: number;
  humanQuestions: number;
  budgetClosures: number;
  allocationUsd: number;
  /** The runner and model each role ran on, from the trial record. */
  runners: Record<string, { runtime: string; model?: string }>;
  /** Some role ran on a runner that reports no USD, so `usd` is a lower bound and tokens are the cost. */
  unpriced: boolean;
  costPerAccepted: { value: number | null; failed: boolean };
}

function latestRun(root: string, name: string): string {
  const dir = join(root, '.monomind/orgs', name);
  const runs = existsSync(dir)
    ? readdirSync(dir)
        .filter((d) => d.startsWith('run-'))
        .sort()
    : [];
  return runs.length ? join(dir, runs[runs.length - 1]) : dir;
}

const lines = (p: string): string[] =>
  existsSync(p)
    ? readFileSync(p, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
    : [];

/** What made a trial void, in words: run-trial.sh's result plus the files it left beside it. */
export function voidReasons(
  root: string,
  result: { inputs?: string; realState?: string },
): string[] {
  const out: string[] = [];
  if (result.inputs === 'VOID')
    out.push('the immutable inputs changed (guard-before.sha256 differs from guard-after.sha256)');
  if (result.realState === 'VOID') {
    for (const l of lines(join(root, 'real-state-home.txt'))) out.push(`real home: ${l}`);
    for (const l of lines(join(root, 'real-state-leaks.txt'))) out.push(`real ~/.monomind: ${l}`);
    if (!out.some((r) => r.startsWith('real ')))
      out.push('the real ~/.monomind org, broker or operator listing changed (real-state-*.json)');
  }
  return out;
}

export function trialRow(root: string): TrialRow {
  const trial = json(join(root, 'trial.json'));
  const manifest = manifestFor(trial.scenario);
  const result = existsSync(join(root, 'result.json')) ? json(join(root, 'result.json')) : {};
  const units: { unit: string; accepted: boolean | null; critical?: string[] }[] = existsSync(
    join(root, 'units.json'),
  )
    ? json(join(root, 'units.json')).units
    : [];
  const accepted: Record<string, number> = {};
  for (const u of units) if (u.accepted === true) accepted[u.unit] = (accepted[u.unit] ?? 0) + 1;
  // A unit counts at most its required number: splitting an artifact adds nothing.
  for (const u of manifest.units)
    if (u.id in accepted) accepted[u.id] = Math.min(accepted[u.id], u.count);
  const outcome = fixtureOutcome(manifest, accepted);
  const runDir = latestRun(root, trial.name);
  const m = runMetrics(runDir);
  const bus = existsSync(join(runDir, 'bus.jsonl'))
    ? readFileSync(join(runDir, 'bus.jsonl'), 'utf8')
    : '';
  const rotations = bus.split('\n').filter((l) => l.includes('"session-rotated"')).length;
  return {
    name: trial.name,
    scenario: trial.scenario,
    contender: trial.contender,
    seconds: result.seconds ?? 0,
    timedOut: result.timedOut ?? false,
    spendStopped: result.spendStopped ?? false,
    voided: result.inputs === 'VOID' || result.realState === 'VOID',
    voidReasons: voidReasons(root, result),
    accepted,
    pendingReview: [...new Set(units.filter((u) => u.accepted === null).map((u) => u.unit))],
    missing: outcome.missing,
    completed: outcome.completed,
    coverage: outcome.coverage,
    critical: units.flatMap((u) => u.critical ?? []),
    usd: m.usd_reported,
    usdComplete: m.cost_complete,
    tokens: m.tokens_total,
    cacheReadShare: m.cache_read_share,
    crashes: m.crashes,
    rotations,
    humanQuestions: m.human_questions,
    budgetClosures: m.budget_closures.usd + m.budget_closures.tokens,
    allocationUsd: trial.allocationUsd ?? 8,
    runners: trial.runners ?? {},
    unpriced: Object.values<{ runtime: string }>(trial.runners ?? {}).some(
      (r) => r.runtime !== 'claude',
    ),
    costPerAccepted: costPerAcceptedUnit(m.usd_reported, outcome.accepted_units),
  };
}

export function smokeReport(rows: TrialRow[]) {
  const scenarios = [...new Set(rows.map((r) => r.scenario))].sort().map((scenario) => {
    const cb = rows.find((r) => r.scenario === scenario && r.contender === 'current-best');
    const p2 = rows.find((r) => r.scenario === scenario && r.contender === 'phase2');
    const regressions: string[] = [];
    if (!cb || !p2) regressions.push('missing a contender: nothing to compare');
    else if (cb.voided || p2.voided)
      regressions.push(
        `a trial is void (its inputs or the real state changed): nothing to compare. ${[cb, p2]
          .filter((r) => r.voided)
          .map((r) => `${r.name}: ${r.voidReasons.join('; ')}`)
          .join(' | ')}`,
      );
    else {
      const units = (r: TrialRow) => Object.values(r.accepted).reduce((a, b) => a + b, 0);
      if (units(p2) < units(cb))
        regressions.push(`phase2 accepted fewer units (${units(p2)} vs ${units(cb)})`);
      if (p2.critical.length > cb.critical.length)
        regressions.push(
          `phase2 has more critical failures (${p2.critical.length} vs ${cb.critical.length})`,
        );
      if (p2.usd > 1.5 * cb.usd && units(p2) <= units(cb))
        regressions.push(
          `phase2 spent over 1.5x for no more accepted units ($${p2.usd.toFixed(2)} vs $${cb.usd.toFixed(2)})`,
        );
    }
    return { scenario, currentBest: cb, phase2: p2, regressions };
  });
  return {
    note: 'One trial per contender detects regressions only; it names no winner and states no interval.',
    allocationUsd: rows.reduce((s, r) => s + r.allocationUsd, 0),
    spendUsd: rows.reduce((s, r) => s + r.usd, 0),
    scenarios,
  };
}
