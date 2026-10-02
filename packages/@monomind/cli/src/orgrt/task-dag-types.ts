// packages/@monomind/cli/src/orgrt/task-dag-types.ts
// Split out of task-dag.ts (file-size sweep) — the OrgTask row shape and its
// split-child helper type.
import type { TaskEvidence } from './completion-gate.js';
import type { TaskPick } from './task-match.js';

export type OrgTaskStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'blocked'
  | 'done'
  | 'failed'
  | 'split'
  | 'merged'
  | 'cancelled';

export interface OrgTask {
  id: string;
  title: string;
  assignee: string;
  deps: string[];
  status: OrgTaskStatus;
  result?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  splitFrom?: string;
  mergedInto?: string;
  /** Set when status is 'blocked': the task can't proceed until this real-world
   *  time (e.g. waiting on a scheduled external process — a CI run, a soak
   *  test, a human-set deadline). Distinct from a dependency block (deps not
   *  yet done): this is an explicit "nothing to do until <time>" signal a role
   *  gives when genuinely no other task is dispatchable. The idle watchdog
   *  treats an active block the same as a pending decision gate — legitimate
   *  waiting, not silence to nudge about. */
  blockedUntil?: number;
  blockedReason?: string;
  /** #329: while blocked, when the assignee is next woken to re-check the
   *  block, and how often (block-recheck.ts). On the task row so it rides the
   *  checkpoint — a timer in daemon memory would not survive a resume. */
  recheckAt?: number;
  recheckEveryMs?: number;
  /** #343: blocked because its assignee's session was closed for budget, not
   *  on a real-world time — `blockedReason` says why. `releaseAssigneeHold`
   *  puts it back to 'ready' when the role reopens (budget-closure.ts). */
  heldForAssignee?: boolean;
  /** ADR-O001 D4: how many times the assignee has failed the completion
   *  evidence gate on THIS task since it was last accepted. It lives on the
   *  task row, so it rides the checkpoint (`toJSON`/`fromJSON`) like every
   *  other piece of task state — a counter held only in daemon memory would
   *  reset on every crash or resume and the cap would bound nothing.
   *  Cleared by `complete()`; see `recordEvidenceFailure`. */
  evidenceFailures?: number;
  /** The role that created the task (org_task / org_plan_graph; split
   *  children inherit it). Read by run_config.notify_task_creator. */
  createdBy?: string;
  /** ADR-O001 D7: the loadout the boss selected for this task. Set once at
   *  creation and never re-selected: every dispatch and re-dispatch (evidence
   *  refusal, checkpoint requeue, block expiry) reads it from here, so a retry
   *  is the same attempt again rather than a re-roll. Rides the checkpoint
   *  with the rest of the row. Absent when none was selected. */
  loadout?: string;
  /** The creator's instructions for the task — scope, acceptance criteria,
   *  what failed last time. Sent with the title in every dispatch (task-provenance.ts
   *  dispatchLine), so it arrives with the task however late that is, and it
   *  rides the checkpoint with the rest of the row. At most MAX_TASK_BRIEF. */
  brief?: string;
  /** Phase 2 packet: what the assignee should consult (packet.ts). Opt-in. */
  references?: import('./packet.js').TaskReferences;
  /** ADR-O001 D6: the most recent evidence the assignee submitted with
   *  org_task_done, accepted or refused — what an artifact-only reviewer is
   *  shown. Only the latest: earlier rounds are exactly what D6 withholds.
   *  Outputs are capped so the row stays small on the checkpoint. */
  lastEvidence?: TaskEvidence;
  /** org_task: 'auto' when `assignee: "auto"` was resolved (provenance in
   *  `pick`), 'explicit' when named. Absent on older rows and other paths. */
  assignedBy?: 'auto' | 'explicit';
  pick?: TaskPick;
  /** Skills named in the dispatch and the ones the assignee then loaded with
   *  org_skill_load — together they measure whether suggestions are used. */
  suggestedSkills?: string[];
  loadedSkills?: string[];
}

/** Upper bound on OrgTask.brief — enforced by the org_task/org_plan_graph
 *  schemas; long material belongs in a file the brief points at. */
export const MAX_TASK_BRIEF = 4000;

export interface SplitChild {
  title: string;
  assignee: string;
}
