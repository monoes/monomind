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

// ── ADR-O001 D5: evidence gate for per-item completion ──────────────────
/**
 * The gate above asks "is this claim about the RUN honest?".
 * `checkTaskEvidence` asks the same question one level down, about a single
 * item: "may this role close this task, and is there anything but its own
 * opinion saying it is done?".
 *
 * Why: one measured run produced 223 gate verdicts for 15 finished items —
 * ~15 opinions per item — and still shipped five controls that could not
 * fail. Three times the verifier FAILED a sha the reviewer had already
 * APPROVED, and the verifier was right every time. Every one of those
 * verdicts was an LLM judgment with nothing checking it.
 *
 * Ported from Gas Town's `gt done` (internal/cmd/done.go:498-526), which
 * refuses to retire review work unless the item carries a fresh evidence
 * comment. Its five tests map onto this runtime as:
 *   1. posted after work started — STRUCTURAL here, not a check: evidence is
 *      an argument OF the org_task_done call, so it cannot predate the call.
 *      Gas Town needs `attached_at` because its evidence is a comment that
 *      persists on the item independently of the close.
 *   2. authored by the assignee — `caller` is the RUNTIME's view of which
 *      role invoked the tool (session.ts binds it per role), compared here
 *      against the task's assignee. Deliberately not a self-declared author
 *      field, which an agent could simply write.
 *   3. machine-parseable prefix — replaced by something stronger: evidence is
 *      a typed {command, exitCode, output} record. There is no prose to
 *      regex, and "an acceptance criterion is a command with an exit code"
 *      (D5) becomes expressible in the type itself.
 *   4. not machine-generated — n/a, see 3.
 *   5. head_sha equal to the current HEAD — ported as-is, and the
 *      load-bearing one: evidence gathered before the last commit is STALE.
 *      The work moved; the proof did not.
 *
 * What this does NOT do, stated plainly rather than implied: the runtime does
 * not re-execute the command. A role can still report exitCode 0 for a
 * command it never ran. What the gate buys is that the proof must name a
 * runnable command, must be attributable, and must be pinned to the tree
 * state being closed — so it cannot be recycled across commits, which is the
 * failure actually observed. Re-executing the acceptance commands from the
 * daemon is the strictly stronger version and the obvious next step; it needs
 * a decision about where those commands run (role sandbox vs daemon) that is
 * out of scope here.
 *
 * Opt-in: `run_config.completion_evidence` (default false). Turning it on
 * refuses completions that previously succeeded — that IS the point — so it
 * must never be on by default, or every existing org breaks on upgrade.
 */

/** One acceptance criterion: a command, the exit code it actually returned,
 *  and what it printed. */
export interface EvidenceCheck {
  command: string;
  exitCode: number;
  output?: string;
}

export interface TaskEvidence {
  /** The commit sha the checks were run against. */
  headSha: string;
  checks: EvidenceCheck[];
}

export interface TaskEvidenceFacts {
  /** `run_config.completion_evidence`. False (the default) allows everything. */
  required: boolean;
  evidence?: TaskEvidence;
  /** The workspace's real current commit sha, resolved by the caller.
   *  Undefined when the workspace is not a git repository. */
  headSha?: string;
  /** Role id the runtime saw calling org_task_done. */
  caller: string;
  /** The task's recorded assignee. */
  assignee: string;
}

/** Shortest sha prefix accepted — the git default short length. Below that a
 *  prefix identifies nothing. */
const MIN_SHA_LEN = 7;

const EVIDENCE_SHAPE =
  'Attach evidence: { headSha: "<the current commit sha>", checks: [{ command, exitCode, output }] } — one entry per acceptance criterion, each a command you actually ran, with its real exit code and its output.';

/** Decide whether a role may close a task, given already-gathered facts.
 *  Returns a refusal message, or `null` to allow. Pure: the caller resolves
 *  the head sha and the assignee. */
export function checkTaskEvidence(f: TaskEvidenceFacts): string | null {
  if (!f.required) return null;
  if (f.caller !== f.assignee) {
    return `org_task_done refused: this task is assigned to "${f.assignee}", and evidence only counts from the assignee. Ask "${f.assignee}" to close it, or reassign the task first.`;
  }
  const ev = f.evidence;
  if (!ev) {
    return `org_task_done refused (run_config.completion_evidence): closing a task needs verifiable evidence, not a summary. ${EVIDENCE_SHAPE}`;
  }
  if (ev.checks.length === 0) {
    return `org_task_done refused: the evidence names no acceptance command. An acceptance criterion is a command with an exit code — if you cannot write one, the criterion is too vague to close on. ${EVIDENCE_SHAPE}`;
  }
  for (const c of ev.checks) {
    if (!c.command.trim()) {
      return `org_task_done refused: an evidence entry has an empty command. Every check must name the command that was actually run. ${EVIDENCE_SHAPE}`;
    }
  }
  const failed = ev.checks.filter((c) => c.exitCode !== 0);
  if (failed.length > 0) {
    const detail = failed
      .map((c) => `  $ ${c.command}\n  exit ${c.exitCode}${c.output ? `\n  ${c.output}` : ''}`)
      .join('\n');
    return `org_task_done refused: ${failed.length} acceptance command(s) did not exit 0 — the task is not done.\n${detail}\nFix the failure, re-run the checks, and close it again; the task goes back in your queue.`;
  }
  if (!f.headSha) {
    return 'org_task_done refused: evidence must be pinned to a commit, but this workspace has no resolvable git HEAD. Either run this org in a git workspace, or turn run_config.completion_evidence off.';
  }
  const claimed = ev.headSha.trim().toLowerCase();
  const actual = f.headSha.trim().toLowerCase();
  if (claimed.length < MIN_SHA_LEN) {
    return `org_task_done refused: headSha "${ev.headSha}" is too short to identify a commit (at least ${MIN_SHA_LEN} characters). The current head is ${actual}.`;
  }
  if (!actual.startsWith(claimed)) {
    return `org_task_done refused: the evidence is STALE. It is pinned to ${claimed}, but the current head is ${actual} — the tree moved after those checks ran, so they say nothing about the code being closed. Re-run the acceptance commands against the current head and attach the new output.`;
  }
  return null;
}
