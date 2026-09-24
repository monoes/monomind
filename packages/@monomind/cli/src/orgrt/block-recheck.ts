// packages/@monomind/cli/src/orgrt/block-recheck.ts
/**
 * #329: a task blocked with org_task_block used to sleep until its deadline.
 * Nothing external reaches a blocked task — a background command's
 * completion, a Monitor event and npm propagation all live (at most) in the
 * role's own process stream, which idle-cycling may already have ended — so a
 * block set "until 11:00Z" on a four-minute install idled for half an hour.
 *
 * Every block is now re-checked: its assignee is woken on a bounded interval
 * and asked whether what it was waiting for has happened, until the deadline
 * (unblockExpired) or a close. The schedule lives on the task row
 * (`recheckAt` / `recheckEveryMs`), so it survives process cycling and
 * checkpoint resume; a tick that runs late — the daemon was down across the
 * due time — fires once, then resumes the interval from now.
 */

import type { RunningOrg } from './daemon.js';
import { taskTag } from './loadouts.js';
import type { OrgTask } from './task-dag.js';
import { MAX_BLOCK_RECHECK_MINUTES } from './types.js';

export { MAX_BLOCK_RECHECK_MINUTES };
export const DEFAULT_BLOCK_RECHECK_MINUTES = 5;
/** Floor for a role's own recheckAfterMinutes: a wake is a model turn. */
export const MIN_BLOCK_RECHECK_MINUTES = 1;

/** The re-check interval for one block: the role's own request (clamped to
 *  [MIN, MAX]) if it made one, else run_config.block_recheck_minutes (bounded
 *  by the schema), else the default. */
export function blockRecheckMs(orgMinutes?: number, requestedMinutes?: number): number {
  const minutes =
    requestedMinutes !== undefined
      ? Math.min(MAX_BLOCK_RECHECK_MINUTES, Math.max(MIN_BLOCK_RECHECK_MINUTES, requestedMinutes))
      : (orgMinutes ?? DEFAULT_BLOCK_RECHECK_MINUTES);
  return minutes * 60_000;
}

function recheckLine(task: OrgTask): string {
  const until = task.blockedUntil ? new Date(task.blockedUntil).toISOString() : 'unknown';
  return (
    `${taskTag(task)} still blocked (reason: ${task.blockedReason ?? 'none given'}; until ${until}) — ` +
    `re-check now whether what you were waiting for has happened. If it has, finish the task and close it with org_task_done; ` +
    `if it is still pending, call org_task_block again (a new untilIso, optionally recheckAfterMinutes); ` +
    `if it cannot happen, report that via org_send. Nothing external (background commands, Monitor, npm) wakes a blocked task — ` +
    `run waits in the foreground instead.`
  );
}

/** Wake the assignee of every blocked task whose re-check is due, and move
 *  its next re-check one interval on. Called on every idle-watchdog tick,
 *  next to the block-expiry resume. Returns the tasks it woke. */
export function wakeDueBlockRechecks(
  running: Pick<RunningOrg, 'taskDag' | 'agents' | 'bus' | 'def'>,
  now: number,
): OrgTask[] {
  if (!running.taskDag) return [];
  const orgEvery = blockRecheckMs(running.def.run_config.block_recheck_minutes);
  const due: OrgTask[] = [];
  for (const task of running.taskDag.all()) {
    if (task.status !== 'blocked' || (task.blockedUntil ?? 0) <= now) continue;
    const every = task.recheckEveryMs ?? orgEvery;
    // A block from a checkpoint written before re-checks existed: schedule it.
    if (task.recheckAt === undefined) {
      task.recheckEveryMs = every;
      task.recheckAt = now + every;
      continue;
    }
    if (task.recheckAt > now) continue;
    task.recheckAt = now + every;
    due.push(task);
    const agent = running.agents.get(task.assignee);
    const delivered = !!agent && !agent.mailbox.isClosed;
    if (delivered) agent.mailbox.push(recheckLine(task));
    running.bus.emit({
      type: 'status',
      from: 'dag',
      reason: 'task-block-recheck',
      msg: `task ${task.id} still blocked — ${delivered ? 'asked' : 'could not reach'} ${task.assignee} to re-check it`,
      data: {
        taskId: task.id,
        assignee: task.assignee,
        delivered,
        blockedUntil: task.blockedUntil,
        nextRecheckAt: task.recheckAt,
      },
    });
  }
  return due;
}
