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
import {
  checkCompletion,
  checkTaskEvidence,
  type CompletionFacts,
  type TaskEvidenceFacts,
} from '../../src/orgrt/completion-gate.js';

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

/**
 * ADR-O001 D5 — "oracles before judges". The per-ITEM half of the gate.
 *
 * The measured failure this exists for: one run produced 223 LLM gate
 * verdicts for 15 finished items and still shipped five controls that could
 * not fail; in three cases the verifier FAILED a sha the reviewer had already
 * APPROVED, and the verifier was right every time. The verdicts were opinions
 * with nothing checking them.
 *
 * `checkTaskEvidence` is the pure decision behind `org_task_done`'s evidence
 * gate, ported from Gas Town's `gt done` (internal/cmd/done.go:498-526).
 * Gas Town's five tests map onto ours as:
 *   1. posted after work started  — structural here: evidence is attached IN
 *      the org_task_done call, so it cannot predate the call.
 *   2. authored by the assignee   — the caller is the runtime's own view of
 *      who called the tool, compared against the task's assignee. Not a
 *      self-declared author field, which an agent could simply set.
 *   3. machine-parseable prefix   — replaced by something stronger: evidence
 *      is a typed record of {command, exitCode, output}, not prose to regex.
 *   4. not machine-generated      — n/a; see 3.
 *   5. head_sha == rev-parse HEAD — ported verbatim, and the row that
 *      matters: evidence produced before the last commit is STALE and must
 *      not close the item.
 *
 * Safety property, asserted as a row not a comment: with `required: false`
 * (the default — `run_config.completion_evidence` is opt-in) NOTHING here
 * refuses. Turning the flag on refuses completions that previously succeeded;
 * leaving it off must change nothing for an org upgrading into this build.
 */
const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const STALE = '0f1e2d3c4b5a69788796a5b4c3d2e1f098765432';

const PASSING: TaskEvidenceFacts = {
  required: true,
  caller: 'dev',
  assignee: 'dev',
  headSha: HEAD,
  evidence: {
    headSha: HEAD,
    checks: [{ command: 'pnpm vitest run auth.test.ts', exitCode: 0, output: '12 passed' }],
  },
};

describe('checkTaskEvidence — ADR-O001 D5 (opt-in via run_config.completion_evidence)', () => {
  it('refuses a completion carrying no evidence at all', () => {
    const msg = checkTaskEvidence({ ...PASSING, evidence: undefined });
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/evidence/i);
  });

  it('refuses evidence with no acceptance command — a claim is not an oracle', () => {
    const msg = checkTaskEvidence({ ...PASSING, evidence: { headSha: HEAD, checks: [] } });
    expect(msg).not.toBeNull();
  });

  it.each(['', '   '])('refuses a check whose command is %j', (command) => {
    expect(
      checkTaskEvidence({
        ...PASSING,
        evidence: { headSha: HEAD, checks: [{ command, exitCode: 0 }] },
      }),
    ).not.toBeNull();
  });

  it('refuses a non-zero exit code, and the refusal carries the command and its output back', () => {
    const msg = checkTaskEvidence({
      ...PASSING,
      evidence: {
        headSha: HEAD,
        checks: [
          { command: 'pnpm run build', exitCode: 0, output: 'ok' },
          { command: 'pnpm vitest run auth.test.ts', exitCode: 1, output: 'AssertionError: got 401' },
        ],
      },
    });
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/pnpm vitest run auth\.test\.ts/);
    expect(msg).toMatch(/AssertionError: got 401/);
  });

  // THE row. Evidence from before the last commit does not count: the work
  // moved, the proof did not. This is the one Gas Town property that cannot
  // be satisfied by writing a nicer sentence.
  it('refuses evidence pinned to a STALE sha, naming both shas', () => {
    const msg = checkTaskEvidence({
      ...PASSING,
      headSha: HEAD,
      evidence: { headSha: STALE, checks: [{ command: 'pnpm test', exitCode: 0, output: 'ok' }] },
    });
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/stale/i);
    expect(msg).toContain(STALE.slice(0, 12));
    expect(msg).toContain(HEAD.slice(0, 12));
  });

  it('refuses when the workspace has no resolvable HEAD — unpinnable evidence is not evidence', () => {
    expect(checkTaskEvidence({ ...PASSING, headSha: undefined })).not.toBeNull();
  });

  it('refuses when the caller is not the task assignee', () => {
    const msg = checkTaskEvidence({ ...PASSING, caller: 'reviewer', assignee: 'dev' });
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/assignee/i);
  });

  it('accepts fresh evidence: every command exited 0 and the sha is the current HEAD', () => {
    expect(checkTaskEvidence(PASSING)).toBeNull();
  });

  it('accepts a short sha that is a prefix of the current HEAD (git rev-parse --short)', () => {
    expect(
      checkTaskEvidence({
        ...PASSING,
        evidence: { ...PASSING.evidence!, headSha: HEAD.slice(0, 9).toUpperCase() },
      }),
    ).toBeNull();
  });

  // Work rarely lives only in the org workspace: a release branch, a per-task
  // dev worktree. Evidence pinned to the CURRENT head of any of that local
  // work is fresh; a commit that is the head of nothing is still stale.
  describe('evidence from other worktrees and local branches', () => {
    const WT = '/repo/.monomind/orgs/release/work/src';
    const WT_SHA = 'b2c3d4e5f60718293a4b5c6d7e8f9012345678a1';
    const BRANCH_SHA = 'c3d4e5f60718293a4b5c6d7e8f9012345678a1b2';
    const heads = [
      { sha: HEAD, worktree: '/repo', branch: 'main' },
      { sha: WT_SHA, worktree: WT, branch: 'release/2.15.5' },
      { sha: BRANCH_SHA, branch: 'dev/item-7' },
    ];
    const ev = (headSha: string, worktree?: string) => ({
      headSha,
      ...(worktree ? { worktree } : {}),
      checks: [{ command: 'pnpm test', exitCode: 0, output: 'ok' }],
    });

    it("accepts evidence pinned to another worktree's current HEAD", () => {
      expect(checkTaskEvidence({ ...PASSING, heads, evidence: ev(WT_SHA) })).toBeNull();
    });

    it("accepts evidence pinned to a local branch tip that no worktree has checked out", () => {
      expect(checkTaskEvidence({ ...PASSING, heads, evidence: ev(BRANCH_SHA.slice(0, 10)) })).toBeNull();
    });

    it('still refuses a commit that is the head of no local work, listing the current heads', () => {
      const msg = checkTaskEvidence({ ...PASSING, heads, evidence: ev(STALE) });
      expect(msg).toMatch(/stale/i);
      expect(msg).toContain(WT);
      expect(msg).toContain('dev/item-7');
    });

    it('with `worktree` named, pins the check to THAT worktree — another head does not count', () => {
      expect(checkTaskEvidence({ ...PASSING, heads, evidence: ev(WT_SHA, `${WT}/`) })).toBeNull();
      const msg = checkTaskEvidence({ ...PASSING, heads, evidence: ev(HEAD, WT) });
      expect(msg).toMatch(/stale/i);
      expect(msg).toContain(WT_SHA);
    });

    it('refuses a `worktree` that is not a worktree of this repository', () => {
      const msg = checkTaskEvidence({ ...PASSING, heads, evidence: ev(WT_SHA, '/elsewhere') });
      expect(msg).toMatch(/not a worktree of this repository/);
    });
  });

  it('refuses a sha prefix too short to identify a commit', () => {
    expect(
      checkTaskEvidence({
        ...PASSING,
        evidence: { ...PASSING.evidence!, headSha: HEAD.slice(0, 4) },
      }),
    ).not.toBeNull();
  });

  // The upgrade-safety row: with the flag off, every fact-set that refuses
  // above is allowed. Rejects an implementation that gates by default.
  const REFUSING: Array<Partial<TaskEvidenceFacts>> = [
    { evidence: undefined },
    { evidence: { headSha: HEAD, checks: [] } },
    { evidence: { headSha: STALE, checks: [{ command: 'pnpm test', exitCode: 0 }] } },
    { evidence: { headSha: HEAD, checks: [{ command: 'pnpm test', exitCode: 1 }] } },
    { headSha: undefined },
    { caller: 'someone-else' },
  ];
  it.each(REFUSING)('allows everything when required is false: %j', (facts) => {
    expect(checkTaskEvidence({ ...PASSING, ...facts, required: false })).toBeNull();
  });
});
