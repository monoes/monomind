// tests/eval/org/pilot/report.ts
//
// The document hand-off pilot's report (org sections spec 9.2). Per trial: whether the lead
// delegated, who worked, how the org ended, the hand-off tool calls (publish, read, decide) and the
// cross-section sends refused. Per pair of arms: whether the pair is usable. A pair whose arms differ
// on delegation is confounded: a lead that does the whole job itself has no cross-section hand-off
// to measure, so such a pair says nothing about the prototype. The pilot is exploratory and cannot
// pass or fail the coordination gate; nothing here states an interval.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type TrialRow, trialRow } from '../smoke/report.js';

export interface HandoffCounts {
  publish: { ok: number; refused: number };
  read: { ok: number; refused: number };
  decide: { ok: number; refused: number };
  sendRefused: number;
  /** publish + read + decide attempts, accepted or refused. */
  total: number;
}

export interface PilotRow extends TrialRow {
  arm: 'baseline' | 'treatment';
  n: number;
  delegated: boolean;
  tasksCreated: number;
  activeWorkers: string[];
  ended: string;
  handoff: HandoffCounts;
}

const jsonLines = (p: string): any[] =>
  existsSync(p)
    ? readFileSync(p, 'utf8')
        .split('\n')
        .filter(Boolean)
        .flatMap((l) => {
          try {
            return [JSON.parse(l)];
          } catch {
            return []; // a torn final line
          }
        })
    : [];

function busOf(root: string, name: string): any[] {
  const dir = join(root, '.monomind/orgs', name);
  if (!existsSync(dir)) return [];
  const runs = readdirSync(dir)
    .filter((d) => d.startsWith('run-'))
    .sort();
  return runs.length ? jsonLines(join(dir, runs[runs.length - 1], 'bus.jsonl')) : [];
}

export function pilotRow(root: string): PilotRow {
  const base = trialRow(root);
  const trial = JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8'));
  const m = /-p(\d+)([bt])$/.exec(trial.name);
  const bus = busOf(root, trial.name);

  const complete = bus.find((e) => e.type === 'tool' && String(e.tool).endsWith('org_complete'));
  const leadId: string | undefined =
    complete?.from ?? bus.find((e) => e.reason === 'task-created')?.from ?? bus[0]?.from;
  const tasksCreated = bus.filter((e) => e.reason === 'task-created').length;
  const activeWorkers = [
    ...new Set(
      bus
        .filter((e) => (e.type === 'tool' || e.type === 'chat') && e.from && e.from !== leadId)
        .map((e) => e.from as string),
    ),
  ].sort();
  const closures = bus.filter((e) => e.reason === 'budget-exhausted').length;
  const idle = bus.some((e) => e.reason === 'idle-stop');
  const ended = complete
    ? `org_complete (${complete.data?.input?.outcome ?? 'unknown'})`
    : base.spendStopped
      ? `org spend stop ($${base.usd.toFixed(2)})`
      : [
          'no org_complete',
          closures ? `${closures} budget closure(s)` : '',
          idle ? 'idle stop' : '',
        ]
          .filter(Boolean)
          .join('; ');

  const handoff: HandoffCounts = {
    publish: { ok: 0, refused: 0 },
    read: { ok: 0, refused: 0 },
    decide: { ok: 0, refused: 0 },
    sendRefused: 0,
    total: 0,
  };
  for (const e of jsonLines(join(root, 'pilot-state/pilot-events.jsonl'))) {
    if (e.kind === 'send-refused') handoff.sendRefused++;
    else if (e.kind === 'publish' || e.kind === 'read' || e.kind === 'decide') {
      handoff[e.kind as 'publish'][e.ok ? 'ok' : 'refused']++;
      handoff.total++;
    }
  }
  return {
    ...base,
    arm: trial.pilot?.arm ?? (m?.[2] === 't' ? 'treatment' : 'baseline'),
    n: m ? Number(m[1]) : 0,
    delegated: tasksCreated > 0,
    tasksCreated,
    activeWorkers,
    ended,
    handoff,
  };
}

export interface PairReport {
  n: number;
  baseline?: PilotRow;
  treatment?: PilotRow;
  /** The arms differ on delegation: nothing can be said about the prototype from this pair. */
  confounded: boolean;
  /** The pair is missing an arm. */
  incomplete: boolean;
  /** The treatment arm never called a hand-off tool, so it never exercised the prototype. */
  treatmentUnused: boolean;
  reasons: string[];
}

export function pilotReport(rows: PilotRow[]) {
  const scenarios = [...new Set(rows.map((r) => r.scenario))].sort().map((scenario) => {
    const mine = rows.filter((r) => r.scenario === scenario);
    const pairs: PairReport[] = [...new Set(mine.map((r) => r.n))]
      .sort((a, b) => a - b)
      .map((n) => {
        const baseline = mine.find((r) => r.n === n && r.arm === 'baseline');
        const treatment = mine.find((r) => r.n === n && r.arm === 'treatment');
        const reasons: string[] = [];
        let confounded = false;
        const incomplete = !baseline || !treatment;
        if (incomplete) reasons.push(`missing the ${baseline ? 'treatment' : 'baseline'} trial`);
        if (baseline && treatment) {
          if (baseline.delegated !== treatment.delegated) {
            confounded = true;
            reasons.push(
              `the arms differ on delegation (baseline ${baseline.delegated ? `created ${baseline.tasksCreated} task(s)` : 'did not delegate'}; treatment ${treatment.delegated ? `created ${treatment.tasksCreated} task(s)` : 'did not delegate'})`,
            );
          }
          if (baseline.voided || treatment.voided) {
            confounded = true;
            reasons.push('a trial is void (its inputs or the real state changed)');
          }
        }
        return {
          n,
          baseline,
          treatment,
          confounded,
          incomplete,
          treatmentUnused: !!treatment && treatment.handoff.total === 0,
          reasons,
        };
      });
    return { scenario, pairs };
  });
  const all = scenarios.flatMap((s) => s.pairs);
  return {
    note: 'Harness-only prototype pilot: exploratory, no intervals, cannot pass or fail the coordination gate. A confounded pair says nothing about the prototype.',
    allocationUsd: rows.reduce((s, r) => s + r.allocationUsd, 0),
    spendUsd: rows.reduce((s, r) => s + r.usd, 0),
    summary: {
      pairs: all.length,
      confounded: all.filter((p) => p.confounded).length,
      incomplete: all.filter((p) => p.incomplete).length,
      usable: all.filter((p) => !p.confounded && !p.incomplete).length,
      treatmentUnused: all.filter((p) => p.treatmentUnused).length,
    },
    scenarios,
  };
}
