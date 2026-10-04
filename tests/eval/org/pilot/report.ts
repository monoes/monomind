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
// @ts-expect-error plain .mjs module
import { trialView } from './runtime-view.mjs';

export interface HandoffCounts {
  publish: { ok: number; refused: number };
  read: { ok: number; refused: number };
  decide: { ok: number; refused: number };
  sendRefused: number;
  /** publish + read + decide attempts, accepted or refused. */
  total: number;
  /** pilot__doc_check calls (variant v2 only; not part of `total`). */
  check?: { ok: number; refused: number };
  /** Messages the producer relay sent (to the producer and the lead's copy; variant v2 only). */
  relays?: number;
}

export interface PilotRow extends TrialRow {
  arm: 'baseline' | 'treatment' | 'single';
  /** The trial's profile (haiku by default); trials on different profiles are never paired. */
  profile: string;
  n: number;
  /** The declared variant of the arm this trial ran (parallel-sweep-3's v2), which is never paired with the plain arm. */
  variant?: string;
  /** The nth redo of an interrupted trial of this arm and number. */
  redo?: number;
  /** Set on a trial the runtime switch ran (the real document tools, not the harness store): its hand-off counts are
   *  read from the runtime's records (runtime-view.mjs), and it has no harness fault record. */
  handoffLayer?: 'runtime';
  /** Killed mid-run: it has no result. Listed apart, never paired; its spend still counts. */
  interrupted: boolean;
  delegated: boolean;
  tasksCreated: number;
  /** Tasks a lead put in play with org_plan_graph: logged as dispatched, with no task-created event. */
  tasksDispatched: number;
  activeWorkers: string[];
  ended: string;
  handoff: HandoffCounts;
  /** Hand-off calls per role (publish, read, decide), accepted or refused: the documents each consumer read and decided. */
  handoffByRole: Record<
    string,
    Partial<Record<'publish' | 'read' | 'decide', { ok: number; refused: number }>>
  >;
  /** The decision measures a kit with a hand-off check leaves in units.json under `handoff` (parallel-sweep-3,
   *  treatment): faults injected, caught, missed, false rejects, republish cycles, final accepted documents, whether
   *  the synthesis used a corrupted document, time to the synthesis, cost split. Absent for every other trial. */
  decisions?: Record<string, any>;
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
  // p<n><arm>[S][r<redo>]: S marks a per-trial profile override (the production profile on a Haiku-default pilot)
  const m = /-p(\d+)([bts])S?(?:r(\d+))?(?:-[a-z0-9]+)?$/.exec(trial.name);
  const bus = busOf(root, trial.name);

  const complete = bus.find((e) => e.type === 'tool' && String(e.tool).endsWith('org_complete'));
  const leadId: string | undefined =
    complete?.from ??
    bus.find((e) => e.reason === 'task-created' || e.reason === 'task-dispatched')?.from ??
    bus[0]?.from;
  const tasksCreated = bus.filter((e) => e.reason === 'task-created').length;
  const tasksDispatched = bus.filter((e) => e.reason === 'task-dispatched').length;
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
  const handoffByRole: PilotRow['handoffByRole'] = {};
  const view = trialView(root);
  for (const e of view.events as any[]) {
    if (e.kind === 'send-refused') handoff.sendRefused++;
    else if (e.kind === 'publish' || e.kind === 'read' || e.kind === 'decide') {
      handoff[e.kind as 'publish'][e.ok ? 'ok' : 'refused']++;
      handoff.total++;
      const mine = ((handoffByRole[e.role] ??= {})[e.kind as 'publish'] ??= { ok: 0, refused: 0 });
      mine[e.ok ? 'ok' : 'refused']++;
    } else if (e.kind === 'check') {
      // variant v2: doc_check calls, counted apart from the three original tools so v1 totals do not move
      (handoff.check ??= { ok: 0, refused: 0 })[e.ok ? 'ok' : 'refused']++;
    } else if (e.kind === 'relay' && e.ok) handoff.relays = (handoff.relays ?? 0) + 1;
  }
  const unitsFile = join(root, 'units.json');
  const decisions = existsSync(unitsFile)
    ? JSON.parse(readFileSync(unitsFile, 'utf8')).handoff
    : undefined;
  return {
    ...base,
    arm:
      trial.pilot?.arm ??
      ({ b: 'baseline', t: 'treatment', s: 'single' } as const)[(m?.[2] ?? 'b') as 'b'],
    profile: trial.profile ?? 'haiku',
    n: m ? Number(m[1]) : 0,
    ...(trial.pilot?.variant?.id ? { variant: trial.pilot.variant.id } : {}),
    ...(view.source === 'runtime' ? { handoffLayer: 'runtime' as const } : {}),
    ...(m?.[3] ? { redo: Number(m[3]) } : {}),
    interrupted: !existsSync(join(root, 'result.json')),
    delegated: tasksCreated > 0 || tasksDispatched > 0,
    tasksCreated,
    tasksDispatched,
    activeWorkers,
    ended,
    handoff,
    handoffByRole,
    ...(decisions?.present ? { decisions } : {}),
  };
}

export interface PairReport {
  n: number;
  baseline?: PilotRow;
  treatment?: PilotRow;
  /** The v2 variant of the treatment arm of this trial number (its own measures; never part of the pair). */
  treatmentV2?: PilotRow;
  /** The same variant run on the runtime document tools (the `v2r` switch): its own measures, never part of the pair. */
  treatmentV2r?: PilotRow;
  /** The single-agent arm of the same trial number, when the scenario has one. It never confounds a pair. */
  single?: PilotRow;
  /** The arms differ on delegation: nothing can be said about the prototype from this pair. */
  confounded: boolean;
  /** The pair is missing an arm. */
  incomplete: boolean;
  /** The treatment arm never called a hand-off tool, so it never exercised the prototype. */
  treatmentUnused: boolean;
  reasons: string[];
}

export function pilotReport(rows: PilotRow[]) {
  const groups = [...new Set(rows.map((r) => `${r.scenario}\u0000${r.profile}`))].sort();
  const scenarios = groups.map((group) => {
    const [scenario, profile] = group.split('\u0000');
    const mine = rows.filter(
      (r) => r.scenario === scenario && r.profile === profile && !r.interrupted,
    );
    const pairs: PairReport[] = [...new Set(mine.map((r) => r.n))]
      .sort((a, b) => a - b)
      .map((n) => {
        const baseline = mine.find((r) => r.n === n && r.arm === 'baseline');
        const treatment = mine.find((r) => r.n === n && r.arm === 'treatment' && !r.variant);
        const treatmentV2 = mine.find(
          (r) => r.n === n && r.arm === 'treatment' && r.variant === 'v2',
        );
        const treatmentV2r = mine.find(
          (r) => r.n === n && r.arm === 'treatment' && r.variant === 'v2r',
        );
        const single = mine.find((r) => r.n === n && r.arm === 'single');
        const reasons: string[] = [];
        let confounded = false;
        const incomplete = !baseline || !treatment;
        const variantOnly = treatmentV2 ?? treatmentV2r;
        if (incomplete && !(variantOnly && !treatment && !baseline))
          reasons.push(`missing the ${baseline ? 'treatment' : 'baseline'} trial`);
        else if (incomplete)
          reasons.push(
            `a variant trial only (${variantOnly?.variant}): no baseline or plain treatment trial of this number`,
          );
        if (baseline && treatment) {
          if (baseline.delegated !== treatment.delegated) {
            confounded = true;
            reasons.push(
              `the arms differ on delegation (baseline ${baseline.delegated ? `put ${baseline.tasksCreated + baseline.tasksDispatched} task(s) in play` : 'did not delegate'}; treatment ${treatment.delegated ? `put ${treatment.tasksCreated + treatment.tasksDispatched} task(s) in play` : 'did not delegate'})`,
            );
          }
          if (baseline.voided || treatment.voided) {
            confounded = true;
            reasons.push(
              `a trial is void (its inputs or the real state changed): ${[baseline, treatment]
                .filter((r) => r.voided)
                .map((r) => `${r.name}: ${r.voidReasons.join('; ')}`)
                .join(' | ')}`,
            );
          }
        }
        for (const r of [baseline, treatment, single])
          if (r?.redo)
            reasons.push(
              `${r.arm} is a redo of an interrupted trial (${r.name.replace(/r\d+$/, '')}); the interrupted attempt's spend stays in the total`,
            );
        return {
          n,
          baseline,
          treatment,
          ...(treatmentV2 ? { treatmentV2 } : {}),
          ...(treatmentV2r ? { treatmentV2r } : {}),
          single,
          confounded,
          incomplete,
          treatmentUnused: !!treatment && treatment.handoff.total === 0,
          reasons,
        };
      });
    return { scenario, profile, pairs };
  });
  const all = scenarios.flatMap((s) => s.pairs);
  return {
    note: 'Harness-only prototype pilot: exploratory, no intervals, cannot pass or fail the coordination gate. A confounded pair says nothing about the prototype.',
    allocationUsd: rows.reduce((s, r) => s + r.allocationUsd, 0),
    spendUsd: rows.reduce((s, r) => s + r.usd, 0),
    /** Trials killed mid-run: no result, never paired, spend counted. */
    interrupted: rows.filter((r) => r.interrupted),
    summary: {
      interrupted: rows.filter((r) => r.interrupted).length,
      pairs: all.length,
      confounded: all.filter((p) => p.confounded).length,
      incomplete: all.filter((p) => p.incomplete).length,
      usable: all.filter((p) => !p.confounded && !p.incomplete).length,
      treatmentUnused: all.filter((p) => p.treatmentUnused).length,
      singles: all.filter((p) => p.single).length,
    },
    scenarios,
  };
}
