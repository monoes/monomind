// packages/@monomind/cli/src/orgrt/scheduler-integration.ts
// Extracted from daemon.ts — auto-wake, boss restart, deferred role spawns.

import { waitForCapacity } from '../utils/resource-governor.js';
import { holdTasksForBudget, spawnClosedDetail } from './budget-closure.js';
import { pushMessage } from './cross-org.js';
import { activeRoleCount, OrgDaemon, type RunningOrg } from './daemon.js';
import { dispatchReadyTasks, queueDispatch } from './decisions.js';
import { EVAL_BOSS_CRASH_CLOSED_BY } from './documents/eval-gate.js';
import { sectionsSurface } from './documents/surface.js';
import { isEndpointRole } from './endpoint-roles.js';
import { newMessageId, peekInbox, queueMessage, takeQueued } from './inbox.js';
import type { OrgRole } from './types.js';

/** #552: a deferred spawn re-checks budget closure right before it starts —
 *  the org-wide ceiling or the role's own budget may have closed while it
 *  waited. When closed, the spawn is cancelled with an audit reason; under
 *  the org-wide ceiling the role is set aside with the pending roles, so a
 *  reload that raises it can spawn it again. True when cancelled. */
function cancelIfBudgetClosed(running: RunningOrg, role: OrgRole): boolean {
  const detail = spawnClosedDetail(running, role.id);
  if (!detail) return false;
  if (running.orgBudgetClosed && !running.agents.has(role.id)) {
    (running.orgBudgetPendingRoles ??= new Map()).set(role.id, role);
    holdTasksForBudget(running, role.id, detail);
  }
  running.bus.emit({
    type: 'audit',
    from: role.id,
    reason: 'deferred-spawn-cancelled',
    msg: `cancelled the deferred spawn of "${role.id}": ${detail}`,
    data: { roleId: role.id },
  });
  return true;
}

/** Deliver the messages queued in the org inbox for `roleId` now that it is
 *  live — only its own: messages for other roles stay queued (#557 review).
 *  Endpoint entries stay queued (M2: delivered by POST), and a role that is
 *  not live after all gets its messages put back. Called after every lazy
 *  spawn that may follow a deferral: the deferred-spawn loops here and
 *  dispatchReadyTasks's lazy spawn (e.g. after a reload reopens the org). */
export async function deliverQueuedFor(
  daemon: OrgDaemon,
  name: string,
  running: RunningOrg,
  roleId: string,
): Promise<void> {
  if (isEndpointRole(running.def.roles.find((r) => r.id === roleId))) return;
  const agent = running.agents.get(roleId);
  if (!agent || agent.mailbox.isClosed) return;
  const queued = takeQueued(daemon.root, name, (m) => m.toRole === roleId && !m.endpoint);
  for (const msg of queued) {
    const live = running.agents.get(roleId);
    if (!live || live.mailbox.isClosed) {
      queueMessage(daemon.root, name, msg);
      continue;
    }
    running.bus.emit({
      type: 'xorg',
      from: msg.fromQualified,
      to: `${name}:${msg.toRole}`,
      subject: msg.subject,
      msg: msg.body,
      data: { messageId: msg.messageId ?? newMessageId() },
    });
    await pushMessage(
      daemon,
      name,
      running,
      msg.toRole,
      msg.fromQualified,
      msg.subject,
      msg.body,
      `inbox-${msg.ts}-${Math.random().toString(36).slice(2, 8)}`,
    );
  }
}

/** Start an offline org in the background so queued messages get drained.
 *  Fire-and-forget — errors are logged but don't propagate to the sender. */
export function autoWake(daemon: OrgDaemon, name: string): void {
  if (daemon.orgs.has(name) || daemon.waking.has(name)) return;
  daemon.waking.add(name);
  daemon
    .startOrg(name)
    .catch((err) => {
      console.error(`auto-wake org "${name}" failed:`, err instanceof Error ? err.message : err);
    })
    .finally(() => {
      daemon.waking.delete(name);
    });
}

/** #4: bounded whole-org restart after the boss terminally crashes. Stops the
 *  dead run and re-launches it with fresh sessions (shedding any bloated
 *  context). Capped at MAX_BOSS_RESTARTS per explicit start so a crashing boss
 *  can't loop forever; beyond the cap it gives up and lets the idle watchdog
 *  shut the run down for a human. */
export function scheduleBossRestart(daemon: OrgDaemon, name: string): void {
  if (daemon.stopping.has(name) || daemon.restarting.has(name)) return;
  // Sections spec 9.2: an eval-mode org gets no boss restart (a restart would
  // start the trial again outside the harness). The crash ends the attempt as
  // a failure; stopping it keeps `org run` from waiting on a dead boss.
  const evalRun = daemon.orgs.get(name);
  if (evalRun && sectionsSurface(evalRun.def).enabled) {
    evalRun.bus.emit({
      type: 'audit',
      reason: EVAL_BOSS_CRASH_CLOSED_BY,
      msg: 'boss crashed in eval mode — no auto-restart; the trial attempt ends as a failure',
    });
    daemon
      .stopOrg(name, { closedBy: EVAL_BOSS_CRASH_CLOSED_BY })
      .catch((err) =>
        console.error(
          `org ${name}: stop after eval-mode boss crash failed:`,
          err instanceof Error ? err.message : err,
        ),
      );
    return;
  }
  const count = daemon.bossRestartCounts.get(name) ?? 0;
  const bus = daemon.orgs.get(name)?.bus;
  if (count >= OrgDaemon.MAX_BOSS_RESTARTS) {
    bus?.emit({
      type: 'audit',
      reason: 'boss-restart-exhausted',
      msg: `boss crashed again after ${count} auto-restart(s) — giving up; manual restart required`,
    });
    // #206: without this the org was left dangling in daemon.orgs forever —
    // its boss mailbox already closed from the crash, nothing else left to
    // ever call stopOrg for it (the idle watchdog only fires if
    // idle_minutes > 0). `org run`'s wait loop polls daemon.getOrg(name);
    // that never resolving meant the CLI process just hung indefinitely
    // instead of exiting with a failure signal.
    // #302: tag the real cause — the truth gate at finishStop's history
    // write must not let this read as a boss-attributed 'partial'/'achieved'.
    daemon
      .stopOrg(name, { closedBy: 'boss-restart-exhausted' })
      .catch((err) =>
        console.error(
          `org ${name}: stop after exhausted boss restarts failed:`,
          err instanceof Error ? err.message : err,
        ),
      );
    return;
  }
  const backoffSchedule = daemon.opts.bossRestartBackoffMs ?? OrgDaemon.BOSS_RESTART_BACKOFF_MS;
  const backoff = backoffSchedule[Math.min(count, backoffSchedule.length - 1)];
  daemon.bossRestartCounts.set(name, count + 1);
  daemon.restarting.add(name);
  bus?.emit({
    type: 'audit',
    reason: 'boss-restart',
    msg: `boss crashed — auto-restarting org with fresh sessions in ${Math.round(backoff / 1000)}s (attempt ${count + 1}/${OrgDaemon.MAX_BOSS_RESTARTS})`,
  });
  const t = setTimeout(() => {
    // A stop that landed while this restart was pending wins. `stopping` only
    // covers a stop still in flight AT THIS INSTANT; a stop that already
    // FINISHED (the common case — the backoff is 10s, a stop takes well under
    // that) left it empty again, so the restart went ahead and brought an org
    // the operator had explicitly stopped back to life with fresh sessions:
    // spending budget, rewriting runtime.json, holding a process 'exit'
    // handler, and with nothing left that would ever stop it again. A boss
    // crash only kills the boss session — the org itself stays registered in
    // `daemon.orgs` until someone stops it — so "still registered" is exactly
    // the condition that separates a restart worth doing from a resurrection.
    if (daemon.stopping.has(name) || !daemon.orgs.has(name)) {
      daemon.restarting.delete(name);
      return;
    } // a manual stop won
    daemon
      .stopOrg(name, { closedBy: 'boss-restart' })
      .then(() => (daemon.stopping.has(name) ? null : daemon.startOrg(name)))
      .then(() => {
        daemon.restarting.delete(name);
      })
      .catch((err) => {
        daemon.restarting.delete(name);
        console.error(
          `org ${name}: boss auto-restart failed:`,
          err instanceof Error ? err.message : err,
        );
      });
  }, backoff);
  (t as { unref?: () => void }).unref?.();
}

type Gate = 'concurrency' | 'resources';

const GATE = {
  concurrency: {
    recovered: 'concurrency-recovered',
    waiting: 'concurrency-limit',
    abandoned: 'concurrency-abandoned',
    freed: 'a concurrency slot freed up',
    still: 'still at the max_concurrent_agents ceiling',
  },
  resources: {
    recovered: 'resource-recovered',
    waiting: 'resource-pressure',
    abandoned: 'resource-abandoned',
    freed: 'resources recovered',
    still: 'still under pressure',
  },
} as const;

/** One retry loop per deferred role (#551): record it in
 *  running.deferredSpawns so it stays a known assignee — its tasks wait
 *  (dag-dispatch.ts) and messages to it are queued (cross-org-deferred.ts) —
 *  and a second deferral of the same role joins this loop. Each turn waits on
 *  the gate; once it clears, the role spawns, its queued messages are
 *  delivered and ready tasks go out, whichever caller deferred it. Before
 *  spawning it re-checks budget closure (#552), and a closure that removed
 *  its entry cancels it. Bails quietly if the org is stopped (or restarted
 *  under the same name); `running` is compared by identity, not `name`, so a
 *  stale retry can never spawn into a different run. */
function runDeferredSpawn(
  daemon: OrgDaemon,
  name: string,
  running: RunningOrg,
  role: OrgRole,
  spawnRole: (role: OrgRole) => void,
  gate: Gate,
  maxAttempts: number,
  waitTurn: () => Promise<{ ok: boolean; reason?: string }>,
): void {
  // #557 review: the ceiling may have closed while the caller waited (deliver()
  // waits up to 60s for host capacity) — set the role aside and hold its
  // tasks now rather than after the first retry turn (up to 5 minutes).
  if (running.orgBudgetClosed && cancelIfBudgetClosed(running, role)) return;
  const deferred = (running.deferredSpawns ??= new Map());
  if (deferred.has(role.id)) return;
  const entry = { role, gate, noted: new Set<string>() };
  deferred.set(role.id, entry);
  const stillDeferred = (): boolean => deferred.get(role.id) === entry;
  const words = GATE[gate];
  (async () => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const waited = await waitTurn();
      if (daemon.orgs.get(name) !== running) return; // org stopped/restarted — abandon quietly
      if (!stillDeferred()) return; // cancelled — e.g. the org-wide budget closed (#552)
      if (cancelIfBudgetClosed(running, role)) {
        deferred.delete(role.id);
        return;
      }
      if (waited.ok) {
        running.bus.emit({
          type: 'audit',
          from: role.id,
          reason: words.recovered,
          msg: `${words.freed} after ${attempt} retr${attempt === 1 ? 'y' : 'ies'} — spawning deferred role "${role.id}"`,
        });
        deferred.delete(role.id);
        spawnRole(role);
        await deliverQueuedFor(daemon, name, running, role.id);
        dispatchReadyTasks(daemon, name, running);
        return;
      }
      running.bus.emit({
        type: 'audit',
        from: role.id,
        reason: words.waiting,
        msg: `${words.still} (attempt ${attempt}/${maxAttempts}) — retrying "${role.id}" spawn${waited.reason ? `: ${waited.reason}` : ''}`,
      });
    }
    if (!stillDeferred()) return;
    deferred.delete(role.id);
    giveUpDeferral(
      daemon,
      name,
      running,
      role,
      words.abandoned,
      gate === 'concurrency'
        ? `the org stayed at its max_concurrent_agents ceiling (${running.def.run_config.max_concurrent_agents}) for ${maxAttempts} checks`
        : `the host stayed under resource pressure for ${maxAttempts} checks`,
    );
  })().catch((err) =>
    console.error(
      `org ${name}: deferred spawn of "${role.id}" failed:`,
      err instanceof Error ? err.message : err,
    ),
  );
}

/** A deferral that ran out of retries: the role goes back to pendingRoles (a
 *  later task or message defers it again), the tasks waiting on it are failed
 *  with the reason instead of sitting 'ready' forever, the abandonment is
 *  persisted to the org state, and the coordinator is told — also when only
 *  queued messages were waiting (they stay queued for when it starts). */
function giveUpDeferral(
  daemon: OrgDaemon,
  name: string,
  running: RunningOrg,
  role: OrgRole,
  reason: string,
  cause: string,
): void {
  if (!running.agents.has(role.id)) (running.pendingRoles ??= new Map()).set(role.id, role);
  const why = `"${role.id}" could not start: ${cause}`;
  const failed: string[] = [];
  for (const t of running.taskDag?.all() ?? []) {
    if (t.assignee !== role.id || t.status !== 'ready') continue;
    running.taskDag!.fail(t.id, `not started — ${why}`);
    failed.push(t.id);
  }
  const queued = peekInbox(daemon.root, name).filter((m) => m.toRole === role.id);
  const missing = daemon.abandoned.get(name) ?? new Set<string>();
  missing.add(role.id);
  daemon.abandoned.set(name, missing);
  daemon.persistState(name, 'running', running.run);
  running.bus.emit({
    type: 'audit',
    from: role.id,
    reason,
    msg: `giving up spawning "${role.id}" (${cause}) — it stays pending for later work${failed.length ? `; failed its waiting task(s) ${failed.join(', ')}` : ''}${queued.length ? `; ${queued.length} queued message(s) wait for it` : ''}`,
    data: { roleId: role.id, failedTasks: failed, queuedMessages: queued.length },
  });
  if ((!failed.length && !queued.length) || !running.bossRoleId || running.bossRoleId === role.id)
    return;
  const parts: string[] = [];
  if (failed.length)
    parts.push(
      `its waiting task(s) ${failed.join(', ')} are marked failed and NOT being re-dispatched — reassign or re-file them`,
    );
  if (queued.length)
    parts.push(
      `${queued.length} message(s) to it (from ${[...new Set(queued.map((m) => m.fromQualified))].join(', ')}) stay queued and are delivered only once it starts`,
    );
  queueDispatch(running, running.bossRoleId, `[deferred spawn] ${why}, so ${parts.join('; ')}.`);
}

/** A role that failed its resource gate isn't abandoned — keep polling for
 *  capacity in the background (bounded, ~30 min) and spawn it the moment
 *  resources free up, instead of silently running the org shorthanded. Same
 *  deferral as the concurrency one (runDeferredSpawn): the role stays a known
 *  assignee and its tasks go out once it is up. */
export function scheduleDeferredSpawn(
  daemon: OrgDaemon,
  name: string,
  running: RunningOrg,
  role: OrgRole,
  spawnRole: (role: OrgRole) => void,
): void {
  runDeferredSpawn(daemon, name, running, role, spawnRole, 'resources', 6, () =>
    waitForCapacity(5 * 60_000),
  );
}

/** Bug 4: a role deferred because the org is already at its
 *  run_config.max_concurrent_agents ceiling isn't abandoned either — poll
 *  until a slot frees up (another role in this org ends, crashes, or is
 *  stopped — activeRoleCount() recomputes live each check, so nothing here
 *  needs to explicitly track "a slot freed") and spawn it then (~15 min at
 *  5s intervals before giving up loudly). */
export function scheduleConcurrencyDeferredSpawn(
  daemon: OrgDaemon,
  name: string,
  running: RunningOrg,
  role: OrgRole,
  spawnRole: (role: OrgRole) => void,
): void {
  const pollMs = daemon.opts.concurrencyDeferPollMs ?? 5_000;
  runDeferredSpawn(
    daemon,
    name,
    running,
    role,
    spawnRole,
    'concurrency',
    daemon.opts.concurrencyDeferMaxAttempts ?? 180,
    async () => {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, pollMs);
        (t as { unref?: () => void }).unref?.();
      });
      const limit = running.def.run_config.max_concurrent_agents;
      if (limit == null) return { ok: true };
      const free = limit - activeRoleCount(running);
      if (free <= 0) return { ok: false };
      // #589: each role polls on its own timer, so without this the first
      // timer to fire after a slot frees takes it — a role deferred later
      // could start ahead of (and keep starving) one deferred earlier.
      const ahead = concurrencyDeferredAhead(running, role.id);
      if (ahead.length < free) return { ok: true };
      return {
        ok: false,
        reason: `waiting behind earlier deferred ${ahead.map((id) => `"${id}"`).join(', ')}`,
      };
    },
  );
}

/** Roles deferred for a concurrency slot before `roleId`, oldest first —
 *  running.deferredSpawns keeps insertion (deferral) order. */
function concurrencyDeferredAhead(running: RunningOrg, roleId: string): string[] {
  const ahead: string[] = [];
  for (const [id, entry] of running.deferredSpawns ?? []) {
    if (id === roleId) break;
    if (entry.gate === 'concurrency') ahead.push(id);
  }
  return ahead;
}
