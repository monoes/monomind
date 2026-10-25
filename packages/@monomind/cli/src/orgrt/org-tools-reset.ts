// packages/@monomind/cli/src/orgrt/org-tools-reset.ts
// The coordinator-only org_compact_role / org_clear_role tools (see role-reset.ts).
import { z } from 'zod';
import type { OrgToolDef } from './agent-runner.js';
import type { SessionOpts } from './session-types.js';

const WHAT = {
  org_compact_role:
    'asks the role for a summary of its session (goal, decisions, key facts and paths, what is still open), then continues it in a FRESH session opened with that summary',
  org_clear_role:
    'continues the role in a FRESH session with no memory of the old conversation; refused with the task ids while the role still owns open tasks (check org_tasks first)',
} as const;

/** One tool per handler the daemon wired (only the selected coordinator gets them). */
export function resetRoleTools(opts: SessionOpts): OrgToolDef[] {
  const tools: OrgToolDef[] = [];
  const handlers = [
    ['org_compact_role', opts.onCompactRole],
    ['org_clear_role', opts.onClearRole],
  ] as const;
  for (const [name, handler] of handlers) {
    if (!handler) continue;
    tools.push({
      name,
      description: `Release the context of one WORKER role that is done or bloated: ${WHAT[name]}. Keeps its role id, workspace, task ownership, and queued messages. Cannot target the coordinator (yourself) or an unknown/removed/not-yet-started role, a role mid-replacement, or a role with a turn running (wait for it or stop it). Does not use up max_role_respawns; limited per role by run_config.max_role_resets. reason is a short operational reason for the audit log.`,
      schema: { roleId: z.string(), reason: z.string() },
      handler: async (args) => ({
        text: JSON.stringify(await handler(opts.role.id, args as any)),
      }),
    });
  }
  return tools;
}
