// The stage gate of parallel-sweep-3 variant v2 (stage-gate.mjs, decideHandoffVariant): stage 1 is the v2 treatment trial 1
// and needs the owner decision phrase; v2 x2 only if, in that trial, the synthesiser made a doc_read and a doc_check call;
// the plain treatment gate (stage-gate-sweep3.test.ts) is untouched by it. No model is called: the gate only reads files.
// @ts-nocheck: plain .mjs module
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decide, stageOneChecks, stageOneReads } from './stage-gate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pilot = JSON.parse(
  (await import('node:fs')).readFileSync(join(here, 'parallel-sweep-3.pilot.json'), 'utf8'),
);
const PHRASE = 'handoff-relay-consistency-check';
const env = { PILOT_OWNER_DECISION: `the lead, ${PHRASE}` };
const d = (arm: string, n: number, o: Record<string, unknown> = {}) =>
  decide({ pilot, arm, n, variant: 'v2', env, ...o });
const trial = (base: string, name: string, events: object[], finished = true) => {
  const dir = join(base, 'trials', name);
  mkdirSync(join(dir, 'pilot-state'), { recursive: true });
  if (finished) writeFileSync(join(dir, 'result.json'), '{}');
  writeFileSync(
    join(dir, 'pilot-state/pilot-events.jsonl'),
    `${events.map((e) => JSON.stringify(e)).join('\n')}\n`,
  );
};
const ev = (kind: string, role = 'synthesiser', ok = true) => ({
  kind,
  role,
  ok,
  doc: 'module-sheets-w1',
});

describe('decide with the v2 variant', () => {
  it('stage 1 (treatment x1) needs the owner decision naming the declared change; the arm must be treatment', () => {
    expect(d('treatment', 1).allowed).toBe(true);
    expect(d('treatment', 1).reason).toMatch(/mechanism gates: doc_read and doc_check/);
    expect(d('treatment', 1, { env: {} })).toMatchObject({
      allowed: false,
      reason: expect.stringContaining(`needs PILOT_OWNER_DECISION naming "${PHRASE}"`),
    });
    expect(d('baseline', 1).reason).toMatch(/treatment arm only, not baseline/);
    expect(decide({ pilot, arm: 'treatment', n: 1, variant: 'v9', env }).reason).toMatch(
      /does not list the variant "v9"/,
    );
  });

  it('x2 needs the stage 1 v2 trial, and at least one synthesiser read and one doc_check in it', () => {
    expect(d('treatment', 2, { reads: undefined })).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/needs the stage 1 variant trial first/),
    });
    expect(d('treatment', 2, { reads: 0, checks: 3 }).reason).toMatch(
      /STOP: .* 0 successful doc_read calls/,
    );
    const noChecks = d('treatment', 2, { reads: 8, checks: 0 });
    expect(noChecks.allowed).toBe(false);
    expect(noChecks.reason).toMatch(
      /0 successful doc_check calls.*the verification aid was not used/,
    );
    expect(d('treatment', 2, { reads: 8, checks: undefined }).allowed).toBe(false);
    expect(d('treatment', 2, { reads: 8, checks: 1 })).toMatchObject({
      allowed: true,
      reason: expect.stringMatching(/8 doc_read and 1 doc_check/),
    });
  });

  it('any other number needs the stage 3 approval', () => {
    expect(d('treatment', 3, { reads: 9, checks: 9 }).allowed).toBe(false);
    expect(
      d('treatment', 3, { reads: 9, checks: 9, env: { ...env, PILOT_STAGE3_APPROVED: 'yes' } })
        .allowed,
    ).toBe(true);
  });

  it('leaves the plain treatment gate as it was: no variant needed, a gate on reads only, d480 still refused', () => {
    expect(decide({ pilot, arm: 'treatment', n: 2, reads: 1, env: {} }).allowed).toBe(true);
    expect(decide({ pilot, arm: 'treatment', n: 1, variant: 'd480', env }).allowed).toBe(false);
  });
});

describe('stageOneReads and stageOneChecks read the right trial', () => {
  it('count the synthesiser ok calls of p1t-v2, never those of p1t, and p1t is not counted for the variant', () => {
    const base = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'gate-v2-'));
    expect(stageOneChecks(base, 'parallel-sweep-3', 'v2')).toBeUndefined();
    trial(base, 'smoke-parallel-sweep-3-phase2-p1t', [ev('read'), ev('read'), ev('check')]);
    trial(base, 'smoke-parallel-sweep-3-phase2-p1t-v2', [
      ev('read'),
      ev('check'),
      ev('check'),
      ev('check', 'synthesiser', false),
      ev('check', 'worker-1'),
    ]);
    expect(stageOneReads(base, 'parallel-sweep-3')).toBe(2);
    expect(stageOneReads(base, 'parallel-sweep-3', 'v2')).toBe(1);
    expect(stageOneChecks(base, 'parallel-sweep-3', 'v2')).toBe(2);
    expect(stageOneChecks(base, 'parallel-sweep-3')).toBe(1);
  });

  it('an unfinished v2 trial is not the stage 1 result', () => {
    const base = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'gate-v2-'));
    trial(base, 'smoke-parallel-sweep-3-phase2-p1t-v2', [ev('read')], false);
    expect(stageOneReads(base, 'parallel-sweep-3', 'v2')).toBeUndefined();
  });
});
