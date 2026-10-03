// The mechanism gate of parallel-sweep-3 (stage-gate.mjs, gate_kind 'handoff-read', called by run-all.sh): stage 1 is one
// treatment trial; stage 2 (a second treatment trial, the baseline control) only if, in that trial, the synthesiser made
// at least one successful doc_read call; 0 reads means the mechanism failed and nothing more runs; stage 3 needs approval.
// No model is called: the gate only reads files.
// @ts-nocheck: plain .mjs module
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decide, stageOneReads } from './stage-gate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pilot = JSON.parse(readFileSync(join(here, 'parallel-sweep-3.pilot.json'), 'utf8'));
const scratch = () => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'gate3-'));
const d = (arm: string, n: number, reads?: number, env = {}) =>
  decide({ pilot, arm, n, reads, env });

/** A finished stage 1 treatment trial whose event log holds these events. */
const trial = (base: string, name: string, events?: object[], finished = true) => {
  const dir = join(base, 'trials', name);
  mkdirSync(join(dir, 'pilot-state'), { recursive: true });
  if (finished) writeFileSync(join(dir, 'result.json'), '{}');
  if (events)
    writeFileSync(
      join(dir, 'pilot-state/pilot-events.jsonl'),
      `${events.map((e) => JSON.stringify(e)).join('\n')}\n`,
    );
};
const read = (role: string, ok = true) => ({ kind: 'read', role, ok, doc: 'module-sheets-w1' });
const NAME = 'smoke-parallel-sweep-3-phase2-p1t';

describe('decide: stage 1, stage 2, stage 3', () => {
  it('stage 1 (treatment x1) always runs first, whatever has been read', () => {
    expect(d('treatment', 1, undefined).allowed).toBe(true);
    expect(d('treatment', 1, 0).allowed).toBe(true);
  });

  it('stage 2 (treatment x2, baseline x1) needs the stage 1 result, and at least one synthesiser read in it', () => {
    for (const [arm, n] of [
      ['treatment', 2],
      ['baseline', 1],
    ] as const) {
      expect(d(arm, n, undefined)).toMatchObject({
        allowed: false,
        reason: expect.stringMatching(/needs the stage 1 treatment trial first/),
      });
      const stop = d(arm, n, 0);
      expect(stop.allowed).toBe(false);
      expect(stop.reason).toMatch(/STOP: the synthesiser made 0 successful doc_read calls/);
      expect(stop.reason).toMatch(/the mechanism failed/);
      expect(d(arm, n, 1).allowed).toBe(true);
      expect(d(arm, n, 12).reason).toMatch(/12 successful doc_read calls/);
    }
  });

  it('stage 3 (anything else) needs PILOT_STAGE3_APPROVED=yes, even after a passed gate; no variant exists', () => {
    for (const [arm, n] of [
      ['treatment', 3],
      ['baseline', 2],
      ['single', 1],
    ] as const) {
      expect(d(arm, n, 9).allowed).toBe(false);
      expect(d(arm, n, 9, { PILOT_STAGE3_APPROVED: 'yes' }).allowed).toBe(true);
    }
    expect(decide({ pilot, arm: 'treatment', n: 1, variant: 'd480', env: {} }).allowed).toBe(false);
  });
});

describe("stageOneReads reads the synthesiser's successful doc_read calls from the stage 1 trial's event log", () => {
  it("counts only the synthesiser's ok reads, not other roles', refused reads, publishes or decisions", () => {
    const base = scratch();
    expect(stageOneReads(base, 'parallel-sweep-3')).toBeUndefined();
    trial(base, NAME, [
      read('synthesiser'),
      read('synthesiser'),
      read('synthesiser', false),
      read('worker-1'),
      { kind: 'publish', role: 'worker-1', ok: true },
      { kind: 'decide', role: 'synthesiser', ok: true },
    ]);
    expect(stageOneReads(base, 'parallel-sweep-3')).toBe(2);
  });

  it('a finished trial with no event log, or only publishes, counts 0; an unfinished one is not a result; a redo replaces the first', () => {
    const base = scratch();
    trial(base, NAME, undefined, false);
    expect(stageOneReads(base, 'parallel-sweep-3')).toBeUndefined(); // no result.json: interrupted
    trial(base, NAME, undefined, true);
    expect(stageOneReads(base, 'parallel-sweep-3')).toBe(0);
    trial(base, `${NAME}r1`, [read('synthesiser')]);
    expect(stageOneReads(base, 'parallel-sweep-3')).toBe(1);
    trial(base, 'smoke-parallel-sweep-3-phase2-p2t', [read('synthesiser'), read('synthesiser')]); // trial 2 is not stage 1
    trial(base, 'smoke-parallel-sweep-2-phase2-p1t', [read('synthesiser')]); // another scenario
    expect(stageOneReads(base, 'parallel-sweep-3')).toBe(1);
  });
});

describe('the command line and run-all.sh refuse before preparing anything', () => {
  const gate = (base: string, arm: string, n: number, env = {}) =>
    spawnSync('node', [join(here, 'stage-gate.mjs'), 'parallel-sweep-3', base, arm, String(n)], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, ...env },
    });
  it('exits 0 or 1 with the reason on stdout, following the stage 1 event log', () => {
    const base = scratch();
    expect(gate(base, 'treatment', 1).status).toBe(0);
    expect(gate(base, 'treatment', 2).status).toBe(1);
    trial(base, NAME, [{ kind: 'publish', role: 'worker-1', ok: true }]); // published, never read
    const stop = gate(base, 'baseline', 1);
    expect(stop.status).toBe(1);
    expect(stop.stdout).toMatch(/the mechanism failed/);
    trial(base, `${NAME}r1`, [read('synthesiser')]); // a redo in which it did read
    expect(gate(base, 'baseline', 1).status).toBe(0);
    expect(gate(base, 'treatment', 2).status).toBe(0);
    expect(gate(base, 'treatment', 3).status).toBe(1);
  });

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
  it('PILOT_ONLY parses a parallel-sweep-3 treatment trial and gets as far as the inputs check; a stage 2 trial is refused before stage 1', () => {
    const base = scratch();
    expect(runAll(base, 'parallel-sweep-3:treatment:1:0').status).toBe(3);
    expect(readFileSync(join(base, 'pilot-run-all.log'), 'utf8')).toMatch(
      /no inputs for parallel-sweep-3/,
    );
    mkdirSync(join(base, 'inputs', 'parallel-sweep-3'), { recursive: true });
    for (const spec of [
      'parallel-sweep-3:treatment:2:0',
      'parallel-sweep-3:baseline:1:0',
      'parallel-sweep-3:baseline:2:0',
    ])
      expect(runAll(base, spec).status).toBe(6);
    const log = readFileSync(join(base, 'pilot-run-all.log'), 'utf8');
    expect(log).toMatch(/GATE refused: parallel-sweep-3 treatment 2/);
    expect(log).toMatch(/GATE refused: parallel-sweep-3 baseline 1/);
    expect(log).toMatch(/GATE refused: parallel-sweep-3 baseline 2/);
    expect(() => readFileSync(join(base, 'trials'))).toThrow(); // nothing was prepared
  });
});
