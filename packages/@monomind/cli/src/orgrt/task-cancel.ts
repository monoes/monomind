// packages/@monomind/cli/src/orgrt/task-cancel.ts
/**
 * org_task_cancel stops the assignee's work on the task, not only the task's
 * status. On the 2.16.2 release run the coordinator cancelled task-25 at
 * 119.8m; nothing told the fixer, which kept working for 25 minutes,
 * committed its fix to the release fix worktree, and only learned of the
 * cancel when its org_task_done was refused. The commit was then integrated
 * after the final audit.
 *
 * Mail reaches a role only when its turn ends, so a notice alone arrives too
 * late for a role mid-turn. In task scope the role's live process belongs to
 * one task, so that process is ended the way a sandbox fault ends it
 * (session.ts aborts the runner, which kills its child): bounded, and no other
 * task's session is touched. In role scope one process serves every task, so
 * only the notice is sent.
 */

import type { RunningOrg } from './daemon.js';
import type { OrgTask } from './task-dag.js';

/** The reason a task-scoped process was ended: its task was cancelled. */
export class TaskCancelledError extends Error {
  constructor(
    readonly taskId: string,
    /** Queued by the session loop once the process is gone, so the dying
     *  process cannot swallow it. */
    readonly notice: string,
  ) {
    super(`task ${taskId} was cancelled`);
    this.name = 'TaskCancelledError';
  }
}

/** What the assignee is told, ahead of anything else it reads for the task. */
export function cancelNotice(taskId: string, by: string, reason?: string): string {
  return `[task:${taskId}] CANCELLED by "${by}"${reason ? ` (${reason})` : ''} — stop now, do not commit or report further work for it. Leave any uncommitted changes for it uncommitted, and do not call org_task_done for it.`;
}

/** Per role incarnation: which task the role's live process works on, and
 *  the handle that ends that process. */
export class TaskProcesses {
  private live?: { key: string; abort: AbortController };

  /** Called by the session loop for each task-scoped process; `release()`
   *  when it is gone. The signal aborts only when `key` is cancelled. */
  track(key: string): { signal: AbortSignal; release(): void } {
    const entry = { key, abort: new AbortController() };
    this.live = entry;
    return {
      signal: entry.abort.signal,
      release: () => {
        if (this.live === entry) this.live = undefined;
      },
    };
  }

  /** Ends the live process if it is working on `taskId`; the session loop
   *  then queues `notice`. */
  stop(taskId: string, notice: string): boolean {
    if (this.live?.key !== taskId || this.live.abort.signal.aborted) return false;
    this.live.abort.abort(new TaskCancelledError(taskId, notice));
    return true;
  }
}

/** After `task` is cancelled by `by`: tell its assignee and end the
 *  assignee's process for it. A role cancelling its own task is mid-call and
 *  already knows. */
export function stopCancelledTaskWork(
  running: RunningOrg,
  task: Pick<OrgTask, 'id' | 'assignee'>,
  by: string,
  reason?: string,
): void {
  if (task.assignee === by) return;
  const agent = running.agents.get(task.assignee);
  if (!agent || agent.mailbox.isClosed) return;
  const notice = cancelNotice(task.id, by, reason);
  const stopped = agent.taskProcesses?.stop(task.id, notice) ?? false;
  // Straight into the mailbox, not the dispatch coalescing window.
  if (!stopped) agent.mailbox.push(notice);
  running.bus.emit({
    type: 'status',
    from: by,
    to: task.assignee,
    reason: 'task-cancel-notified',
    msg: `"${task.assignee}" told task ${task.id} is cancelled${stopped ? ' — its process for the task was ended' : ''}`,
    data: { taskId: task.id, assignee: task.assignee, processStopped: stopped },
  });
}
