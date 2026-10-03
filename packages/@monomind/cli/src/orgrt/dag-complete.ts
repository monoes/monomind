// packages/@monomind/cli/src/orgrt/dag-complete.ts
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  checkTaskEvidence,
  declaresExpectExit,
  expectSuffix,
  type LocalHead,
  type TaskEvidence,
} from './completion-gate.js';
import type { OrgDaemon } from './daemon.js';
import { dispatchReadyTasks, queueDispatch } from './dag-dispatch.js';
import { taskTag } from './loadouts.js';
import { capText } from './review-packet.js';
import { isTerminalStatus } from './task-dag.js';
import { DEFAULT_MAX_EVIDENCE_ATTEMPTS } from './types.js';

/** The workspace's current commit sha, or undefined when `cwd` is not inside
 *  a git repository (or git is unavailable). ADR-O001 D5's sha pin is only
 *  as good as this: it must come from the runtime, never from the agent. */
export function currentHeadSha(cwd: string): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

/** Every local head of the repository `cwd` belongs to: each worktree's HEAD
 *  (the workspace's own first) and each local branch tip. Work often happens
 *  in a worktree other than the org workspace — a release branch, a per-task
 *  dev worktree — and evidence pinned to that work's current commit is as
 *  fresh as evidence pinned to the workspace's. Empty outside a git repo. */
export function localHeads(cwd: string): LocalHead[] {
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const heads: LocalHead[] = [];
  try {
    let cur: LocalHead | undefined;
    for (const line of git(['worktree', 'list', '--porcelain']).split('\n')) {
      if (line.startsWith('worktree ')) {
        cur = { sha: '', worktree: line.slice(9) };
        heads.push(cur);
      } else if (cur && line.startsWith('HEAD ')) cur.sha = line.slice(5);
      else if (cur && line.startsWith('branch '))
        cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    }
  } catch {
    return [];
  }
  try {
    for (const line of git([
      'for-each-ref',
      'refs/heads',
      '--format=%(objectname) %(refname:short)',
    ]).split('\n')) {
      const [sha, branch] = line.split(' ');
      if (sha && branch) heads.push({ sha, branch });
    }
  } catch {
    // worktree heads alone still answer the question
  }
  const own = currentHeadSha(cwd);
  const live = heads.filter((h) => h.sha);
  const ownIdx = live.findIndex((h) => h.sha === own && h.worktree);
  if (ownIdx > 0) live.unshift(...live.splice(ownIdx, 1));
  return live;
}

/** Whether `sha` names a commit in the workspace's repository. */
function isKnownCommit(cwd: string, sha: string): boolean {
  if (!/^[0-9a-f]+$/i.test(sha)) return false;
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Evidence's `worktree`, made comparable with `git worktree list` output:
 *  resolved against the workspace, symlinks followed when it exists. */
function resolveEvidenceWorktree(
  ev: TaskEvidence | undefined,
  base: string,
): TaskEvidence | undefined {
  if (!ev?.worktree) return ev;
  const abs = resolve(base, ev.worktree);
  return { ...ev, worktree: existsSync(abs) ? realpathSync(abs) : abs };
}

/** One line per acceptance command, appended to the task's stored result so
 *  `org_tasks` and the run history carry the commands and their exit codes —
 *  not just a prose claim that the work is done. */
function evidenceSummary(ev: TaskEvidence): string {
  const lines = ev.checks
    .map((c) => `  $ ${c.command} → exit ${c.exitCode}${expectSuffix(c)}`)
    .join('\n');
  return `evidence @ ${ev.headSha}:\n${lines}`;
}

export function dagCompleteTask(
  daemon: OrgDaemon,
  org: string,
  role: string,
  taskId: string,
  result?: string,
  evidence?: TaskEvidence,
): string {
  const running = daemon.orgs.get(org);
  if (!running?.taskDag) return JSON.stringify({ error: 'org not running' });
  // ADR-O001 D5: refuse a close that carries no checkable proof. Only when
  // the org opted in (run_config.completion_evidence), and only for a task
  // that exists — an unknown id falls through to complete()'s own error.
  const task = running.taskDag.get(taskId);
  // #319: a task-scoped session (run_config.session_scope) is resumed PER TASK,
  // so a session resumed for a follow-up task still has the previous, already
  // closed task in its context and can close that id instead of the one it is
  // working. Nothing used to stop it: markRunning() is a no-op on a terminal
  // task and complete() has no terminal guard, so the close succeeded, the
  // creator got a second "[task:<closed id>] DONE", and the task actually in
  // flight stayed 'running' until a human noticed. Refuse it here — before any
  // evidence is recorded against the closed task — and name what is open.
  if (task && isTerminalStatus(task.status)) {
    const open = running.taskDag
      .all()
      .filter((t) => t.assignee === role && !isTerminalStatus(t.status));
    running.bus.emit({
      type: 'audit',
      from: role,
      reason: 'task-already-closed',
      msg: `task ${taskId} is already ${task.status} — close refused`,
      data: { taskId, status: task.status, open: open.map((t) => t.id) },
    });
    // A retry of the role's own close that worked: say it worked, or it keeps retrying.
    const retry = task.status === 'done' && task.assignee === role && !open.length;
    return JSON.stringify({
      error:
        task.status === 'cancelled'
          ? `org_task_done refused: task ${taskId} ("${task.title}") was cancelled${task.result ? ` (${task.result})` : ''} — its work is not wanted. Stop working on it: do not commit, integrate or report further work for it.${open.length ? ` Your open task(s): ${open.map((t) => `${t.id} ("${t.title}")`).join(', ')}.` : ''}`
          : retry
            ? `org_task_done refused: task ${taskId} is already done ("${task.title}") — your earlier org_task_done for it was accepted, so nothing else is needed. Do not call org_task_done for it again.`
            : `org_task_done refused: task ${taskId} is already ${task.status} ("${task.title}") — closing it again would notify its creator about work that was reported long ago. ` +
              (open.length
                ? `Your open task(s): ${open.map((t) => `${t.id} ("${t.title}")`).join(', ')}. Close the one this work is for, by its id.`
                : 'You have no open task — if this work belongs to a new one, ask for it to be created rather than re-closing a finished task.'),
    });
  }
  // Write verification (write-ledger.ts): a completion over a demonstrably
  // failed write whose file is not on disk goes back to the role.
  const unwritten = task ? running.writeLedger?.checkTaskDone(role, result) : null;
  if (unwritten) {
    running.bus.emit({
      type: 'audit',
      from: role,
      reason: 'write-unverified-refused',
      msg: `task ${taskId} not closed: ${unwritten}`,
      data: { taskId },
    });
    return JSON.stringify({ error: unwritten });
  }
  // ADR-O001 D6: keep the latest evidence the ASSIGNEE submitted, accepted or
  // not — it is what an artifact-only reviewer is shown. Another role's
  // evidence is not recorded: it would let a non-assignee plant the reviewer's
  // input.
  if (task && evidence && role === task.assignee) running.taskDag.recordEvidence(taskId, evidence);
  // Deliberative work has no oracle; demanding evidence would only invite a
  // fabricated exit code (ADR-O001, "What this does NOT apply to").
  const deliberative =
    running.def.roles.find((r) => r.id === task?.assignee)?.deliberative === true;
  if (task && running.def.run_config.completion_evidence && !deliberative) {
    const workspace = running.workdir ?? daemon.root;
    const pinned = resolveEvidenceWorktree(evidence, workspace);
    const refusal = checkTaskEvidence({
      required: true,
      evidence: pinned,
      headSha: currentHeadSha(workspace),
      heads: localHeads(workspace),
      isKnownCommit: (sha) => isKnownCommit(workspace, sha),
      ...(pinned?.worktree ? { worktreeExists: existsSync(pinned.worktree) } : {}),
      worktreeLabel: evidence?.worktree,
      caller: role,
      assignee: task.assignee,
      result,
    });
    if (refusal) {
      // ADR-O001 D4: the correction loop is bounded. Only the assignee's own
      // failures count — a refusal aimed at a role that is not the assignee
      // says nothing about whether the assignee can produce evidence, and
      // must not spend its attempts. Neither does a call with no evidence
      // object at all: that is a formatting slip, not a failed proof — on the
      // release org's first run it cost 4 of 6 tasks an attempt.
      const counts = role === task.assignee && evidence !== undefined;
      const attempts = counts ? running.taskDag.recordEvidenceFailure(taskId) : 0;
      const cap = running.def.run_config.max_evidence_attempts ?? DEFAULT_MAX_EVIDENCE_ATTEMPTS;
      if (attempts >= cap) {
        // Escalate rather than hand it back a fourth time. "Escalate" is the
        // path this runtime already has for work a role cannot finish (the
        // crashed-worker handoff in daemon.ts): record the reason on the task,
        // raise a loud audit event next to D4's `no-progress` one, and put it
        // in the boss's mailbox to re-plan, split or drop. Failing the task
        // keeps the D4 liveness invariant — a non-terminal task with nothing
        // dispatched for it is exactly the silent stall D4 exists to remove.
        const why = `evidence gate failed ${attempts}x (cap ${cap}) — escalated to "${running.bossRoleId}": ${refusal}`;
        running.taskDag.fail(taskId, why);
        running.bus.emit({
          type: 'audit',
          from: role,
          reason: 'task-evidence-escalated',
          msg: `task ${taskId} failed the evidence gate ${attempts} times — escalated to "${running.bossRoleId}" instead of re-dispatching`,
          data: { taskId, assignee: task.assignee, attempts, cap, refusal },
        });
        queueDispatch(
          running,
          running.bossRoleId,
          `${taskTag(task)} ESCALATED — "${task.assignee}" failed the completion evidence gate ${attempts} times on "${task.title}", so it is marked failed and is NOT being re-dispatched. Last refusal: ${refusal}\nDecide what happens next: re-scope it into a new task, reassign it, or end the run honestly. Do not simply re-file the identical task for the same role.`,
        );
        return JSON.stringify({
          error: `${refusal}\n\nThat is ${attempts} failed evidence check(s) on this task (cap ${cap}). It is not coming back to you: it is recorded as failed and "${running.bossRoleId}" has been asked to decide what happens next. Stop retrying it.`,
          escalated: taskId,
          attempts,
        });
      }
      // Not a crash and not a dead end: the item goes back on the queue with
      // the reason attached, so the correction loop (D4) picks it up even if
      // this session dies before it can react to the tool result.
      running.taskDag.markRunning(taskId);
      running.taskDag.requeue(taskId);
      running.bus.emit({
        type: 'audit',
        from: role,
        reason: 'task-evidence-refused',
        msg: `task ${taskId} not closed — evidence refused`,
        data: { taskId, assignee: task.assignee, attempts, cap, refusal },
      });
      // The tool result carries the count too: without it a role cannot tell
      // a free refusal from a counted one, and escalates early (2.16.14, task-10).
      const count = attempts
        ? ` (attempt ${attempts} of ${cap}; after ${cap} this task is escalated instead of returned)`
        : evidence === undefined
          ? ' (no evidence was attached, so this did not count against your attempts)'
          : '';
      queueDispatch(
        running,
        task.assignee,
        `${taskTag(task)} NOT CLOSED — ${refusal}${count}`,
        taskId,
        true,
      );
      dispatchReadyTasks(daemon, org, running);
      return JSON.stringify({ error: `${refusal}${count}`, requeued: taskId });
    }
  }
  const stored = evidence ? `${result ? `${result}\n\n` : ''}${evidenceSummary(evidence)}` : result;
  try {
    running.taskDag.markRunning(taskId);
    const promoted = running.taskDag.complete(taskId, stored);
    running.bus.emit({
      type: 'status',
      from: role,
      reason: 'task-done',
      msg: `task ${taskId} completed${promoted.length ? ` — ${promoted.map((t) => t.id).join(', ')} now ready` : ''}`,
      data: { taskId, promoted: promoted.map((t) => t.id), evidence },
    });
    // A check accepted at a non-zero exit is the one place the gate takes the
    // role's word for what an exit code MEANS. Each one gets its own audit
    // event so they can be swept after the run without re-reading every task
    // — the 2.15.6 misuse was only found because a human read the log.
    for (const c of evidence?.checks ?? []) {
      if (!declaresExpectExit(c)) continue;
      running.bus.emit({
        type: 'audit',
        from: role,
        reason: 'evidence-expect-exit',
        msg: `task ${taskId} closed with \`${c.command}\` accepted at exit ${c.exitCode}${expectSuffix(c)}`,
        data: {
          taskId,
          role,
          command: c.command,
          expectExit: c.expectExit,
          expectReason: c.expectReason,
        },
      });
    }
    if (promoted.length > 0) dispatchReadyTasks(daemon, org, running);
    // run_config.notify_task_creator: a completion otherwise lives only on
    // the bus, and a creator waiting on it stays idle until the watchdog.
    // #319: the tag and the title come from the completed task itself, never
    // from the caller's session state — the guard above is what guarantees
    // that task is the one that just closed.
    const creator = task?.createdBy;
    if (task && running.def.run_config.notify_task_creator && creator && creator !== role) {
      const summary = result ? ` Result: ${capText(result, 1_500)}` : '';
      const ev = evidence ? `\n${evidenceSummary(evidence)}` : '';
      const next = promoted.length ? `\nNow ready: ${promoted.map((t) => t.id).join(', ')}.` : '';
      queueDispatch(
        running,
        creator,
        `[task:${task.id}] DONE — "${task.title}" was completed by "${role}".${summary}${ev}${next}`,
      );
    }
    return JSON.stringify({
      done: taskId,
      promoted: promoted.map((t) => ({ id: t.id, title: t.title, assignee: t.assignee })),
    });
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
}
