// packages/@monomind/cli/src/orgrt/task-provenance.ts
/**
 * How a task's assignee and skills were chosen, recorded on the task (and so
 * in the checkpoint) and audited on the bus: an `assignee: "auto"` pick
 * (OrgTask.assignedBy / OrgTask.pick), the skills its dispatch suggested
 * (OrgTask.suggestedSkills) and which of those the assignee then loaded
 * (OrgTask.loadedSkills). Re-exported by decisions.ts.
 */

import { suggestTaskSkills } from '../decision/picks.js';
import type { OrgDaemon, RunningOrg } from './daemon.js';
import { taskTag } from './loadouts.js';
import { roleSkillNames } from './skill-library.js';
import { isTerminalStatus, type OrgTask } from './task-dag.js';
import type { TaskPick } from './task-match.js';

/** A new task's provenance: explicit, or auto-assigned with its `pick`. */
export function recordTaskPick(
  running: RunningOrg,
  task: OrgTask,
  role: string,
  pick?: TaskPick,
): void {
  task.assignedBy = pick ? 'auto' : 'explicit';
  if (!pick) return;
  task.pick = pick;
  running.bus.emit({
    type: 'audit',
    from: role,
    to: task.assignee,
    reason: 'task-auto-assigned',
    msg: `task ${task.id} auto-assigned to ${task.assignee} (${pick.method})`,
    data: { taskId: task.id, assignee: task.assignee, ...pick },
  });
}

/** The dispatch message for a task. When the assignee has on-demand skills,
 *  it also names the ones that fit THIS task (Jev when configured, otherwise
 *  a keyword match over the pool), records them on the task and audits the
 *  suggestion. That goes in the message, never the system prompt (ADR-O001
 *  D7: per-task guidance is not cached). Otherwise it is the plain line,
 *  returned synchronously. The promise never rejects. */
export function dispatchLine(
  daemon: OrgDaemon,
  running: RunningOrg,
  task: OrgTask,
): string | Promise<string> {
  // The brief rides the dispatch itself so it arrives with the task however
  // late that is — a separate org_send can miss the coalescing window (decisions.ts).
  const base = `${taskTag(task)} ${task.title}${task.brief ? `\n\n${task.brief}` : ''}`;
  const role = running.def?.roles.find((r) => r.id === task.assignee);
  if (!role) return base;
  const pinned = new Set(role.skills ?? []);
  const pool = roleSkillNames(role, daemon.root).filter((n) => !pinned.has(n));
  if (pool.length === 0) return base;
  let method: 'jev' | 'keyword' = 'keyword';
  return suggestTaskSkills(task.title, pool, daemon.root, {
    brief: task.brief,
    history: running.taskDag?.all(),
    onMethod: (m) => {
      method = m;
    },
  }).then(
    (names) => {
      if (!names.length) return base;
      task.suggestedSkills = names;
      running.bus.emit({
        type: 'audit',
        from: task.assignee,
        reason: 'task-skills-suggested',
        msg: `task ${task.id}: suggested ${names.join(', ')} (${method})`,
        data: { taskId: task.id, assignee: task.assignee, skills: names, method },
      });
      return `${base}\nSkills that fit this task (load with org_skill_load): ${names.join(', ')}`;
    },
    () => base,
  );
}

/** org_skill_load served `skill` to `role`: record it on the role's open
 *  tasks whose dispatch suggested it, and audit the load either way, so
 *  suggestion adherence can be measured from the bus or the checkpoint. */
export function recordSkillLoad(
  running: RunningOrg | undefined,
  role: string,
  skill: string,
): void {
  if (!running) return;
  const suggestedBy: string[] = [];
  for (const t of running.taskDag?.all() ?? []) {
    if (t.assignee !== role || isTerminalStatus(t.status)) continue;
    if (!t.suggestedSkills?.includes(skill)) continue;
    t.loadedSkills = [...new Set([...(t.loadedSkills ?? []), skill])];
    suggestedBy.push(t.id);
  }
  running.bus.emit({
    type: 'audit',
    from: role,
    reason: 'skill-loaded',
    msg: `${role} loaded skill ${skill}${suggestedBy.length ? ` (suggested by ${suggestedBy.join(', ')})` : ''}`,
    data: { skill, suggested: suggestedBy.length > 0, taskIds: suggestedBy },
  });
}

/** Open (not finished) tasks assigned to `role` — the auto-assign tie-break. */
export function openTaskCount(running: RunningOrg | undefined, role: string): number {
  return (running?.taskDag?.all() ?? []).filter(
    (t) => t.assignee === role && !isTerminalStatus(t.status),
  ).length;
}
