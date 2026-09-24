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
  /** The exit code that means this criterion is met, when that is not 0 — a
   *  404 from a GET that must not find anything, `git config --get` of a key
   *  that must stay unset, a timeout that must fire (124). The check passes
   *  iff `exitCode === (expectExit ?? 0)`. Declaring it keeps the real exit
   *  code in the record; the alternative roles reached for, `|| true`,
   *  throws it away. */
  expectExit?: number;
  /** One line saying why that non-zero exit is the CORRECT outcome ("404 =
   *  branch not protected"). Required whenever `expectExit` is non-zero:
   *  without it, declaring an expectation and muting a real failure look
   *  identical to everyone downstream. */
  expectReason?: string;
  output?: string;
}

/** The exit code a check must return to pass. */
export const expectedExit = (c: EvidenceCheck): number => c.expectExit ?? 0;

/** True when the check declares a non-zero expected exit. `expectExit: 0` is
 *  the default and declares nothing, so it needs no reason and is not
 *  audited. */
export const declaresExpectExit = (c: EvidenceCheck): boolean => expectedExit(c) !== 0;

/** How a declared expectation renders wherever a check is shown — the review
 *  packet, the task's stored result, a refusal. The reason rides along with
 *  the code so a reader never has to go looking for it. */
export const expectSuffix = (c: EvidenceCheck): string =>
  c.expectExit === undefined
    ? ''
    : ` (expected ${c.expectExit}${c.expectReason ? `: ${c.expectReason}` : ''})`;

/**
 * 2.15.6: a role put `expectExit: 1` on `pnpm run test:all:run` — ~7,800
 * tests. Exit 1 there means "at least one of 7,800 things failed", so the
 * gate accepted every other failure in the suite along with the one the role
 * meant. A human had to read the log to find out which had actually failed.
 *
 * Detection is on the command string and deliberately conservative — it
 * matches the shapes roles write, not an attempt to understand shell. A
 * false positive costs a role one narrowed command; a false negative costs a
 * silent pass, which is the failure being fixed.
 */
const AGGREGATE_PATTERNS: Array<[RegExp, string]> = [
  [/\bvitest\b/, 'a vitest suite'],
  [/\bjest\b/, 'a jest suite'],
  [/\b(?:npm|pnpm|yarn|bun)\b[^&|;]*?\b(?:run\s+)?test[:\w-]*(?:\s|$)/, 'a test script'],
  [/\bnode\b[^&|;]*--test\b/, "node's test runner"],
  [/\bpnpm\b[^&|;]*\s-r(?:\s|$)/, 'every package in the workspace (pnpm -r)'],
  [/\bpnpm\b[^&|;]*--filter\b[^&|;]*\btest/, 'a filtered workspace test run'],
  [/\brun\s+verify\b/, 'an aggregate verify script'],
  [/\btest:all\b/, 'the whole test suite'],
];

/** A command that names a concrete test file is already narrowed to it —
 *  that is the way out the aggregate refusal points at, so it must pass. */
const NAMES_A_TEST_FILE = /[\w./@-]+[._-](?:test|spec)\.[cm]?[jt]sx?\b/;

/** What `command` aggregates, or null when its exit code is one outcome. */
export function aggregateCommand(command: string): string | null {
  if (NAMES_A_TEST_FILE.test(command)) return null;
  for (const [re, what] of AGGREGATE_PATTERNS) if (re.test(command)) return what;
  return null;
}

/** An `expectReason` shorter than this is not a reason — "x" must not pass,
 *  while "404 = no protection" must. */
const MIN_REASON_LEN = 8;

export interface TaskEvidence {
  /** The commit sha the checks were run against. */
  headSha: string;
  /** The worktree the checks ran in, when the work is not in the org
   *  workspace itself. Pins the staleness check to that worktree's HEAD. */
  worktree?: string;
  checks: EvidenceCheck[];
}

/** A commit that is the current state of some local work: a worktree's HEAD
 *  or a local branch's tip. */
export interface LocalHead {
  sha: string;
  /** Absolute worktree path, for a worktree HEAD. */
  worktree?: string;
  /** Short branch name, when the head is (or is checked out on) a branch. */
  branch?: string;
}

export interface TaskEvidenceFacts {
  /** `run_config.completion_evidence`. False (the default) allows everything. */
  required: boolean;
  evidence?: TaskEvidence;
  /** The workspace's real current commit sha, resolved by the caller.
   *  Undefined when the workspace is not a git repository. */
  headSha?: string;
  /** Every local head of the workspace's repository — each worktree's HEAD
   *  and each local branch tip. Evidence pinned to any of them is current.
   *  When absent, only `headSha` counts. */
  heads?: LocalHead[];
  /** Whether git knows `sha` as a commit. Tells a typo'd sha apart from
   *  one the tree moved past; when absent every sha is assumed known. */
  isKnownCommit?: (sha: string) => boolean;
  /** Whether the evidence's `worktree` exists on disk; an absent all-caps
   *  path (".../SRC") is then taken for an unfilled placeholder. */
  worktreeExists?: boolean;
  /** `worktree` as the role wrote it, before the caller resolved it against
   *  the workspace. A relative one ("src", "work/src") that resolves to no
   *  worktree names the one worktree whose path ends with it. */
  worktreeLabel?: string;
  /** Role id the runtime saw calling org_task_done. */
  caller: string;
  /** The task's recorded assignee. */
  assignee: string;
}

/** Shortest sha prefix accepted — the git default short length. Below that a
 *  prefix identifies nothing. */
const MIN_SHA_LEN = 7;

const EVIDENCE_SHAPE =
  'Attach evidence: { headSha: "<the current commit sha>", worktree: "<the worktree you ran in, if not the org workspace>", checks: [{ command, exitCode, expectExit?, expectReason?, output }] } — one entry per acceptance criterion, each a command you actually ran, with its real exit code and its output. Set expectExit only when a SINGLE-PURPOSE command is met by a non-zero exit (e.g. 1 for a lookup that must find nothing, 124 for a timeout that must fire), and always say why in expectReason; never on a test suite or any other aggregate command.';

/** How a task whose job is to REPORT closes. Its failures are findings, not
 *  acceptance checks; its acceptance commands prove the report exists. */
const REPORT_TASK_HINT =
  "If this task's job is to REPORT (QA, an audit) and these failures are what you found, they are findings, not acceptance checks: put them in `result` and send them to the coordinator, and make the acceptance commands prove the report exists and is complete (e.g. `test -s <report file>`, a grep for each required section).";

const normalizePath = (p: string): string => p.trim().replace(/\/+$/, '');

/** A worktree path that is a template the role never filled in: a literal
 *  `<…>`/`{{…}}`, or (when it does not exist) an all-caps last segment like
 *  the rules' `SRC`. */
function isPlaceholderPath(path: string, exists: boolean | undefined): boolean {
  if (/[<>]|\{\{|\}\}/.test(path)) return true;
  return exists === false && /(?:^|\/)[A-Z][A-Z0-9_]*$/.test(normalizePath(path));
}

/** The worktree head evidence is pinned to: the one at the resolved path,
 *  else — for a relative label — the worktree(s) whose path ends with it.
 *  2.16.1 release run: roles pinned `worktree: "src"` for the release
 *  worktree at ORG_ROOT/.monomind/orgs/release/work/src, and 11 of 11 first
 *  closes were refused because "src" resolved to ORG_ROOT/src. */
function pinnedWorktrees(
  resolved: string,
  label: string | undefined,
  heads: LocalHead[],
): LocalHead[] {
  const worktrees = heads.filter((h) => h.worktree);
  const exact = worktrees.find((h) => normalizePath(h.worktree!) === normalizePath(resolved));
  if (exact) return [exact];
  if (!label || label.trim().startsWith('/')) return [];
  const tail = normalizePath(label).replace(/^(?:\.\/)+/, '');
  if (!tail || tail === '.' || tail.split('/').includes('..')) return [];
  return worktrees.filter((h) => normalizePath(h.worktree!).endsWith(`/${tail}`));
}

function unknownCommit(claimed: string, heads: LocalHead[]): string {
  return `org_task_done refused: headSha ${claimed} is an unknown commit (typo?) — git has no commit by that name in this repository. Copy it from \`git -C <worktree> rev-parse HEAD\` rather than retyping it. Current heads: ${describeHeads(heads)}.`;
}

function describeHeads(heads: LocalHead[]): string {
  const shown = heads
    .slice(0, 8)
    .map((h) => `${h.sha}${h.worktree ? ` (${h.worktree})` : h.branch ? ` (${h.branch})` : ''}`);
  return `${shown.join(', ')}${heads.length > 8 ? `, and ${heads.length - 8} more` : ''}`;
}

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
    if (!declaresExpectExit(c)) continue;
    const aggregate = aggregateCommand(c.command);
    if (aggregate) {
      return `org_task_done refused: expectExit ${c.expectExit} on \`${c.command}\` — that command runs ${aggregate}, and its exit code is not a single outcome. Exit ${c.exitCode} there means "at least one thing failed", so accepting it accepts ANY other failure in the same run: the failure you know about and a brand-new regression are the same exit code, and the gate cannot tell them apart. Run the one failing test file on its own (e.g. \`npx vitest run path/to/one.test.ts\`) and declare expectExit on THAT check, or exclude the known failure from this command (\`--exclude\`, \`-t\`, a skip) so it exits 0, and record the exclusion and why in \`result\`.`;
    }
    const reason = (c.expectReason ?? '').trim();
    if (reason.length < MIN_REASON_LEN) {
      return `org_task_done refused: expectExit ${c.expectExit} on \`${c.command}\` needs an expectReason — one line saying why that non-zero exit is the CORRECT outcome (e.g. "404 = branch not protected", "the key must stay unset", "the 1s timeout must fire"), at least ${MIN_REASON_LEN} characters. Without it, a declared expectation and a muted failure are indistinguishable to the coordinator and the reviewer, who see only the exit code.`;
    }
  }
  const failed = ev.checks.filter((c) => c.exitCode !== expectedExit(c));
  if (failed.length > 0) {
    const detail = failed
      .map(
        (c) =>
          `  $ ${c.command}\n  expected exit ${expectedExit(c)}${c.expectReason ? ` (${c.expectReason})` : ''}, got exit ${c.exitCode}${c.output ? `\n  ${c.output}` : ''}`,
      )
      .join('\n');
    return `org_task_done refused: ${failed.length} acceptance command(s) did not exit as expected — the task is not done.\n${detail}\nFix the failure, re-run the checks, and close it again; the task goes back in your queue. If a non-zero exit IS the correct outcome, declare it with expectExit plus a one-line expectReason on that check — never append \`|| true\`, which erases the exit code the gate is checking, and never on a test suite or other aggregate command, whose exit code is not one outcome. ${REPORT_TASK_HINT}`;
  }
  const heads: LocalHead[] = f.heads?.length ? f.heads : f.headSha ? [{ sha: f.headSha }] : [];
  if (heads.length === 0) {
    return 'org_task_done refused: evidence must be pinned to a commit, but this workspace has no resolvable git HEAD. Either run this org in a git workspace, or turn run_config.completion_evidence off.';
  }
  const claimed = ev.headSha.trim().toLowerCase();
  if (claimed.length < MIN_SHA_LEN) {
    return `org_task_done refused: headSha "${ev.headSha}" is too short to identify a commit (at least ${MIN_SHA_LEN} characters). Current heads: ${describeHeads(heads)}.`;
  }
  const matches = (h: LocalHead): boolean => h.sha.trim().toLowerCase().startsWith(claimed);
  if (ev.worktree) {
    const pinned = pinnedWorktrees(ev.worktree, f.worktreeLabel, heads);
    if (pinned.length > 1) {
      return `org_task_done refused: worktree "${f.worktreeLabel}" is ambiguous — it fits ${pinned.length} worktrees of this repository: ${pinned.map((h) => h.worktree).join(', ')}. Pin the full path of the one you ran the checks in.`;
    }
    const wt = pinned[0];
    if (!wt) {
      const known = heads.filter((h) => h.worktree).map((h) => h.worktree);
      if (isPlaceholderPath(ev.worktree, f.worktreeExists)) {
        return `org_task_done refused: worktree "${ev.worktree}" is a placeholder, not a path — pin the real worktree path you ran the checks in (see \`git worktree list\`). Worktrees: ${known.join(', ') || 'none'}.`;
      }
      return `org_task_done refused: "${ev.worktree}" is not a worktree of this repository, so its HEAD cannot be checked. If you ran the checks somewhere else — a scratch dir, an installed tarball — pin \`worktree\` and \`headSha\` to the git worktree the tested artifact was BUILT FROM (and keep the scratch path in the command or output). Worktrees: ${known.join(', ') || 'none'}.`;
    }
    if (!matches(wt)) {
      if (f.isKnownCommit && !f.isKnownCommit(claimed)) return unknownCommit(claimed, heads);
      return `org_task_done refused: the evidence is STALE. It is pinned to ${claimed}, but the current head of ${wt.worktree} is ${wt.sha} — the tree moved after those checks ran, so they say nothing about the code being closed. Re-run the acceptance commands against the current head and attach the new output.`;
    }
    return null;
  }
  if (!heads.some(matches)) {
    if (f.isKnownCommit && !f.isKnownCommit(claimed)) return unknownCommit(claimed, heads);
    return `org_task_done refused: the evidence is STALE. It is pinned to ${claimed}, which is not the current head of any worktree or local branch (current heads: ${describeHeads(heads)}) — the tree moved after those checks ran, so they say nothing about the code being closed. Re-run the acceptance commands against the current head and attach the new output, with \`worktree\` naming where you ran them.`;
  }
  return null;
}
