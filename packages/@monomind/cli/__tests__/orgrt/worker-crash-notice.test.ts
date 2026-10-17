// When the Codex and Antigravity scorers crashed, the lead was told to "reassign its outstanding work
// to another agent or take it on yourself", and filled both seats with Claude subagents: a panel whose
// point was three vendors scored by one. A seat pinned to a runtime is reported failed, not refilled.
import { describe, expect, it } from 'vitest';
import { workerCrashNotice } from '../../src/orgrt/worker-crash-notice.js';

const base = { id: 'scorer-codex' };

describe('workerCrashNotice', () => {
  it('keeps the usual reassign advice for an unpinned worker', () => {
    const text = workerCrashNotice(base, 'boom', '');
    expect(text).toContain('Worker "scorer-codex" crashed and will not recover this run (boom)');
    expect(text).toContain('Reassign its outstanding work to another agent or take it on yourself.');
    expect(text).not.toMatch(/another runtime/i);
  });

  it('for a seat pinned to a runtime, forbids refilling it with another runtime or model', () => {
    for (const role of [
      { id: 'scorer-codex', runtime: 'codex' },
      { id: 'scorer-agy', provider: { kind: 'antigravity' } },
    ]) {
      const text = workerCrashNotice(role as never, 'boom', '');
      expect(text).toMatch(/runs on (codex|antigravity)/i);
      expect(text).toMatch(/do not .*another runtime or model/i);
      expect(text).toMatch(/report .*failed/i);
      expect(text).not.toContain('take it on yourself');
    }
  });

  it('appends the guidance after the advice', () => {
    expect(workerCrashNotice(base, 'boom', ' Break it up.').endsWith(' Break it up.')).toBe(true);
  });
});
