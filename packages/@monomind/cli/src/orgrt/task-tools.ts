// packages/@monomind/cli/src/orgrt/task-tools.ts
/**
 * The org_task tool: creates a DAG task, optionally with `assignee: "auto"`,
 * which has SessionOpts.pickAssignee choose the role from the title and brief
 * and records how it chose on the task (OrgTask.pick). Built by session.ts's
 * buildOrgTools, in the same place in the tool list as before.
 */

import { z } from 'zod';
import type { OrgToolDef } from './agent-runner.js';
import {
  BRIEF_FIELD_HELP,
  type BriefFields,
  briefFieldArgs,
  checkBrief,
  contextSurface,
  withWarnings,
} from './context-surface.js';
import { taskAssignmentRefusal } from './documents/lead-rules.js';
import type { LoadoutSummary } from './loadouts.js';
import { checkPacket, REFERENCES_HELP, referencesArg, type TaskReferences } from './packet.js';
import type { SessionOpts } from './session.js';
import { MAX_TASK_BRIEF } from './task-dag.js';
import type { RolePick, TaskPick } from './task-match.js';

/** org_task's assignee value that asks for automatic role selection. */
export const AUTO_ASSIGNEE = 'auto';

/** ADR-O001 D7: org_task's description suffix for an org with a catalog. */
function loadoutHelp(catalog: LoadoutSummary[]): string {
  const list = catalog
    .map((l) => (l.description ? `${l.name} (${l.description})` : l.name))
    .join(', ');
  return ` Optionally select a "loadout" — the named, stable specialisation the assignee's session is built with: ${list}. Select by kind of work; put everything specific to this task (which diff, criteria, what failed last time) in its "brief", not in the choice of loadout. The selection is recorded on the task and reused on every retry.`;
}

/** An `assignee: "auto"` pick: the chosen role with its provenance for
 *  OrgTask.pick, or the error telling the caller to name the assignee. */
export function autoAssignment(
  picked: RolePick,
): { assignee: string; pick: TaskPick } | { error: string } {
  if (!picked.role) {
    const close = picked.candidates.map((c) => c.id).join(', ');
    return {
      error:
        picked.reason === 'ambiguous'
          ? `assignee "${AUTO_ASSIGNEE}": no role fits this task title better than the others (${close}) — name the assignee explicitly`
          : `assignee "${AUTO_ASSIGNEE}": no role fits this task title — name the assignee explicitly`,
    };
  }
  return {
    assignee: picked.role,
    pick: {
      method: picked.method as TaskPick['method'],
      ...(picked.confidence !== undefined ? { confidence: picked.confidence } : {}),
      ...(picked.score !== undefined ? { score: picked.score } : {}),
      candidates: picked.candidates,
    },
  };
}

/** org_task, or undefined when the session has no createTask. `loadoutArg`
 *  and `briefArg` are shared with org_plan_graph. */
export function orgTaskTool(
  opts: SessionOpts,
  loadoutArg: Record<string, z.ZodType>,
  briefArg: z.ZodType,
): OrgToolDef | undefined {
  const { role, createTask } = opts;
  if (!createTask) return undefined;
  const catalog = opts.loadoutCatalog?.length ? opts.loadoutCatalog : undefined;
  const text = (t: string): { text: string } => ({ text: t });
  // Phase 2 opt-in: typed brief fields exist only for an org that adopted a context key.
  const surface = contextSurface(opts.def);
  return {
    name: 'org_task',
    description:
      `Create a task in the DAG with optional dependencies. Dependencies must be existing task IDs. Tasks become ready when all deps are done, then get dispatched to the assignee. Put the assignee's instructions — scope, acceptance criteria, paths, what failed last time — in \`brief\` (up to ${MAX_TASK_BRIEF} characters): it is delivered in the same message as the title whenever the task is dispatched, while a separate org_send can arrive after the assignee has already started.` +
      (opts.pickAssignee
        ? ` Set assignee to "${AUTO_ASSIGNEE}" to have the role chosen for you from the task title and brief.`
        : '') +
      (catalog ? loadoutHelp(catalog) : '') +
      (surface.enabled ? BRIEF_FIELD_HELP + REFERENCES_HELP : ''),
    schema: {
      title: z.string(),
      assignee: z.string(),
      deps: z.array(z.string()).default([]),
      brief: briefArg,
      ...(surface.enabled ? { ...briefFieldArgs(), references: referencesArg } : {}),
      ...loadoutArg,
    },
    strict: { hints: { after: 'use `deps` with task ids' } },
    handler: async (args) => {
      let assignee = args.assignee as string;
      let pick: TaskPick | undefined;
      let brief = args.brief as string | undefined;
      let warnings: string[] = [];
      if (surface.enabled) {
        const checked = checkBrief(surface, args as BriefFields, brief, 'task');
        if (checked.error) return text(JSON.stringify({ error: checked.error }));
        ({ brief, warnings } = checked);
        const tooBig = checkPacket({
          title: args.title as string,
          brief,
          references: args.references as TaskReferences | undefined,
        });
        if (tooBig) return text(JSON.stringify({ error: `task: ${tooBig}` }));
      }
      if (assignee === AUTO_ASSIGNEE && opts.pickAssignee) {
        const picked = autoAssignment(
          await opts.pickAssignee(args.title as string, brief, role.id),
        );
        if ('error' in picked) return text(JSON.stringify({ error: picked.error }));
        ({ assignee, pick } = picked);
      }
      // Org sections (plan P4.9): only a session with a documents host; no other org is asked.
      const refused = opts.documents && opts.def && taskAssignmentRefusal(opts.def, role.id, assignee);
      if (refused) return text(JSON.stringify({ error: refused }));
      const refs = args.references as TaskReferences | undefined;
      const deps = (args.deps as string[]) ?? [];
      const loadout = args.loadout as string | undefined;
      // Trailing arguments only when there is something to pass, so a plain task is created exactly as before.
      const created = refs
        ? createTask(role.id, args.title as string, assignee, deps, loadout, brief, pick, refs)
        : pick
          ? createTask(role.id, args.title as string, assignee, deps, loadout, brief, pick)
          : createTask(role.id, args.title as string, assignee, deps, loadout, brief);
      return text(withWarnings(created, warnings));
    },
  };
}
