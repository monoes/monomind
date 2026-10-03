import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pilotReport, pilotRow } from './report.js';

let t = 1_000_000;
const ev = (type: string, from: string | undefined, extra: Record<string, unknown> = {}) => ({
  id: `e${t}`,
  ts: (t += 1000),
  org: 'o',
  run: 'r',
  type,
  ...(from ? { from } : {}),
  ...extra,
});

interface Opts {
  scenario?: string;
  n: number;
  arm: 'baseline' | 'treatment' | 'single';
  tasks?: number; // tasks the lead created
  redo?: number; // a redo of an interrupted trial of the same arm and number
  interrupted?: boolean; // killed mid-run: no result.json
  dispatched?: number; // tasks dispatched to workers by a plan graph (no `task-created` event)
  workers?: string[]; // roles other than the lead that did something
  complete?: 'achieved' | 'partial' | null;
  handoff?: { kind: string; ok: boolean; role: string }[];
  closures?: number;
  idle?: boolean;
  spendStopped?: boolean;
  usd?: number;
  units?: { unit: string; accepted: boolean | null }[];
  profile?: 'production'; // a per-trial profile override (trial id carries an S marker)
  /** The trial's real-state check found these (real-state-home.txt lines): the trial is void. */
  homeOffenders?: string[];
}

function root(o: Opts) {
  const r = mkdtempSync(join(tmpdir(), 'pilot-report-'));
  const scenario = o.scenario ?? 'growth-like';
  const name = `smoke-${scenario}-phase2-p${o.n}${{ baseline: 'b', treatment: 't', single: 's' }[o.arm]}${o.profile ? 'S' : ''}${o.redo ? `r${o.redo}` : ''}`;
  const run = join(r, '.monomind/orgs', name, 'run-1');
  mkdirSync(run, { recursive: true });
  const events: unknown[] = [
    ev('usage', 'lead', { data: { tokens: 1000, cost_usd: o.usd ?? 0.5, cache_read: 500 } }),
    ...Array.from({ length: o.tasks ?? 0 }, (_, i) =>
      ev('audit', 'lead', { reason: 'task-created', msg: `task ${i}` }),
    ),
    ...Array.from({ length: o.dispatched ?? 0 }, (_, i) =>
      ev('audit', 'lead', { reason: 'task-dispatched', msg: `task ${i}` }),
    ),
    ...(o.workers ?? []).map((w) => ev('tool', w, { tool: 'Bash' })),
    ...(o.complete
      ? [
          ev('tool', 'lead', {
            tool: 'mcp__org__org_complete',
            data: { input: { outcome: o.complete } },
          }),
        ]
      : []),
    ...Array.from({ length: o.closures ?? 0 }, () =>
      ev('audit', 'lead', { reason: 'budget-exhausted', msg: 'USD budget exhausted' }),
    ),
    ...(o.idle ? [ev('audit', undefined, { reason: 'idle-stop', msg: 'idle' })] : []),
  ];
  writeFileSync(join(run, 'bus.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
  writeFileSync(
    join(r, 'trial.json'),
    JSON.stringify({
      name,
      scenario,
      contender: 'phase2',
      allocationUsd: 8,
      runners: {},
      ...(o.profile ? { profile: o.profile } : {}),
      pilot: { arm: o.arm, id: 'x' },
    }),
  );
  writeFileSync(join(r, 'units.json'), JSON.stringify({ units: o.units ?? [] }));
  if (!o.interrupted)
    writeFileSync(
      join(r, 'result.json'),
      JSON.stringify({
        name,
        exit: 0,
        timedOut: false,
        seconds: 200,
        inputs: 'clean',
        realState: o.homeOffenders ? 'VOID' : 'clean',
        ...(o.spendStopped === undefined ? {} : { spendStopped: o.spendStopped }),
      }),
    );
  if (o.homeOffenders)
    writeFileSync(join(r, 'real-state-home.txt'), `${o.homeOffenders.join('\n')}\n`);
  if (o.handoff) {
    mkdirSync(join(r, 'pilot-state'));
    writeFileSync(
      join(r, 'pilot-state/pilot-events.jsonl'),
      `${o.handoff.map((h) => JSON.stringify({ at: 'x', ...h })).join('\n')}\n`,
    );
  }
  return r;
}

describe('pilotRow', () => {
  it('says whether the lead delegated, who worked, and how the org ended', () => {
    const r = pilotRow(
      root({ n: 1, arm: 'baseline', tasks: 3, workers: ['a', 'b', 'a'], complete: 'achieved' }),
    );
    expect(r).toMatchObject({
      arm: 'baseline',
      n: 1,
      scenario: 'growth-like',
      delegated: true,
      tasksCreated: 3,
      activeWorkers: ['a', 'b'],
      ended: 'org_complete (achieved)',
    });
  });

  it('records a lead that did everything itself as not delegating', () => {
    const r = pilotRow(root({ n: 1, arm: 'treatment', tasks: 0, complete: 'achieved' }));
    expect(r).toMatchObject({ delegated: false, tasksCreated: 0, activeWorkers: [] });
  });

  it('counts hand-off tool calls by kind, the ones refused, and the cross-section sends refused', () => {
    const r = pilotRow(
      root({
        n: 2,
        arm: 'treatment',
        tasks: 1,
        handoff: [
          { kind: 'publish', ok: false, role: 'a' },
          { kind: 'publish', ok: true, role: 'a' },
          { kind: 'read', ok: true, role: 'b' },
          { kind: 'decide', ok: true, role: 'b' },
          { kind: 'decide', ok: false, role: 'b' },
          { kind: 'send-refused', ok: false, role: 'a' },
        ],
      }),
    );
    expect(r.handoff).toEqual({
      publish: { ok: 1, refused: 1 },
      read: { ok: 1, refused: 0 },
      decide: { ok: 1, refused: 1 },
      sendRefused: 1,
      total: 5,
    });
  });

  it('has no hand-off calls in a baseline trial', () => {
    expect(pilotRow(root({ n: 1, arm: 'baseline', tasks: 1 })).handoff.total).toBe(0);
  });

  it('names a cap closure, an idle stop, or neither, as how it ended when there was no org_complete', () => {
    expect(pilotRow(root({ n: 1, arm: 'baseline', closures: 2 })).ended).toBe(
      'no org_complete; 2 budget closure(s)',
    );
    expect(pilotRow(root({ n: 1, arm: 'baseline', idle: true })).ended).toBe(
      'no org_complete; idle stop',
    );
    expect(pilotRow(root({ n: 1, arm: 'baseline' })).ended).toBe('no org_complete');
  });

  it('names an org spend stop as how it ended, unless the org completed', () => {
    const stopped = pilotRow(root({ n: 1, arm: 'baseline', usd: 12.5, spendStopped: true }));
    expect(stopped).toMatchObject({ spendStopped: true, ended: 'org spend stop ($12.50)' });
    const done = pilotRow(
      root({ n: 1, arm: 'baseline', spendStopped: true, complete: 'achieved' }),
    );
    expect(done.ended).toBe('org_complete (achieved)');
  });
});

describe('pilotReport', () => {
  const pair = (n: number, base: Partial<Opts>, treat: Partial<Opts>) => [
    pilotRow(root({ n, arm: 'baseline', ...base })),
    pilotRow(root({ n, arm: 'treatment', ...treat })),
  ];

  it('pairs the arms by trial number and flags a pair where they differ on delegation as confounded', () => {
    const rep = pilotReport([
      ...pair(1, { tasks: 3 }, { tasks: 0 }),
      ...pair(2, { tasks: 3 }, { tasks: 2 }),
    ]);
    const [p1, p2] = rep.scenarios[0].pairs;
    expect(p1).toMatchObject({ n: 1, confounded: true });
    expect(p1.reasons.join(' ')).toMatch(/delegation/);
    expect(p2).toMatchObject({ n: 2, confounded: false });
  });

  it('notes a treatment trial that never used the hand-off tools, even when not confounded', () => {
    const rep = pilotReport(pair(1, { tasks: 2 }, { tasks: 2 }));
    expect(rep.scenarios[0].pairs[0]).toMatchObject({ confounded: false, treatmentUnused: true });
  });

  it('totals spend against the pilot allocation and counts pairs by status', () => {
    const rep = pilotReport([
      ...pair(1, { tasks: 3, usd: 1 }, { tasks: 0, usd: 0.5 }),
      ...pair(
        2,
        { tasks: 1, usd: 1 },
        { tasks: 1, usd: 1, handoff: [{ kind: 'publish', ok: true, role: 'a' }] },
      ),
    ]);
    expect(rep.spendUsd).toBeCloseTo(3.5);
    expect(rep.allocationUsd).toBe(32);
    expect(rep.summary).toMatchObject({ pairs: 2, confounded: 1, usable: 1 });
  });

  it('puts a scenario with a single arm in the report as an unpaired trial, not a pair', () => {
    const rep = pilotReport([pilotRow(root({ n: 1, arm: 'baseline' }))]);
    expect(rep.scenarios[0].pairs[0].reasons.join(' ')).toMatch(/missing/);
  });
});

describe('a void trial', () => {
  it('is shown with the reason: the offending real-home entry, by name, with its birth time', () => {
    const rep = pilotReport([
      pilotRow(root({ n: 1, arm: 'baseline', tasks: 2, complete: 'achieved' })),
      pilotRow(
        root({
          n: 1,
          arm: 'treatment',
          tasks: 2,
          complete: 'achieved',
          homeOffenders: ['created  /home/u/f7.sh (file) size=0 birth=2026-10-03T16:40:12.000Z'],
        }),
      ),
    ]);
    const pair = rep.scenarios[0].pairs[0];
    expect(pair.confounded).toBe(true);
    expect(pair.reasons.join('\n')).toMatch(
      /a trial is void .*: .*real home: created {2}\/home\/u\/f7\.sh .*birth=2026-10-03T16:40:12/,
    );
    expect(pair.reasons.join('\n')).toContain('p1t'); // which trial
  });
});

describe('the single-agent arm', () => {
  const single = (n: number, o: Partial<Opts> = {}) =>
    pilotRow(root({ n, arm: 'single', complete: 'achieved', ...o }));

  it('is a row of its own: arm, trial number, and no delegation to speak of', () => {
    const r = single(2, { usd: 3 });
    expect(r).toMatchObject({
      arm: 'single',
      n: 2,
      delegated: false,
      tasksCreated: 0,
      activeWorkers: [],
    });
  });

  it('sits beside its pair without confounding it, and is counted apart', () => {
    const rows = [
      pilotRow(root({ n: 1, arm: 'baseline', tasks: 3 })),
      pilotRow(root({ n: 1, arm: 'treatment', tasks: 2 })),
      single(1, { usd: 2 }),
      single(2),
    ];
    const rep = pilotReport(rows);
    const [p1, p2] = rep.scenarios[0].pairs;
    expect(p1.single).toMatchObject({ arm: 'single', n: 1 });
    expect(p1.confounded).toBe(false); // the single arm never makes a pair confounded
    expect(p2).toMatchObject({ n: 2, incomplete: true });
    expect(p2.single).toBeDefined();
    expect(rep.summary).toMatchObject({ singles: 2 });
  });

  it('counts its spend in the total and its allocation too', () => {
    const rep = pilotReport([single(1, { usd: 2 })]);
    expect(rep.spendUsd).toBeCloseTo(2);
    expect(rep.allocationUsd).toBe(8);
  });
});

describe('delegation through a plan graph', () => {
  it('counts tasks a lead dispatched with org_plan_graph, which log no task-created event, as delegation', () => {
    const r = pilotRow(
      root({ n: 1, arm: 'baseline', dispatched: 4, workers: ['a', 'b'], complete: 'achieved' }),
    );
    expect(r).toMatchObject({
      delegated: true,
      tasksCreated: 0,
      tasksDispatched: 4,
      activeWorkers: ['a', 'b'],
    });
  });

  it('does not flag a pair confounded when both arms delegated, one by org_task and one by a plan graph', () => {
    const rep = pilotReport([
      pilotRow(root({ n: 1, arm: 'baseline', tasks: 3 })),
      pilotRow(root({ n: 1, arm: 'treatment', dispatched: 5 })),
    ]);
    expect(rep.scenarios[0].pairs[0].confounded).toBe(false);
  });

  it('still calls a lead that did everything itself not delegated', () => {
    expect(pilotRow(root({ n: 1, arm: 'treatment', complete: 'achieved' }))).toMatchObject({
      delegated: false,
      tasksDispatched: 0,
    });
  });
});

describe('a redo of an interrupted trial', () => {
  it('is read as the same arm and trial number, flagged as a redo', () => {
    const r = pilotRow(root({ n: 3, arm: 'baseline', redo: 1, tasks: 2, complete: 'achieved' }));
    expect(r).toMatchObject({ arm: 'baseline', n: 3, redo: 1, interrupted: false });
  });

  it('reads a trial with no result as interrupted', () => {
    expect(pilotRow(root({ n: 3, arm: 'baseline', interrupted: true, usd: 7.5 }))).toMatchObject({
      interrupted: true,
      usd: 7.5,
    });
  });

  it('puts the redo in its pair, lists the interrupted original apart, counts its spend, and does not call the pair confounded', () => {
    const rep = pilotReport([
      pilotRow(root({ n: 3, arm: 'baseline', interrupted: true, usd: 7.5, tasks: 2 })),
      pilotRow(root({ n: 3, arm: 'baseline', redo: 1, usd: 5, tasks: 2 })),
      pilotRow(root({ n: 3, arm: 'treatment', usd: 8, tasks: 2 })),
    ]);
    const [pair] = rep.scenarios[0].pairs;
    expect(pair.baseline).toMatchObject({ redo: 1, usd: 5 });
    expect(pair.confounded).toBe(false);
    expect(pair.reasons.join(' ')).toMatch(/redo of an interrupted trial/);
    expect(rep.interrupted.map((r: { name: string }) => r.name)).toEqual([
      'smoke-growth-like-phase2-p3b',
    ]);
    expect(rep.spendUsd).toBeCloseTo(20.5); // the interrupted attempt's spend stays in the total
    expect(rep.summary).toMatchObject({ interrupted: 1, usable: 1 });
  });
});

describe('trials of one scenario on two profiles', () => {
  it('reads the profile (Haiku when the record has none) and the S marker as the same arm and number', () => {
    expect(pilotRow(root({ n: 2, arm: 'single', tasks: 0 }))).toMatchObject({ profile: 'haiku' });
    expect(
      pilotRow(root({ n: 2, arm: 'treatment', profile: 'production', tasks: 2 })),
    ).toMatchObject({ arm: 'treatment', n: 2, profile: 'production' });
  });

  it('never pairs trials across profiles: one group per scenario and profile', () => {
    const sc = 'dev-feature-qa-revise';
    const rep = pilotReport([
      pilotRow(root({ scenario: sc, n: 1, arm: 'single', usd: 0.2 })),
      pilotRow(root({ scenario: sc, n: 1, arm: 'baseline', profile: 'production', tasks: 2 })),
      pilotRow(root({ scenario: sc, n: 1, arm: 'treatment', profile: 'production', tasks: 2 })),
      pilotRow(root({ scenario: sc, n: 1, arm: 'single', profile: 'production', usd: 0.5 })),
    ]);
    expect(rep.scenarios.map((s: any) => [s.scenario, s.profile])).toEqual([
      [sc, 'haiku'],
      [sc, 'production'],
    ]);
    const [haiku, prod] = rep.scenarios;
    expect(haiku.pairs[0].single?.usd).toBe(0.2);
    expect(haiku.pairs[0].baseline).toBeUndefined();
    expect(prod.pairs[0].single?.usd).toBe(0.5);
    expect(prod.pairs[0].baseline).toBeDefined();
  });
});
