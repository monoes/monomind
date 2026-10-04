// packages/@monomind/cli/__tests__/orgrt/normalize-golden.test.ts
// Org sections P3.0: the golden normaliser maps only volatile values, and
// leaves everything a golden is meant to pin untouched.
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeGolden, normalizeString } from './support/normalize-golden.js';
import { RECAPTURE_PIECES, recapturePiece } from './support/golden-capture.js';

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe('normalizeGolden', () => {
  it('maps run ids, bus event ids, message ids, uuids and ISO times', () => {
    const run = 'run-20261004001447-odxa';
    expect(normalizeString(`started (${run}) as ${run}-1767225600000-12 and ${run}-1767225600000-3-audit`)).toBe(
      'started (<RUN>) as <ID> and <ID>',
    );
    expect(normalizeString('msg-1767225600000-0e8cf316')).toBe('<MSG>');
    expect(normalizeString('7b9e8f0a-1c2d-4e3f-8a4b-5c6d7e8f9a0b at 2026-10-04T00:14:47.123Z')).toBe('<UUID> at <TIME>');
  });

  it('maps temp roots, lexical and resolved, longest first', () => {
    const root = mkdtempSync(join(process.env.TMPDIR ?? '/var/tmp', 'norm-'));
    dirs.push(root);
    expect(normalizeString(`${root}/.monomind/orgs/alpha`, { roots: [root] })).toBe('<ROOT>/.monomind/orgs/alpha');
    expect(normalizeString(`${root}/sub/x`, { roots: [root, `${root}/sub`] })).toBe('<ROOT>/x');
  });

  it('replaces clock and process keys only, keeping every other number and key order', () => {
    const out = normalizeGolden({ type: 'usage', ts: 1767225600000, pid: 4242, updated: '2026-10-04T00:00:00Z', data: { tokens: 2, at: 5 }, taskId: 'task-1' }) as Record<string, unknown>;
    expect(out).toEqual({ type: 'usage', ts: '<TS>', pid: '<PID>', updated: '<UPDATED>', data: { tokens: 2, at: '<AT>' }, taskId: 'task-1' });
    expect(Object.keys(out)).toEqual(['type', 'ts', 'pid', 'updated', 'data', 'taskId']);
  });

  it('leaves message text, task ids and event reasons alone', () => {
    const v = { reason: 'task-dispatched', msg: 'task task-1 dispatched to coder', list: ['task-2', 7, null, true] };
    expect(normalizeGolden(v)).toEqual(v);
  });

  it('is idempotent', () => {
    const once = normalizeGolden({ id: 'run-20261004001447-odxa-1767225600000-1', ts: 1 });
    expect(normalizeGolden(once)).toEqual(once);
  });
});

describe('golden re-capture guard', () => {
  it('refuses any piece other than the initial capture and P3.12', () => {
    expect(RECAPTURE_PIECES).toEqual(['P3.0', 'P3.12']);
    expect(recapturePiece({})).toBeUndefined();
    expect(recapturePiece({ SECTIONS_OFF_GOLDEN_RECAPTURE: 'P3.12' })).toBe('P3.12');
    expect(() => recapturePiece({ SECTIONS_OFF_GOLDEN_RECAPTURE: 'P3.6' })).toThrow(/refused/);
    expect(() => recapturePiece({ SECTIONS_OFF_GOLDEN_RECAPTURE: '1' })).toThrow(/refused/);
  });
});
