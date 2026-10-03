// The staged-plan gate of parallel-sweep-2 (stage-gate.mjs, called by run-all.sh): stage 2 (the team arms) only when
// the stage 1 single trial delivered fewer than 30 of the 33 units, a stop at 30 or more, no auto-continue in the
// 26 to 29 band, stage 3 only on a further owner approval. No model is called: the gate only reads files.
// @ts-nocheck: plain .mjs module
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decide, stageOneDelivered } from './stage-gate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pilot = JSON.parse(readFileSync(join(here, 'parallel-sweep-2.pilot.json'), 'utf8'));
const scratch = () => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'gate-'));
const d = (arm: string, n: number, delivered?: number, env = {}) =>
  decide({ pilot, arm, n, delivered, env });

describe('the staged plan as recorded', () => {
  it('stage 1 is single x1; stage 2 baseline and treatment x1 only if single misses; stage 3 needs a further approval', () => {
    const [s1, s2, s3] = pilot.staged_plan.stages;
    expect(s1.trials).toEqual([{ arm: 'single', n: 1 }]);
    expect(s2.trials).toEqual([
      { arm: 'baseline', n: 1 },
      { arm: 'treatment', n: 1 },
    ]);
    expect(s2.gate).toMatch(/fewer than 30 of the 33 units/);
    expect(s3.gate).toMatch(/further owner approval/);
    expect([s1.soft_cap_usd, s2.soft_cap_usd, s2.cumulative_soft_cap_usd, s3.soft_cap_usd]).toEqual(
      [8, 75, 83, 120],
    );
    expect(pilot.staged_plan.units_total).toBe(33);
    expect(pilot.stop_rule.thresholds).toEqual({
      stop_at_or_above: 30,
      auto_continue_at_or_below: 25,
      inconclusive_band: [26, 29],
      of: 33,
    });
    expect(pilot.stop_rule.team_arms_run_only_if).toMatch(/fewer than 30/);
    expect(pilot.declared_changes.find((c: any) => c.id === 'staged-plan').what).toMatch(
      /ONLY if single delivers fewer than 30/,
    );
  });
});

describe('decide', () => {
  it('stage 1 (single x1) is always allowed', () => {
    expect(d('single', 1).allowed).toBe(true);
  });
  it('stage 2 is refused until stage 1 has a result', () => {
    expect(d('baseline', 1)).toMatchObject({ allowed: false });
    expect(d('baseline', 1).reason).toMatch(/stage 1 single trial first/);
  });
  it('single at 30 or more of 33 stops the pilot: no team arm, the design does not need a team', () => {
    for (const n of [30, 31, 33])
      for (const arm of ['baseline', 'treatment']) {
        const r = d(arm, 1, n);
        expect(r.allowed).toBe(false);
        expect(r.reason).toMatch(/STOP.*does not need a team/);
      }
  });
  it('single at 25 or fewer goes on to stage 2 (baseline and treatment x1)', () => {
    for (const n of [0, 22, 25])
      for (const arm of ['baseline', 'treatment']) expect(d(arm, 1, n).allowed).toBe(true);
  });
  it('single at 26 to 29 is inconclusive: not auto-continued, only with the owner decision', () => {
    for (const n of [26, 29]) {
      expect(d('baseline', 1, n)).toMatchObject({ allowed: false });
      expect(d('baseline', 1, n).reason).toMatch(/inconclusive band 26 to 29.*not auto-continued/);
      expect(d('treatment', 1, n, { PILOT_OWNER_DECISION: 'run the team arms' }).allowed).toBe(
        true,
      );
    }
  });
  it('every later trial (stage 3) needs a further owner approval, whatever stage 1 said', () => {
    for (const [arm, n] of [
      ['single', 2],
      ['baseline', 2],
      ['treatment', 3],
    ] as const) {
      expect(d(arm, n, 10).allowed).toBe(false);
      expect(d(arm, n, 10, { PILOT_STAGE3_APPROVED: 'yes' }).allowed).toBe(true);
    }
  });
  it('a pilot without a staged plan is never gated', () => {
    expect(decide({ pilot: { arms: [] }, arm: 'baseline', n: 3 }).allowed).toBe(true);
  });
});

describe('stageOneDelivered and the command line', () => {
  const trial = (base: string, name: string, units: object) => {
    mkdirSync(join(base, 'trials', name), { recursive: true });
    writeFileSync(join(base, 'trials', name, 'units.json'), JSON.stringify(units));
  };
  it('reads the delivered count the kit leaves in units.json; a redo of the trial replaces the first', () => {
    const base = scratch();
    expect(stageOneDelivered(base, 'parallel-sweep-2')).toBeUndefined();
    trial(base, 'smoke-parallel-sweep-2-single-p1s', { units: [], delivered: 12 });
    expect(stageOneDelivered(base, 'parallel-sweep-2')).toBe(12);
    trial(base, 'smoke-parallel-sweep-2-single-p1sr1', { units: [], delivered: 27 });
    trial(base, 'smoke-parallel-sweep-2-phase2-p1b', { units: [], delivered: 33 }); // another arm: ignored
    expect(stageOneDelivered(base, 'parallel-sweep-2')).toBe(27);
  });
  const gate = (base: string, arm: string, n: number, env = {}) =>
    spawnSync('node', [join(here, 'stage-gate.mjs'), 'parallel-sweep-2', base, arm, String(n)], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, ...env },
    });
  it('exits 0 or 1 with the reason on stdout', () => {
    const base = scratch();
    expect(gate(base, 'single', 1).status).toBe(0);
    expect(gate(base, 'treatment', 1).status).toBe(1);
    trial(base, 'smoke-parallel-sweep-2-single-p1s', { units: [], delivered: 20 });
    expect(gate(base, 'treatment', 1).status).toBe(0);
    trial(base, 'smoke-parallel-sweep-2-single-p1sr1', { units: [], delivered: 31 });
    const r = gate(base, 'baseline', 1);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/STOP/);
  });
});

describe('run-all.sh (dry: nothing is prepared or run)', () => {
  const runAll = (base: string, only: string) =>
    spawnSync('bash', [join(here, 'run-all.sh'), base, '/nonexistent/cli.js'], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        PILOT_ONLY: only,
        TMPDIR: process.env.TMPDIR,
      },
    });
  it('parses PILOT_ONLY for a parallel-sweep-2 single trial and gets as far as the inputs check', () => {
    const base = scratch();
    const r = runAll(base, 'parallel-sweep-2:single:1:0');
    expect(r.status).toBe(3);
    expect(readFileSync(join(base, 'pilot-run-all.log'), 'utf8')).toMatch(
      /no inputs for parallel-sweep-2/,
    );
  });
  it('refuses a stage 2 trial before stage 1 has a result, and a stage 3 trial without approval, before preparing anything', () => {
    const base = scratch();
    mkdirSync(join(base, 'inputs', 'parallel-sweep-2'), { recursive: true });
    for (const spec of ['parallel-sweep-2:baseline:1:0', 'parallel-sweep-2:single:2:0']) {
      const r = runAll(base, spec);
      expect(r.status).toBe(6);
    }
    const log = readFileSync(join(base, 'pilot-run-all.log'), 'utf8');
    expect(log).toMatch(/GATE refused: parallel-sweep-2 baseline 1/);
    expect(log).toMatch(/GATE refused: parallel-sweep-2 single 2/);
    expect(() => readFileSync(join(base, 'trials'))).toThrow(); // nothing was prepared
  });
});
