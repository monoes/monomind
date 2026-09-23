// Improvement 11: a detached `org run` log must end with one line naming the
// outcome, the wall time and the total cost — before this, a run's log just
// stopped, with nothing saying how it ended.
import { describe, expect, it } from 'vitest';
import { classifyRunEnd, runEndLine } from '../../src/commands/org-run-end.js';
import type { BusEvent } from '../../src/orgrt/types.js';

const ev = (partial: Partial<BusEvent>): BusEvent =>
  ({ id: 'x', ts: 1000, org: 'rel', run: 'run-1', type: 'status', ...partial }) as BusEvent;

const usage = (cost: number): BusEvent => ev({ type: 'usage', from: 'captain', data: { tokens: 10, cost_usd: cost } });

describe('classifyRunEnd', () => {
  it('complete when the run closed via org_complete, with the boss outcome', () => {
    const r = classifyRunEnd({
      final: { status: 'stopped', closedBy: 'org-complete' },
      events: [ev({ from: 'captain', reason: 'org-complete', data: { outcome: 'achieved', summary: 's' } })],
    });
    expect(r).toEqual({ kind: 'complete', detail: 'achieved' });
  });

  it('stopped for a manual org stop or a signal', () => {
    expect(classifyRunEnd({ final: { status: 'stopped' }, events: [], stoppedManually: true })).toEqual({
      kind: 'stopped',
      detail: 'org stop',
    });
    expect(classifyRunEnd({ final: {}, events: [], signal: true })).toEqual({ kind: 'stopped', detail: 'signal' });
  });

  it('error for a crashed run, carrying the recorded error', () => {
    expect(classifyRunEnd({ final: { status: 'crashed', error: 'boom' }, events: [] })).toEqual({
      kind: 'error',
      detail: 'boom',
    });
  });

  it('budget when a budget closed the run before org_complete', () => {
    const r = classifyRunEnd({
      final: { status: 'stopped', closedBy: 'idle-stop' },
      events: [ev({ reason: 'org-budget-exhausted', msg: 'org-wide token budget exhausted' })],
    });
    expect(r).toEqual({ kind: 'budget', detail: 'idle-stop' });
  });

  it('stopped with the automated cause for any other end', () => {
    expect(classifyRunEnd({ final: { status: 'stopped', closedBy: 'idle-stop' }, events: [] })).toEqual({
      kind: 'stopped',
      detail: 'idle-stop',
    });
  });
});

describe('runEndLine', () => {
  it('names outcome, wall time and total cost from usage events', () => {
    const line = runEndLine({
      name: 'release',
      run: 'run-1',
      wallMs: (1 * 3600 + 57 * 60 + 12) * 1000,
      final: { status: 'stopped', closedBy: 'org-complete' },
      events: [
        usage(40.5),
        usage(23.13),
        ev({ from: 'captain', reason: 'org-complete', data: { outcome: 'achieved', summary: 's' } }),
      ],
    });
    expect(line).toBe('org release run run-1 ended — outcome: complete (achieved), wall time 1h57m12s, cost $63.63');
  });

  it('still prints a line with no recorded events', () => {
    const line = runEndLine({ name: 'x', run: 'r', wallMs: 5_400, final: { status: 'crashed' }, events: [] });
    expect(line).toBe('org x run r ended — outcome: error (unknown error), wall time 5s, cost $0.00');
  });
});
