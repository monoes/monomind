import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { smokeReport, trialRow } from './report.js';

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

function root(opts: {
  scenario: string;
  contender: string;
  units: { unit: string; accepted: boolean | null; critical?: string[] }[];
  usd?: number;
  rotations?: number;
  integrity?: string;
  timedOut?: boolean;
}) {
  const r = mkdtempSync(join(tmpdir(), 'smoke-report-'));
  const name = `smoke-${opts.scenario}-${opts.contender}-1`;
  const run = join(r, '.monomind/orgs', name, 'run-1');
  mkdirSync(run, { recursive: true });
  const events = [
    ev('usage', 'lead', { data: { tokens: 1000, cost_usd: opts.usd ?? 1, cache_read: 500 } }),
    ...Array.from({ length: opts.rotations ?? 0 }, () =>
      ev('audit', 'steward', { reason: 'session-rotated', data: { role: 'steward' } }),
    ),
  ];
  writeFileSync(join(run, 'bus.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
  writeFileSync(
    join(r, 'trial.json'),
    JSON.stringify({
      name,
      scenario: opts.scenario,
      contender: opts.contender,
      trial: '1',
      allocationUsd: 8,
    }),
  );
  writeFileSync(join(r, 'units.json'), JSON.stringify({ units: opts.units }));
  writeFileSync(
    join(r, 'result.json'),
    JSON.stringify({
      name,
      exit: 0,
      timedOut: opts.timedOut ?? false,
      seconds: 600,
      inputs: opts.integrity ?? 'clean',
    }),
  );
  return r;
}

const both = [
  { unit: 'report', accepted: true },
  { unit: 'source-ledger', accepted: true },
];

describe('trialRow', () => {
  it('counts accepted units against the committed manifest, with spend, tokens, rotations and cache share', () => {
    const row = trialRow(
      root({
        scenario: 'research-report',
        contender: 'phase2',
        units: both,
        usd: 1.5,
        rotations: 2,
      }),
    );
    expect(row).toMatchObject({
      scenario: 'research-report',
      contender: 'phase2',
      completed: true,
      coverage: 1,
      usd: 1.5,
      tokens: 1000,
      rotations: 2,
      voided: false,
      timedOut: false,
    });
    expect(row.cacheReadShare).toBeCloseTo(0.5);
    expect(row.costPerAccepted).toEqual({ value: 0.75, failed: false });
  });

  it('counts only machine-accepted units; one awaiting review is listed, not counted', () => {
    const row = trialRow(
      root({
        scenario: 'research-report',
        contender: 'phase2',
        units: [
          { unit: 'report', accepted: true },
          { unit: 'source-ledger', accepted: null },
        ],
      }),
    );
    expect(row).toMatchObject({
      completed: false,
      missing: ['source-ledger'],
      pendingReview: ['source-ledger'],
    });
  });

  it('caps a unit at its required count and keeps critical failures', () => {
    const units = [
      ...Array.from({ length: 14 }, () => ({ unit: 'ticket-answer', accepted: true })),
      { unit: 'handoff-notes', accepted: true, critical: ['a ticket dropped'] },
    ];
    const row = trialRow(root({ scenario: 'sparse-dispatch', contender: 'phase2', units }));
    expect(row.accepted['ticket-answer']).toBe(12);
    expect(row.critical).toEqual(['a ticket dropped']);
  });

  it('marks a trial whose inputs changed void', () => {
    expect(
      trialRow(
        root({ scenario: 'research-report', contender: 'phase2', units: both, integrity: 'VOID' }),
      ).voided,
    ).toBe(true);
  });
});

describe('smokeReport', () => {
  const pair = (scenario: string, cb: object, p2: object) => [
    trialRow(root({ scenario, contender: 'current-best', units: both, ...cb })),
    trialRow(root({ scenario, contender: 'phase2', units: both, ...p2 })),
  ];

  it('flags no regression when phase2 completes as much, with no more critical failures, at no more than 1.5x the spend', () => {
    const rep = smokeReport(pair('research-report', { usd: 2 }, { usd: 2.5 }));
    expect(rep.scenarios[0].regressions).toEqual([]);
    expect(rep.note).toMatch(/regressions only/i);
  });

  it('flags each kind of regression', () => {
    const rows = [
      trialRow(
        root({ scenario: 'research-report', contender: 'current-best', units: both, usd: 1 }),
      ),
      trialRow(
        root({
          scenario: 'research-report',
          contender: 'phase2',
          units: [{ unit: 'report', accepted: true }],
          usd: 3,
        }),
      ),
    ];
    expect(smokeReport(rows).scenarios[0].regressions).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/fewer units/),
        expect.stringMatching(/1\.5x/),
      ]),
    );
    const crit = [
      trialRow(root({ scenario: 'research-report', contender: 'current-best', units: both })),
      trialRow(
        root({
          scenario: 'research-report',
          contender: 'phase2',
          units: [
            { unit: 'report', accepted: true, critical: ['fabricated'] },
            { unit: 'source-ledger', accepted: true },
          ],
        }),
      ),
    ];
    expect(smokeReport(crit).scenarios[0].regressions).toEqual([expect.stringMatching(/critical/)]);
  });

  it('refuses to compare when a trial is void, and totals spend against the allocation', () => {
    const rep = smokeReport(pair('research-report', { integrity: 'VOID' }, { usd: 2 }));
    expect(rep.scenarios[0].regressions).toEqual([expect.stringMatching(/void/)]);
    expect(rep.spendUsd).toBeCloseTo(3);
    expect(rep.allocationUsd).toBe(16);
  });

  it('reports a scenario that has only one contender as incomplete', () => {
    const rep = smokeReport([
      trialRow(root({ scenario: 'research-report', contender: 'phase2', units: both })),
    ]);
    expect(rep.scenarios[0].regressions).toEqual([expect.stringMatching(/missing a contender/)]);
  });
});
