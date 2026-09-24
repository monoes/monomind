// packages/@monomind/cli/src/orgrt/dispatch-hold.ts
/**
 * Which lines held in a dispatch coalescing window (decisions.ts's
 * queueDispatch) belong to which task, so a cancel can withdraw them.
 *
 * A dispatch is held for DISPATCH_COALESCE_MS, and longer while its skill
 * suggestion resolves, but a cancel notice goes straight to the mailbox: the
 * assignee could read "CANCELLED" for a task it had not been given, then
 * receive the task and start it. A task the assignee never received is now
 * withdrawn from the window and needs no notice; a held line for a task that
 * was cancelled meanwhile is dropped at delivery.
 */

import type { RunningOrg } from './daemon.js';

type Line = string | Promise<string>;
type Held = NonNullable<RunningOrg['pendingDispatch']> extends Map<string, infer E> ? E : never;

/** Per run, in memory only: task ids whose lines have reached their
 *  assignee's mailbox. Empty after a checkpoint resume, which is right — a
 *  requeued task goes to a session that never saw it. */
const deliveredTasks = new WeakMap<RunningOrg, Set<string>>();

/** Record that `line`, held in `entry`, is about `taskId`; `received` when
 *  it is a follow-up on a task the assignee already has, not its dispatch. */
export function holdTaskLine(
  running: RunningOrg,
  entry: Held,
  line: Line,
  taskId: string,
  received: boolean,
): void {
  if (!entry.tasks) entry.tasks = new Map();
  entry.tasks.set(line, taskId);
  if (received) markReceived(running, taskId);
}

function markReceived(running: RunningOrg, taskId: string): void {
  let seen = deliveredTasks.get(running);
  if (!seen) deliveredTasks.set(running, (seen = new Set()));
  seen.add(taskId);
}

/** Await every held line, again while lines keep joining or leaving, and
 *  return the settled snapshot with its resolved text. */
export async function resolveHeld(entry: Held): Promise<{ held: Line[]; lines: string[] }> {
  let held: Line[] = [];
  let lines: string[] = [];
  const same = () =>
    held.length === entry.lines.length && held.every((l, i) => l === entry.lines[i]);
  while (!same()) {
    held = [...entry.lines];
    lines = await Promise.all(held);
  }
  return { held, lines };
}

/** The resolved lines still worth delivering: a line about a task that is
 *  cancelled by now is dropped. The tasks of the delivered lines are recorded. */
export function settleHeld(
  running: RunningOrg,
  entry: Held,
  held: Line[],
  lines: string[],
): string[] {
  const out: string[] = [];
  lines.forEach((text, i) => {
    const taskId = entry.tasks?.get(held[i]);
    if (taskId === undefined) return void out.push(text);
    if (running.taskDag?.get(taskId)?.status === 'cancelled') return;
    markReceived(running, taskId);
    out.push(text);
  });
  return out;
}

/** Withdraw every line held for `taskId` in `assignee`'s window. `received`
 *  says whether the assignee has had a line about the task before. */
export function withdrawHeldTask(
  running: RunningOrg,
  assignee: string,
  taskId: string,
): { withdrawn: boolean; received: boolean } {
  const received = deliveredTasks.get(running)?.has(taskId) ?? false;
  const entry = running.pendingDispatch?.get(assignee);
  let withdrawn = false;
  for (const [line, id] of entry?.tasks ?? []) {
    if (id !== taskId) continue;
    entry!.tasks!.delete(line);
    for (let at = entry!.lines.indexOf(line); at >= 0; at = entry!.lines.indexOf(line))
      entry!.lines.splice(at, 1);
    withdrawn = true;
  }
  return { withdrawn, received };
}
