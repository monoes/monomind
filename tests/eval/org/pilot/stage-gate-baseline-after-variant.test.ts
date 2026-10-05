// Declared change baseline-control-after-variant (2026-10-05, owner standing rule): the baseline control of
// parallel-sweep-3 (stage 2 of the plain gate) may also be unlocked by a finished stage 1 VARIANT trial (p1t-v2r) whose
// synthesiser made the mechanism's doc_read calls, when PILOT_BASELINE_AFTER_VARIANT names that variant and
// PILOT_OWNER_DECISION names the variant's phrases. Without that variable nothing changes. The gate only reads files.
// @ts-nocheck: plain .mjs module
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { baselineControlReads, decide } from './stage-gate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pilot = JSON.parse(readFileSync(join(here, 'parallel-sweep-3.pilot.json'), 'utf8'));
const OWNER = 'handoff-relay-consistency-check handoff-runtime-port';
const trial = (base: string, name: string, reads: number) => {
  const dir = join(base, 'trials', name);
  mkdirSync(join(dir, 'pilot-state'), { recursive: true });
  writeFileSync(join(dir, 'result.json'), '{}');
  const events = Array.from({ length: reads }, () => ({
    kind: 'read',
    role: 'synthesiser',
    ok: true,
    doc: 'd',
  }));
  writeFileSync(
    join(dir, 'pilot-state/pilot-events.jsonl'),
    `${events.map((e) => JSON.stringify(e)).join('\n')}\n`,
  );
};
const base = () => mkdtempSync(join(tmpdir(), 'gate-bav-'));

describe('baselineControlReads', () => {
  it('is undefined unless PILOT_BASELINE_AFTER_VARIANT names a variant', () => {
    const b = base();
    trial(b, 'smoke-parallel-sweep-3-phase2-p1t-v2r', 8);
    expect(
      baselineControlReads(pilot, b, 'parallel-sweep-3', { PILOT_OWNER_DECISION: OWNER }),
    ).toBeUndefined();
  });

  it('gives the synthesiser reads of that variant stage 1 trial when the owner decision names its phrases', () => {
    const b = base();
    trial(b, 'smoke-parallel-sweep-3-phase2-p1t-v2r', 8);
    const env = { PILOT_OWNER_DECISION: OWNER, PILOT_BASELINE_AFTER_VARIANT: 'v2r' };
    expect(baselineControlReads(pilot, b, 'parallel-sweep-3', env)).toBe(8);
  });

  it('is undefined when the owner decision lacks a phrase, the variant is unknown, or no trial finished', () => {
    const b = base();
    trial(b, 'smoke-parallel-sweep-3-phase2-p1t-v2r', 8);
    const named = { PILOT_BASELINE_AFTER_VARIANT: 'v2r' };
    expect(
      baselineControlReads(pilot, b, 'parallel-sweep-3', {
        ...named,
        PILOT_OWNER_DECISION: 'handoff-relay-consistency-check',
      }),
    ).toBeUndefined();
    expect(
      baselineControlReads(pilot, b, 'parallel-sweep-3', {
        PILOT_OWNER_DECISION: OWNER,
        PILOT_BASELINE_AFTER_VARIANT: 'nope',
      }),
    ).toBeUndefined();
    expect(
      baselineControlReads(pilot, base(), 'parallel-sweep-3', {
        ...named,
        PILOT_OWNER_DECISION: OWNER,
      }),
    ).toBeUndefined();
  });

  it('feeds the unchanged baseline gate: enough reads allow it, too few stop it, none refuses it', () => {
    const ok = decide({ pilot, arm: 'baseline', n: 1, reads: 8, env: {} });
    expect(ok.allowed).toBe(true);
    expect(decide({ pilot, arm: 'baseline', n: 1, reads: 0, env: {} }).allowed).toBe(false);
    expect(decide({ pilot, arm: 'baseline', n: 1, reads: undefined, env: {} }).allowed).toBe(false);
  });
});
