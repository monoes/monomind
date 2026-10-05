// packages/@monomind/cli/src/orgrt/role-respawn.ts
// Extracted from daemon.ts — org_respawn_role: mid-run replacement of one role.
import { holdReplacedRoleForBudget, orgCeilingDetail } from './budget-closure.js';
import type { OrgDaemon } from './daemon.js';
import type { AgentRuntime } from './daemon-types.js';
import { hostPreflight } from './documents/preflight.js';
import { sectionsSurface } from './documents/surface.js';
import { resolveRoleProvider } from './provider.js';
import {
  buildRespawnReceipt,
  computeReplacementBudget,
  mergeEffectiveRoleConfig,
  type RespawnReceipt,
  redactRoleConfig,
  validateRespawnInput,
} from './role-slot.js';
import { resolveRoleRunner } from './runner-resolve.js';

/** org_respawn_role's daemon-owned implementation. See the design doc's
 *  "Replacement algorithm" (13 steps) — this method's body follows those
 *  steps in order, numbered in comments. */
export async function respawnRole(
  daemon: OrgDaemon,
  name: string,
  callerId: string,
  rawInput: unknown,
): Promise<RespawnReceipt> {
  const running = daemon.orgs.get(name);
  if (!running) {
    return {
      success: false,
      roleId: '',
      generation: 0,
      respawnCount: 0,
      respawnsRemaining: 0,
      error: `org "${name}" is not running`,
    };
  }
  // Step 1: authorize (defense in depth — buildOrgTools only ever wires
  // onRespawnRole for the selected coordinator, but re-check here too).
  if (callerId !== running.bossRoleId) {
    return {
      success: false,
      roleId: '',
      generation: 0,
      respawnCount: 0,
      respawnsRemaining: 0,
      error: 'only the selected coordinator may call org_respawn_role',
    };
  }
  if (daemon.stopping.has(name)) {
    return {
      success: false,
      roleId: '',
      generation: 0,
      respawnCount: 0,
      respawnsRemaining: 0,
      error: `org "${name}" is stopping`,
    };
  }
  const validated = validateRespawnInput(rawInput);
  if (!validated.ok) {
    return {
      success: false,
      roleId: '',
      generation: 0,
      respawnCount: 0,
      respawnsRemaining: 0,
      error: validated.error,
    };
  }
  const input = validated.value;
  if (input.roleId === running.bossRoleId) {
    return {
      success: false,
      roleId: input.roleId,
      generation: 0,
      respawnCount: 0,
      respawnsRemaining: 0,
      error: 'cannot replace the selected coordinator',
    };
  }
  const slot = running.roleSlots.get(input.roleId);
  if (!slot) {
    return {
      success: false,
      roleId: input.roleId,
      generation: 0,
      respawnCount: 0,
      respawnsRemaining: 0,
      error: `unknown or not-yet-started role "${input.roleId}"`,
    };
  }
  const maxRespawns = running.def.run_config.max_role_respawns ?? 0;
  if (slot.phase === 'removed') {
    return buildRespawnReceipt(slot, maxRespawns, false, {
      roleId: input.roleId,
      error: `role "${input.roleId}" was removed from this org`,
    });
  }
  // Step 2: acquire the role slot (reject a concurrent replacement).
  if (running.respawning.has(input.roleId) || slot.respawnPromise) {
    return buildRespawnReceipt(slot, maxRespawns, false, {
      roleId: input.roleId,
      error: `role "${input.roleId}" is already undergoing replacement`,
    });
  }
  if (slot.respawnCount >= maxRespawns) {
    return buildRespawnReceipt(slot, maxRespawns, false, {
      roleId: input.roleId,
      error: `role "${input.roleId}" has reached its respawn limit (${slot.respawnCount}/${maxRespawns}) for this run`,
    });
  }
  // Step 3: resolve the candidate configuration.
  if (input.providerName !== undefined && slot.effectiveRole.provider) {
    return buildRespawnReceipt(slot, maxRespawns, false, {
      roleId: input.roleId,
      error: `role "${input.roleId}" has an inline provider, which always takes precedence over adapter_config.provider — replacing an inline provider is a separate design`,
    });
  }
  const candidateRole = mergeEffectiveRoleConfig(slot.effectiveRole, {
    runtime: input.runtime,
    model: input.model,
    providerName: input.providerName,
  });
  const budgetTokens = input.budgetTokens ?? computeReplacementBudget(running.def, input.roleId);

  // GA row R6: a sections org replaces a role under its same effective configuration,
  // and only on a host that passes the sections probes.
  if (sectionsSurface(running.def).enabled) {
    if (
      input.runtime !== undefined ||
      input.model !== undefined ||
      input.providerName !== undefined
    )
      return buildRespawnReceipt(slot, maxRespawns, false, {
        roleId: input.roleId,
        error: `role "${input.roleId}" belongs to a sections org: a replacement keeps its effective configuration, and a runtime, model or provider change needs a stop and restart`,
      });
    const pf = hostPreflight(running.def);
    if (!pf.ok)
      return buildRespawnReceipt(slot, maxRespawns, false, {
        roleId: input.roleId,
        error: `preflight failed: ${pf.refusals.join('; ')}`,
      });
  }
  // Step 4: preflight — must not mutate the old runtime.
  try {
    resolveRoleProvider(candidateRole, daemon.root);
  } catch (err) {
    return buildRespawnReceipt(slot, maxRespawns, false, {
      roleId: input.roleId,
      error: `preflight failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  // resolveRoleRunner's undefined return is the valid Claude default, not
  // an error — nothing further to validate for the runtime dimension here.
  resolveRoleRunner(
    candidateRole.runtime,
    running.def.runtime,
    candidateRole.provider?.kind,
    undefined,
    candidateRole.provider,
  );

  // Step 5: consume one attempt — only after validation/preflight succeed.
  running.respawning.add(input.roleId);
  slot.respawnCount++;
  running.bus.emit({
    type: 'audit',
    from: callerId,
    reason: 'role-respawn-started',
    msg: `replacing role "${input.roleId}": ${input.reason}`,
    data: {
      roleId: input.roleId,
      from: redactRoleConfig(slot.effectiveRole),
      to: redactRoleConfig(candidateRole),
      generation: slot.generation,
      caller: callerId,
    },
  });

  // Step 6: quiesce the old incarnation. Bump the generation NOW, before
  // draining starts — not at the final publish (step 11-13) — so the OLD
  // generation's crash-retry loop (spawnRoleIncarnation's isStaleGeneration
  // check) recognizes supersession immediately. Without this, a backoff
  // timer firing during the drain/force-stop window, or the forced abort's
  // own rejection, would still see itself as the current generation:
  // the abort's rejection doesn't match killedByStop's SIGTERM-only regex,
  // so it would run full terminal crash handling — a duplicate live runner
  // (mid-backoff restart) or a false worker-crashed notification, exactly
  // what the guard exists to prevent.
  const newGeneration = slot.generation + 1;
  slot.generation = newGeneration;
  slot.phase = 'draining';
  // Every await from here on can race a stop/restart of this org — verify
  // ownership before EVERY subsequent step, not just once before the final
  // publish, so a stale operation can never mutate accounting, force-stop
  // a runtime, or spawn into an org that's no longer the live one.
  const stillOwned = (): boolean =>
    daemon.orgs.get(name) === running && running.roleSlots.get(input.roleId) === slot;
  const abandonedReceipt = (): RespawnReceipt => {
    running.respawning.delete(input.roleId);
    return buildRespawnReceipt(slot, maxRespawns, false, {
      roleId: input.roleId,
      error: `org "${name}" stopped or restarted during replacement`,
    });
  };
  // The budget closed during the replacement: keep the (closed) old
  // incarnation, hold its tasks and report the replacement as not done.
  // The spend retired at step 9 and where step 8's reclaimed mail starts in
  // queuedDuringSwap — both undone if the replacement is cancelled.
  let retiredBefore = { ...slot.retiredUsage };
  let reclaimed = { start: 0, count: 0 };
  const cancelForBudget = (detail: string, stopped?: AgentRuntime): RespawnReceipt => {
    // The old incarnation stays in `agents`, where orgBudgetedUsage counts
    // its spend: un-retire it (step 9), or it is counted twice — and a
    // reopen (respawnFromCheckpoint) carries it over again. A replacement
    // stopped after it started retires what it spent in its start window,
    // which nothing else counts.
    slot.retiredUsage = {
      tokens: retiredBefore.tokens + (stopped?.policy.budgetedUsage ?? 0),
      costUsd: retiredBefore.costUsd + (stopped?.metrics.costUsd ?? 0),
    };
    // Mail swept out of the old mailbox rides in queuedDuringSwap; the
    // entries step 8 reclaimed are still in the old mailbox, so drop exactly
    // those (by position — mailbox entries carry no id). A reopen delivers
    // the rest (budget-closure.ts respawnFromCheckpoint).
    slot.queuedDuringSwap.splice(reclaimed.start, reclaimed.count);
    // Not a replacement: give back the max_role_respawns attempt.
    slot.respawnCount = Math.max(0, slot.respawnCount - 1);
    slot.phase = 'running';
    running.respawning.delete(input.roleId);
    holdReplacedRoleForBudget(running, input.roleId, detail);
    running.bus.emit({
      type: 'audit',
      from: callerId,
      reason: 'role-respawn-cancelled',
      msg: `role "${input.roleId}" not replaced: ${detail}`,
      data: { roleId: input.roleId },
    });
    return buildRespawnReceipt(slot, maxRespawns, false, {
      roleId: input.roleId,
      error: `replacement cancelled: ${detail}`,
    });
  };
  const oldRuntime = slot.runtime!;
  const sweptQueue = oldRuntime.mailbox.beginDrain();
  slot.queuedDuringSwap.push(...sweptQueue);
  const drainTimeoutMs = running.def.run_config.respawn_drain_timeout_ms ?? 30_000;
  const drained = await Promise.race([
    oldRuntime.done.then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), drainTimeoutMs)),
  ]);
  if (!stillOwned()) return abandonedReceipt();
  let drainTimedOut = false;
  if (!drained) {
    drainTimedOut = true;
    // Step 7: force stop.
    slot.abort?.abort();
    const forceStopMs = running.def.run_config.respawn_force_stop_timeout_ms ?? 5_000;
    const stopped = await Promise.race([
      oldRuntime.done.then(() => true).catch(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), forceStopMs)),
    ]);
    if (!stillOwned()) return abandonedReceipt();
    if (!stopped) {
      slot.phase = 'stuck';
      running.respawning.delete(input.roleId);
      running.bus.emit({
        type: 'audit',
        from: callerId,
        reason: 'role-respawn-failed',
        msg: `role "${input.roleId}" forced stop did not confirm termination — refusing to spawn a replacement`,
      });
      return buildRespawnReceipt(slot, maxRespawns, false, {
        roleId: input.roleId,
        error: `role "${input.roleId}" could not be confirmed stopped; not replaced`,
      });
    }
  }
  // Step 8: preserve durable role state (worktree path, task ownership, and
  // the DAG survive untouched — they live outside AgentRuntime/Mailbox
  // entirely, keyed by role.id, which never changes). Reclaim any message
  // abandoned mid-yield by a forced stop for at-least-once redelivery.
  oldRuntime.mailbox.reclaimInFlight();
  const reclaimedQueue = oldRuntime.mailbox.serialize().queue;
  reclaimed = { start: slot.queuedDuringSwap.length, count: reclaimedQueue.length };
  slot.queuedDuringSwap.push(...reclaimedQueue);
  // Step 9: retire accounting BEFORE replacing the runtime.
  retiredBefore = { ...slot.retiredUsage };
  slot.retiredUsage = {
    // Budgeted basis: this total is summed with live policy.budgetedUsage
    // against the org-wide budget_tokens ceiling (ADR-O001 D1), so the two
    // terms must share a basis.
    tokens: slot.retiredUsage.tokens + oldRuntime.policy.budgetedUsage,
    costUsd: slot.retiredUsage.costUsd + (oldRuntime.metrics.costUsd ?? 0),
  };

  // #557 review: the org-wide ceiling may have closed while the old
  // incarnation drained — don't start a replacement past it. (A role closed
  // for its own budget may be replaced — e.g. with a larger budgetTokens.)
  if (running.orgBudgetClosed) return cancelForBudget(orgCeilingDetail(running));

  // Step 10: spawn generation N+1 (generation already bumped in step 6).
  const { runtime: newRuntime, abort: newAbort } = daemon.spawnRoleIncarnation(
    name,
    running,
    candidateRole,
    newGeneration,
    { budgetTokensOverride: budgetTokens },
  );
  // Seed the new mailbox with everything swapped/reclaimed, delivered
  // FIFO, plus a delimited coordinator briefing appended last so it reads
  // as the newest context once the replacement starts its first turn.
  for (const queued of slot.queuedDuringSwap) newRuntime.mailbox.push(queued);
  newRuntime.mailbox.push(
    `[system: role replacement briefing — not a system prompt] You are a fresh session replacing the previous incarnation of role "${input.roleId}". Reason: ${input.reason}\n\n${input.briefing}`,
  );
  // Seed USD accounting from retained totals so a respawn cannot reset
  // role.budget_usd.
  if (running.def.roles.find((r) => r.id === input.roleId)?.budget_usd !== undefined) {
    newRuntime.policy.setUsageUsd(slot.retiredUsage.costUsd);
  }
  // "Ready" here means "did not crash within the startup window" — a
  // silent-but-healthy runner (one that never emits a chat/tool/usage
  // event, e.g. because it hasn't finished its first turn yet) must not be
  // misreported as a startup failure, so this does NOT wait for a positive
  // signal. It races the new incarnation's own crash-retry loop (which
  // shares this generation, so it is NOT superseded and behaves normally)
  // against the timeout: a config that fails immediately (bad model,
  // missing runtime binary, auth failure) crashes fast and newRuntime.done
  // resolves with status 'crashed' well before startTimeoutMs, correctly
  // failing readiness and triggering rollback.
  const startTimeoutMs = running.def.run_config.respawn_start_timeout_ms ?? 60_000;
  const ready = await Promise.race([
    newRuntime.done.then(() => newRuntime.status !== 'crashed'),
    new Promise<boolean>((r) => setTimeout(() => r(true), startTimeoutMs)),
  ]);

  // Step 11: publish atomically — verify ownership is still current.
  if (!stillOwned()) {
    newAbort.abort();
    return abandonedReceipt();
  }
  // #557 review: the org-wide ceiling may have closed during the start
  // window — enforceOrgBudget only closes runtimes in `agents`, so publishing
  // now would run the replacement past "closing all roles". Stop it instead.
  // (The replacement closing on its OWN budget in that window needs nothing
  // here: its session closed its mailbox and the budget-exhausted bus hook
  // already held the role's tasks.)
  if (running.orgBudgetClosed) {
    newAbort.abort();
    newRuntime.mailbox.close('token-budget');
    return cancelForBudget(orgCeilingDetail(running), newRuntime);
  }
  if (!ready) {
    // Step 12: rollback — one attempt with the prior effective config.
    newAbort.abort();
    running.bus.emit({
      type: 'audit',
      from: callerId,
      reason: 'role-respawn-failed',
      msg: `role "${input.roleId}" replacement did not become ready within ${startTimeoutMs}ms — attempting rollback`,
    });
    try {
      const { runtime: rolledBack, abort: rolledBackAbort } = daemon.spawnRoleIncarnation(
        name,
        running,
        slot.effectiveRole,
        newGeneration + 1,
        {},
      );
      for (const queued of slot.queuedDuringSwap) rolledBack.mailbox.push(queued);
      running.agents.set(input.roleId, rolledBack);
      slot.runtime = rolledBack;
      slot.abort = rolledBackAbort;
      slot.generation = newGeneration + 1;
      slot.phase = 'running';
      slot.queuedDuringSwap = [];
      running.respawning.delete(input.roleId);
      running.bus.emit({
        type: 'audit',
        from: callerId,
        reason: 'role-respawn-failed',
        msg: `role "${input.roleId}" replacement failed; rolled back to prior config`,
      });
      return buildRespawnReceipt(slot, maxRespawns, false, {
        roleId: input.roleId,
        drainTimedOut,
        error: `replacement failed to start; rolled back to prior configuration`,
      });
    } catch (rollbackErr) {
      slot.phase = 'crashed';
      running.respawning.delete(input.roleId);
      running.bus.emit({
        type: 'audit',
        from: callerId,
        reason: 'role-respawn-rollback-failed',
        msg: `role "${input.roleId}" replacement AND rollback both failed: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
      });
      return buildRespawnReceipt(slot, maxRespawns, false, {
        roleId: input.roleId,
        drainTimedOut,
        error: `replacement and rollback both failed; role "${input.roleId}" is unavailable`,
      });
    }
  }

  running.agents.set(input.roleId, newRuntime);
  slot.runtime = newRuntime;
  slot.abort = newAbort;
  slot.generation = newGeneration;
  slot.effectiveRole = candidateRole;
  slot.phase = 'running';
  slot.queuedDuringSwap = [];
  running.respawning.delete(input.roleId);

  // Step 13: audit and persist.
  running.bus.emit({
    type: 'audit',
    from: callerId,
    reason: 'role-respawned',
    msg: `role "${input.roleId}" replaced (generation ${newGeneration})`,
    data: {
      roleId: input.roleId,
      generation: newGeneration,
      respawnCount: slot.respawnCount,
      drainTimedOut,
    },
  });
  daemon.persistState(name, 'running', running.run);
  return buildRespawnReceipt(slot, maxRespawns, true, { roleId: input.roleId, drainTimedOut });
}
