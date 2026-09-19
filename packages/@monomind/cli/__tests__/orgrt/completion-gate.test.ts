// packages/@monomind/cli/__tests__/orgrt/completion-gate.test.ts
/**
 * #302: a boss could end a run `partial` with a full backlog and no named
 * reason — `org_complete` had no gate at all. `checkCompletion` is the pure
 * decision function behind the gate: given already-gathered facts about the
 * run (nothing it can invent for itself), it returns a refusal string or
 * `null` (allow). The daemon gathers the facts and calls this; this file
 * tests the decision in isolation, table-driven, with no daemon involved.
 *
 * Two governing properties, each with its own row below, not just a comment:
 *  - The default half (`mode: 'boss'`) constrains ONLY `outcome: 'partial'`.
 *    `achieved` and `failed` are NEVER refused by it — a boss can always end
 *    the run honestly, so the gate cannot trap a run it is unable to finish.
 *  - `mode: 'dag'` is an ADDITIONAL, stronger constraint on top of the
 *    default half (opt-in via `run_config.completion`), not a replacement —
 *    it also refuses `achieved` while runnable work remains, which the
 *    default half never does.
 */
import { describe, expect, it } from 'vitest';
import { checkCompletion, type CompletionFacts } from '../../src/orgrt/completion-gate.js';

const BASE: CompletionFacts = {
  outcome: 'partial',
  mode: 'boss',
  maxBudgetFraction: 0,
  pendingHumanWaits: 0,
  hasActiveBlock: false,
  hasPendingWork: true,
};

describe('checkCompletion — default (boss) half', () => {
  it('refuses partial with no blocker named', () => {
    expect(checkCompletion({ ...BASE })).not.toBeNull();
  });

  // Row 2: every placeholder detail value is refused for blocker: 'external'.
  // Rejects: an implementation that accepts any non-empty string as a
  // substantive claim, which "none"/"n/a"/"x" would all satisfy.
  it.each(['none', '', '   ', 'n/a', 'x', 'N/A', 'na', '-'])(
    'refuses blocker "external" with placeholder detail %j',
    (detail) => {
      expect(checkCompletion({ ...BASE, blocker: 'external', blockerDetail: detail })).not.toBeNull();
    },
  );

  // Row 3: this is the 2026-09-18 run's exact shape — ~2% spend, claiming budget.
  it("refuses blocker 'budget' when the real spend is only 2% of the ceiling (the 2026-09-18 run's exact shape) — message names the real spend", () => {
    const msg = checkCompletion({ ...BASE, blocker: 'budget', maxBudgetFraction: 0.02 });
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/2%/);
  });

  it("refuses blocker 'human' when nothing is pending", () => {
    expect(
      checkCompletion({ ...BASE, blocker: 'human', pendingHumanWaits: 0 }),
    ).not.toBeNull();
  });

  it("refuses blocker 'time' when hasActiveBlock is false — message routes to org_task_block", () => {
    const msg = checkCompletion({ ...BASE, blocker: 'time', hasActiveBlock: false });
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/org_task_block/);
  });

  it("allows blocker 'time' when every remaining task is genuinely blocked until a future time (the legitimate case)", () => {
    expect(
      checkCompletion({ ...BASE, blocker: 'time', hasActiveBlock: true, hasPendingWork: true }),
    ).toBeNull();
  });

  it("allows blocker 'budget' when a role is at 95% of its ceiling", () => {
    expect(checkCompletion({ ...BASE, blocker: 'budget', maxBudgetFraction: 0.95 })).toBeNull();
  });

  it("allows blocker 'external' with substantive detail", () => {
    expect(
      checkCompletion({
        ...BASE,
        blocker: 'external',
        blockerDetail: 'Waiting on the vendor API key the owner said they would provide by EOD.',
      }),
    ).toBeNull();
  });

  it("allows blocker 'human' when a question or gate is actually pending", () => {
    expect(checkCompletion({ ...BASE, blocker: 'human', pendingHumanWaits: 1 })).toBeNull();
  });

  // Row 9 — the safety property, asserted as a row, not a comment: the
  // default half never gates 'achieved' or 'failed', against EVERY fact-set
  // that would refuse a 'partial' above. A boss can always end the run
  // honestly; nothing here can trap a run it is unable to finish.
  // Rejects: a default-half implementation that accidentally also gates
  // achieved/failed (e.g. by checking outcome !== 'achieved' instead of
  // outcome === 'partial').
  const REFUSING_PARTIAL_FACT_SETS: Array<Partial<CompletionFacts>> = [
    {},
    { blocker: 'external', blockerDetail: 'none' },
    { blocker: 'budget', maxBudgetFraction: 0.02 },
    { blocker: 'human', pendingHumanWaits: 0 },
    { blocker: 'time', hasActiveBlock: false },
  ];
  it.each(REFUSING_PARTIAL_FACT_SETS)(
    "never refuses 'achieved' or 'failed' under a fact-set that refuses 'partial': %j",
    (facts) => {
      expect(checkCompletion({ ...BASE, ...facts, outcome: 'achieved' })).toBeNull();
      expect(checkCompletion({ ...BASE, ...facts, outcome: 'failed' })).toBeNull();
    },
  );
});

describe("checkCompletion — completion: 'dag' (opt-in, additional)", () => {
  // Row 10: runnable work exists — partial (with an otherwise-valid blocker)
  // AND achieved are both refused; failed is still allowed. Using blocker:
  // 'time' with hasActiveBlock: false isolates that the DAG-mode refusal
  // fires on its own terms, not merely because the boss-half's blocker check
  // also happens to deny it.
  it('pending/ready/running work exists: refuses partial and achieved, allows failed', () => {
    const facts: CompletionFacts = {
      outcome: 'partial',
      blocker: 'time',
      mode: 'dag',
      maxBudgetFraction: 0,
      pendingHumanWaits: 0,
      hasActiveBlock: false,
      hasPendingWork: true,
    };
    expect(checkCompletion(facts)).not.toBeNull();
    expect(checkCompletion({ ...facts, outcome: 'achieved' })).not.toBeNull();
    expect(checkCompletion({ ...facts, outcome: 'failed' })).toBeNull();
  });

  // Row 11: every non-terminal task is blocked until a future time — a
  // legitimate partial, same shape as the default-half's own 'time' case,
  // just under the stricter mode.
  it('every non-terminal task blocked until a future time: partial (blocker: time) is allowed', () => {
    expect(
      checkCompletion({
        outcome: 'partial',
        blocker: 'time',
        mode: 'dag',
        maxBudgetFraction: 0,
        pendingHumanWaits: 0,
        hasActiveBlock: true,
        hasPendingWork: true,
      }),
    ).toBeNull();
  });

  // Row 12: guards the hasActiveBlock false-on-empty-DAG edge documented on
  // TaskDag.hasActiveBlock — testing hasActiveBlock alone (rather than
  // hasPendingWork && !hasActiveBlock) would refuse a run that legitimately
  // finished every task, since hasActiveBlock returns false when there is
  // nothing left to be blocked on.
  // Rejects: `if (!f.hasActiveBlock) deny` instead of
  // `if (f.hasPendingWork && !f.hasActiveBlock) deny`.
  it('no non-terminal tasks at all: achieved is allowed even though hasActiveBlock is false', () => {
    expect(
      checkCompletion({
        outcome: 'achieved',
        mode: 'dag',
        maxBudgetFraction: 0,
        pendingHumanWaits: 0,
        hasActiveBlock: false,
        hasPendingWork: false,
      }),
    ).toBeNull();
  });
});
