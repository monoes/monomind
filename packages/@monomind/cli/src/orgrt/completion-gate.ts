// packages/@monomind/cli/src/orgrt/completion-gate.ts
/**
 * #302: `org_complete` had no gate at all — a boss could end a run `partial`
 * with a full backlog and no named reason, and nothing checked whether the
 * claim was true. `checkCompletion` is the pure decision behind the gate:
 * given already-gathered facts about the run (nothing it can invent for
 * itself), it returns a refusal string or `null` (allow). The daemon gathers
 * the facts (`daemon.ts`'s `onComplete`) and calls this; this module does no
 * I/O and imports nothing from `daemon.ts`, so it is table-testable without
 * booting a daemon.
 *
 * A free-text blocker is satisfiable by typing anything, so free text alone
 * is out. But an enum is not honest either — a boss can pick 'time' as
 * easily as it can type "time". The enum's real value is that it is
 * MACHINE-CHECKABLE, which free text is not: `budget`/`human`/`time` are
 * each cross-checked against runtime state the boss does not author.
 * `external` is the deliberate escape hatch — not checkable, so its
 * `blockerDetail` is required to be a real, substantive claim instead (it is
 * recorded verbatim in the run history, attributed to the boss, so a human
 * reads it).
 *
 * Safety property, load-bearing, asserted as test rows not just documented
 * here: this module constrains ONLY `outcome: 'partial'` by default.
 * `achieved` and `failed` are never refused by the default (`mode: 'boss'`)
 * half — a boss can always end the run honestly, so the gate cannot trap an
 * org in a run it is unable to finish. `mode: 'dag'` (opt-in via
 * `run_config.completion`) is an ADDITIONAL, stronger constraint on top of
 * that, not a replacement: it also refuses `achieved` while runnable work
 * remains, which the default half never does.
 */

export type CompletionOutcome = 'achieved' | 'partial' | 'failed';
export type CompletionBlocker = 'budget' | 'human' | 'external' | 'time';

export interface CompletionFacts {
  outcome: CompletionOutcome;
  blocker?: CompletionBlocker;
  blockerDetail?: string;
  /** 'boss' (default): only `outcome: 'partial'` is gated, via `blocker`.
   *  'dag' (run_config.completion: 'dag', opt-in): additionally refuses
   *  `achieved`/`partial` while runnable work remains — see `hasPendingWork`. */
  mode: 'boss' | 'dag';
  /** Highest role spend / ceiling across tokens and USD, 0..1. */
  maxBudgetFraction: number;
  /** Unannswered `ask_human` questions plus pending decision gates. */
  pendingHumanWaits: number;
  /** `TaskDag.hasActiveBlock(now)` — every non-terminal task is blocked on a
   *  real-world time still in the future. False when there are no
   *  non-terminal tasks at all (see `hasPendingWork`'s doc). */
  hasActiveBlock: boolean;
  /** Some task in `org_tasks` is not yet terminal (done/failed/split/merged/
   *  cancelled). Must be checked ALONGSIDE `hasActiveBlock`, not instead of
   *  it: `hasActiveBlock` alone is false on an EMPTY dag too (nothing left to
   *  block on), which would wrongly refuse a run that legitimately finished
   *  every task. */
  hasPendingWork: boolean;
}

/** A role at/above this fraction of its budget ceiling is a genuine
 *  budget blocker; below it, `blocker: 'budget'` is not a true claim. */
const BUDGET_THRESHOLD = 0.8;
/** `blockerDetail` shorter than this is refused even if not an exact
 *  placeholder match — "x" must not pass. */
const MIN_DETAIL_LEN = 10;
/** The issue's explicit ask: reject these placeholder claims outright,
 *  regardless of length. */
const EMPTY_DETAIL = /^(none|n\/a|na|-)$/i;

const NO_BLOCKER =
  "org_complete refused: outcome 'partial' requires a blocker naming why the run cannot continue (blocker: 'budget' | 'human' | 'external' | 'time'). If there is more work to do, dispatch it with org_task instead of ending the run. If a task is only waiting on a real-world time, call org_task_block(taskId, untilIso, reason) so a future run can pick back up automatically. If the run genuinely cannot continue, use outcome: 'failed' instead.";

function checkBlocker(f: CompletionFacts): string | null {
  if (!f.blocker) return NO_BLOCKER;
  switch (f.blocker) {
    case 'external': {
      const detail = (f.blockerDetail ?? '').trim();
      if (!detail || EMPTY_DETAIL.test(detail) || detail.length < MIN_DETAIL_LEN) {
        return `org_complete refused: blocker 'external' requires a real, substantive blockerDetail (at least ${MIN_DETAIL_LEN} characters — not empty, whitespace-only, or a placeholder like "none"/"n/a") because it cannot be checked against anything else; it is recorded verbatim in the run history, attributed to you, so a human can read the actual claim.`;
      }
      return null;
    }
    case 'budget': {
      if (f.maxBudgetFraction < BUDGET_THRESHOLD) {
        return `org_complete refused: blocker 'budget' claimed, but the highest role spend is only ${Math.round(f.maxBudgetFraction * 100)}% of its ceiling — that is not a budget blocker. Dispatch the next batch with org_task, or use outcome: 'failed' if the run genuinely cannot continue.`;
      }
      return null;
    }
    case 'human': {
      if (f.pendingHumanWaits === 0) {
        return `org_complete refused: blocker 'human' claimed, but there is no unanswered ask_human question or pending decision gate right now. Dispatch the next batch with org_task, or use outcome: 'failed' if the run genuinely cannot continue.`;
      }
      return null;
    }
    case 'time': {
      if (!f.hasActiveBlock) {
        return `org_complete refused: blocker 'time' claimed, but no task is blocked on a future real-world time. Call org_task_block(taskId, untilIso, reason) on the task that is actually waiting, so a future run can pick back up automatically.`;
      }
      return null;
    }
  }
}

const DAG_PENDING_WORK =
  "org_complete refused (run_config.completion: 'dag'): runnable work remains in org_tasks and nothing is blocked on a future time. Dispatch the next batch with org_task, or call org_task_block on a task that is genuinely waiting on a real-world time.";

/** Decide whether an `org_complete` call is honest, given already-gathered
 *  facts. Returns a refusal message, or `null` to allow. */
export function checkCompletion(f: CompletionFacts): string | null {
  if (f.outcome === 'partial') {
    const refusal = checkBlocker(f);
    if (refusal) return refusal;
  }
  if (f.mode === 'dag' && f.outcome !== 'failed' && f.hasPendingWork && !f.hasActiveBlock) {
    return DAG_PENDING_WORK;
  }
  return null;
}
