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
  arm: 'baseline' | 'treatment';
  tasks?: number; // tasks the lead created
  workers?: string[]; // roles other than the lead that did something
  complete?: 'achieved' | 'partial' | null;
  handoff?: { kind: string; ok: boolean; role: string }[];
  closures?: number;
  idle?: boolean;
  spendStopped?: boolean;
  usd?: number;
  units?: { unit: string; accepted: boolean | null }[];
}

function root(o: Opts) {
  const r = mkdtempSync(join(tmpdir(), 'pilot-report-'));
  const scenario = o.scenario ?? 'growth-like';
  const name = `smoke-${scenario}-phase2-p${o.n}${o.arm === 'baseline' ? 'b' : 't'}`;
  const run = join(r, '.monomind/orgs', name, 'run-1');
  mkdirSync(run, { recursive: true });
  const events: unknown[] = [
    ev('usage', 'lead', { data: { tokens: 1000, cost_usd: o.usd ?? 0.5, cache_read: 500 } }),
    ...Array.from({ length: o.tasks ?? 0 }, (_, i) =>
      ev('audit', 'lead', { reason: 'task-created', msg: `task ${i}` }),
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
      pilot: { arm: o.arm, id: 'x' },
    }),
  );
  writeFileSync(join(r, 'units.json'), JSON.stringify({ units: o.units ?? [] }));
  writeFileSync(
    join(r, 'result.json'),
    JSON.stringify({
      name,
      exit: 0,
      timedOut: false,
      seconds: 200,
      inputs: 'clean',
      realState: 'clean',
      ...(o.spendStopped === undefined ? {} : { spendStopped: o.spendStopped }),
    }),
  );
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
