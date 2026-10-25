// packages/@monomind/cli/src/orgrt/role-reset-swap.ts
// org_compact_role / org_clear_role: replace a role's session with a fresh one
// under the SAME effective configuration. The incarnation swap is the one
// org_respawn_role does (role-respawn.ts steps 6-13), minus the config change
// and the briefing, and it counts against max_role_resets, not max_role_respawns.
import { holdReplacedRoleForBudget, orgCeilingDetail } from './budget-closure.js';
import type { OrgDaemon } from './daemon.js';
import type { AgentRuntime, RunningOrg } from './daemon-types.js';
import { computeReplacementBudget, type ResetReceipt, type RoleSlot } from './role-slot.js';

export interface SwapRequest {
  daemon: OrgDaemon;
  name: string;
  running: RunningOrg;
  slot: RoleSlot;
  roleId: string;
  callerId: string;
  kind: 'compact' | 'clear';
  reason: string;
  /** Opens the fresh session; delivered ahead of the queued mail. */
  seed: string;
  summaryChars: number;
}

export async function swapIncarnation(req: SwapRequest): Promise<ResetReceipt> {
  const { daemon, name, running, slot, roleId, callerId, kind, reason, seed } = req;
  const fail = (error: string): ResetReceipt => ({
    success: false,
    roleId,
    generation: slot.generation,
    summaryChars: req.summaryChars,
    error,
  });
  const audit = (auditReason: string, msg: string): void => {
    running.bus.emit({
      type: 'audit',
      from: callerId,
      reason: auditReason,
      msg,
      data: { roleId, kind, reason, generation: slot.generation, resetCount: slot.resetCount },
    });
  };
  const stillOwned = (): boolean =>
    daemon.orgs.get(name) === running && running.roleSlots.get(roleId) === slot;
  const abandoned = (): ResetReceipt => {
    running.respawning.delete(roleId);
    return fail(`org "${name}" stopped or restarted during the ${kind}`);
  };

  const rc = running.def.run_config;
  const oldRuntime = slot.runtime!;
  const newGeneration = slot.generation + 1;
  // Bump now so the old generation's crash-retry loop sees itself superseded.
  slot.generation = newGeneration;
  slot.phase = 'draining';
  slot.resetCount = (slot.resetCount ?? 0) + 1;
  audit('role-reset-started', `${kind} of role "${roleId}": ${reason}`);

  slot.queuedDuringSwap.push(...oldRuntime.mailbox.beginDrain());
  const drained = await Promise.race([
    oldRuntime.done.then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), rc.respawn_drain_timeout_ms ?? 30_000)),
  ]);
  if (!stillOwned()) return abandoned();
  if (!drained) {
    slot.abort?.abort();
    const stopped = await Promise.race([
      oldRuntime.done.then(() => true).catch(() => true),
      new Promise<boolean>((r) =>
        setTimeout(() => r(false), rc.respawn_force_stop_timeout_ms ?? 5_000),
      ),
    ]);
    if (!stillOwned()) return abandoned();
    if (!stopped) {
      slot.phase = 'stuck';
      running.respawning.delete(roleId);
      audit('role-reset-failed', `role "${roleId}" could not be confirmed stopped; not reset`);
      return fail(`role "${roleId}" could not be confirmed stopped; not reset`);
    }
  }
  // Mail abandoned mid-yield by a forced stop is redelivered (at-least-once).
  oldRuntime.mailbox.reclaimInFlight();
  const reclaimedQueue = oldRuntime.mailbox.serialize().queue;
  const reclaimed = { start: slot.queuedDuringSwap.length, count: reclaimedQueue.length };
  slot.queuedDuringSwap.push(...reclaimedQueue);
  // Retire the old spend into the slot: a reset must not reset the org's spend.
  const retiredBefore = { ...slot.retiredUsage };
  slot.retiredUsage = {
    tokens: retiredBefore.tokens + oldRuntime.policy.budgetedUsage,
    costUsd: retiredBefore.costUsd + (oldRuntime.metrics.costUsd ?? 0),
  };

  const cancelForBudget = (detail: string, stopped?: AgentRuntime): ResetReceipt => {
    slot.retiredUsage = {
      tokens: retiredBefore.tokens + (stopped?.policy.budgetedUsage ?? 0),
      costUsd: retiredBefore.costUsd + (stopped?.metrics.costUsd ?? 0),
    };
    slot.queuedDuringSwap.splice(reclaimed.start, reclaimed.count);
    slot.resetCount = Math.max(0, (slot.resetCount ?? 1) - 1);
    slot.phase = 'running';
    running.respawning.delete(roleId);
    holdReplacedRoleForBudget(running, roleId, detail);
    audit('role-reset-cancelled', `role "${roleId}" not reset: ${detail}`);
    return fail(`reset cancelled: ${detail}`);
  };
  if (running.orgBudgetClosed) return cancelForBudget(orgCeilingDetail(running));

  // The replacement keeps the slot's effective configuration and gets the
  // normal per-role allocation (never more than startup would give it).
  const { runtime: newRuntime, abort: newAbort } = daemon.spawnRoleIncarnation(
    name,
    running,
    slot.effectiveRole,
    newGeneration,
    { budgetTokensOverride: computeReplacementBudget(running.def, roleId) },
  );
  newRuntime.mailbox.push(seed);
  for (const queued of slot.queuedDuringSwap) newRuntime.mailbox.push(queued);
  if (running.def.roles.find((r) => r.id === roleId)?.budget_usd !== undefined) {
    newRuntime.policy.setUsageUsd(slot.retiredUsage.costUsd);
  }
  const startTimeoutMs = rc.respawn_start_timeout_ms ?? 60_000;
  const ready = await Promise.race([
    newRuntime.done.then(() => newRuntime.status !== 'crashed'),
    new Promise<boolean>((r) => setTimeout(() => r(true), startTimeoutMs)),
  ]);
  if (!stillOwned()) {
    newAbort.abort();
    return abandoned();
  }
  if (running.orgBudgetClosed) {
    newAbort.abort();
    newRuntime.mailbox.close('token-budget');
    return cancelForBudget(orgCeilingDetail(running), newRuntime);
  }
  if (!ready) {
    newAbort.abort();
    try {
      const { runtime: back, abort: backAbort } = daemon.spawnRoleIncarnation(
        name,
        running,
        slot.effectiveRole,
        newGeneration + 1,
        {},
      );
      for (const queued of slot.queuedDuringSwap) back.mailbox.push(queued);
      running.agents.set(roleId, back);
      slot.runtime = back;
      slot.abort = backAbort;
      slot.generation = newGeneration + 1;
      slot.phase = 'running';
      slot.queuedDuringSwap = [];
      running.respawning.delete(roleId);
      audit('role-reset-failed', `role "${roleId}" fresh session did not start; rolled back`);
      return fail('fresh session failed to start; restarted the role without the reset');
    } catch (err) {
      slot.phase = 'crashed';
      running.respawning.delete(roleId);
      audit('role-reset-failed', `fresh session and rollback both failed: ${String(err)}`);
      return fail(`reset and rollback both failed; role "${roleId}" is unavailable`);
    }
  }

  running.agents.set(roleId, newRuntime);
  slot.runtime = newRuntime;
  slot.abort = newAbort;
  slot.generation = newGeneration;
  slot.phase = 'running';
  slot.queuedDuringSwap = [];
  running.respawning.delete(roleId);
  audit(
    kind === 'compact' ? 'role-compacted' : 'role-cleared',
    `role "${roleId}" ${kind === 'compact' ? 'compacted' : 'cleared'} (generation ${newGeneration}): ${reason}`,
  );
  daemon.persistState(name, 'running', running.run);
  return { success: true, roleId, generation: newGeneration, summaryChars: req.summaryChars };
}
