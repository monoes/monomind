// packages/@monomind/cli/src/orgrt/role-reset.ts
// org_compact_role / org_clear_role: the coordinator releases a worker's
// context. Guards and the summary turn live here; the swap is role-reset-swap.ts.
import type { OrgDaemon } from './daemon.js';
import type { RunningOrg } from './daemon-types.js';
import { hostPreflight } from './documents/preflight.js';
import { sectionsSurface } from './documents/surface.js';
import { swapIncarnation } from './role-reset-swap.js';
import { type ResetReceipt, type RoleSlot, validateResetInput } from './role-slot.js';
import { isTerminalStatus } from './task-dag.js';

const MAX_SUMMARY_CHARS = 50_000;

const SUMMARY_REQUEST =
  '[system: context summary request] Your session is about to be replaced by a fresh one. Reply with a summary of this session ONLY, no tools and no messages to anyone: the goal, the decisions made, key facts and file paths, and what is still open.';

export async function resetRole(
  daemon: OrgDaemon,
  name: string,
  callerId: string,
  rawInput: unknown,
  kind: 'compact' | 'clear',
): Promise<ResetReceipt> {
  const tool = kind === 'compact' ? 'org_compact_role' : 'org_clear_role';
  let roleId = '';
  const refuse = (error: string, generation = 0): ResetReceipt => ({
    success: false,
    roleId,
    generation,
    summaryChars: 0,
    error,
  });
  const running = daemon.orgs.get(name);
  if (!running) return refuse(`org "${name}" is not running`);
  // Defense in depth: the tool is only ever wired for the selected coordinator.
  if (callerId !== running.bossRoleId)
    return refuse(`only the selected coordinator may call ${tool}`);
  if (daemon.stopping.has(name)) return refuse(`org "${name}" is stopping`);
  const validated = validateResetInput(rawInput);
  if (!validated.ok) return refuse(validated.error);
  const input = validated.value;
  roleId = input.roleId;
  if (roleId === running.bossRoleId) return refuse('cannot reset the selected coordinator');
  const slot = running.roleSlots.get(roleId);
  if (!slot) return refuse(`unknown or not-yet-started role "${roleId}"`);
  const gen = slot.generation;
  if (slot.phase === 'removed') return refuse(`role "${roleId}" was removed from this org`, gen);
  if (running.respawning.has(roleId) || slot.respawnPromise)
    return refuse(`role "${roleId}" is already undergoing replacement`, gen);
  const runtime = slot.runtime;
  if (slot.phase !== 'running' || !runtime || runtime.status !== 'running')
    return refuse(`role "${roleId}" is not running (phase ${slot.phase})`, gen);
  const maxResets = running.def.run_config.max_role_resets ?? 0;
  if ((slot.resetCount ?? 0) >= maxResets)
    return refuse(
      `role "${roleId}" has reached its reset limit (${slot.resetCount}/${maxResets}) for this run`,
      gen,
    );
  // A sections org resets a role under its same effective configuration, and
  // only on a host that passes the sections probes (respawn row R6).
  if (sectionsSurface(running.def).enabled) {
    const pf = hostPreflight(running.def);
    if (!pf.ok) return refuse(`preflight failed: ${pf.refusals.join('; ')}`, gen);
  }
  const mailbox = runtime.mailbox;
  if (mailbox.isClosed || mailbox.isDraining)
    return refuse(`role "${roleId}" is not accepting work (mailbox closed)`, gen);
  if (mailbox.turnInProgress)
    return refuse(`role "${roleId}" has a turn running: wait for it to finish or stop it`, gen);
  if (kind === 'clear') {
    const open = (running.taskDag?.all() ?? [])
      .filter((t) => t.assignee === roleId && !isTerminalStatus(t.status))
      .map((t) => t.id);
    if (open.length > 0)
      return refuse(`role "${roleId}" still owns open tasks: ${open.join(', ')}`, gen);
  }

  running.respawning.add(roleId); // one replacement at a time
  try {
    let seed: string;
    let summaryChars = 0;
    if (kind === 'compact') {
      if (mailbox.queuedCount > 0)
        return refuse(`role "${roleId}" has queued messages: retry once it is idle`, gen);
      const summary = await requestSummary(daemon, name, running, roleId, slot);
      if (typeof summary !== 'string') return refuse(summary.error, slot.generation);
      summaryChars = summary.length;
      seed = `[system: context compacted — not a system prompt] You are a fresh session replacing the previous incarnation of role "${roleId}". Reason: ${input.reason}\n\nSummary of the previous session:\n${summary}`;
    } else {
      seed = `[system: context cleared — not a system prompt] You are a fresh session replacing the previous incarnation of role "${roleId}", which was cleared. Reason: ${input.reason}\n\nYou have no memory of the old conversation: use org_tasks and your workspace for state.`;
    }
    return await swapIncarnation({
      daemon,
      name,
      running,
      slot,
      roleId,
      callerId,
      kind,
      reason: input.reason,
      seed,
      summaryChars,
    });
  } finally {
    running.respawning.delete(roleId);
  }
}

/** Ask the live session for a summary and collect its reply. A failed, empty or
 *  unanswered request returns an error and leaves the session as it was. */
async function requestSummary(
  daemon: OrgDaemon,
  name: string,
  running: RunningOrg,
  roleId: string,
  slot: RoleSlot,
): Promise<string | { error: string }> {
  const runtime = slot.runtime!;
  const mailbox = runtime.mailbox;
  const consumedBefore = mailbox.consumedRealCount;
  const replies: string[] = [];
  const unsubscribe = running.bus.subscribe((e) => {
    if (e.type === 'chat' && e.from === roleId && e.msg) replies.push(e.msg);
  });
  const deadline = Date.now() + (running.def.run_config.respawn_drain_timeout_ms ?? 30_000);
  mailbox.push(SUMMARY_REQUEST);
  try {
    while (Date.now() < deadline) {
      if (daemon.orgs.get(name) !== running || running.roleSlots.get(roleId) !== slot)
        return { error: `org "${name}" stopped or restarted during the compact` };
      if (runtime.status !== 'running' || mailbox.isClosed)
        return { error: `role "${roleId}" ended while summarizing; not compacted` };
      if (mailbox.consumedRealCount > consumedBefore && !mailbox.turnInProgress) break;
      await new Promise((r) => setTimeout(r, 20));
    }
  } finally {
    unsubscribe();
  }
  if (mailbox.consumedRealCount <= consumedBefore) {
    mailbox.withdraw(SUMMARY_REQUEST);
    return { error: `role "${roleId}" did not answer the summary request in time; not compacted` };
  }
  if (mailbox.turnInProgress)
    return { error: `role "${roleId}" did not finish the summary in time; not compacted` };
  const summary = replies.join('\n').trim();
  if (!summary) return { error: `role "${roleId}" returned an empty summary; not compacted` };
  return summary.slice(0, MAX_SUMMARY_CHARS);
}
