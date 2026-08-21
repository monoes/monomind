// packages/@monomind/cli/src/orgrt/scheduler-integration.ts
// Extracted from daemon.ts — auto-wake, boss restart, deferred role spawns.
import { queueMessage, drainInbox } from './inbox.js';
import { waitForCapacity } from '../utils/resource-governor.js';
import { mailBody } from './cross-org.js';
import { OrgDaemon, type RunningOrg } from './daemon.js';
import type { OrgRole } from './types.js';

/** Start an offline org in the background so queued messages get drained.
 *  Fire-and-forget — errors are logged but don't propagate to the sender. */
export function autoWake(daemon: OrgDaemon, name: string): void {
  if (daemon.orgs.has(name) || daemon.waking.has(name)) return;
  daemon.waking.add(name);
  daemon.startOrg(name)
    .catch(err => { console.error(`auto-wake org "${name}" failed:`, err instanceof Error ? err.message : err); })
    .finally(() => { daemon.waking.delete(name); });
}

/** #4: bounded whole-org restart after the boss terminally crashes. Stops the
 *  dead run and re-launches it with fresh sessions (shedding any bloated
 *  context). Capped at MAX_BOSS_RESTARTS per explicit start so a crashing boss
 *  can't loop forever; beyond the cap it gives up and lets the idle watchdog
 *  shut the run down for a human. */
export function scheduleBossRestart(daemon: OrgDaemon, name: string): void {
  if (daemon.stopping.has(name) || daemon.restarting.has(name)) return;
  const count = daemon.bossRestartCounts.get(name) ?? 0;
  const bus = daemon.orgs.get(name)?.bus;
  if (count >= OrgDaemon.MAX_BOSS_RESTARTS) {
    bus?.emit({ type: 'audit', reason: 'boss-restart-exhausted',
      msg: `boss crashed again after ${count} auto-restart(s) — giving up; manual restart required` });
    // #206: without this the org was left dangling in daemon.orgs forever —
    // its boss mailbox already closed from the crash, nothing else left to
    // ever call stopOrg for it (the idle watchdog only fires if
    // idle_minutes > 0). `org run`'s wait loop polls daemon.getOrg(name);
    // that never resolving meant the CLI process just hung indefinitely
    // instead of exiting with a failure signal.
    daemon.stopOrg(name).catch(err =>
      console.error(`org ${name}: stop after exhausted boss restarts failed:`, err instanceof Error ? err.message : err));
    return;
  }
  const backoffSchedule = daemon.opts.bossRestartBackoffMs ?? OrgDaemon.BOSS_RESTART_BACKOFF_MS;
  const backoff = backoffSchedule[Math.min(count, backoffSchedule.length - 1)];
  daemon.bossRestartCounts.set(name, count + 1);
  daemon.restarting.add(name);
  bus?.emit({ type: 'audit', reason: 'boss-restart',
    msg: `boss crashed — auto-restarting org with fresh sessions in ${Math.round(backoff / 1000)}s (attempt ${count + 1}/${OrgDaemon.MAX_BOSS_RESTARTS})` });
  const t = setTimeout(() => {
    if (daemon.stopping.has(name)) { daemon.restarting.delete(name); return; } // a manual stop won
    daemon.stopOrg(name)
      .then(() => (daemon.stopping.has(name) ? null : daemon.startOrg(name)))
      .then(() => { daemon.restarting.delete(name); })
      .catch(err => { daemon.restarting.delete(name); console.error(`org ${name}: boss auto-restart failed:`, err instanceof Error ? err.message : err); });
  }, backoff);
  (t as { unref?: () => void }).unref?.();
}

/** A role that failed its resource gate at boot isn't abandoned — keep polling
 *  for capacity in the background (bounded) and spawn it the moment resources
 *  free up, instead of silently running the org shorthanded for its whole life.
 *  Bails quietly if the org is stopped (or restarted under the same name)
 *  before capacity returns; `running` is compared by identity, not `name`,
 *  so a stale retry can never spawn into a different run. */
export function scheduleDeferredSpawn(daemon: OrgDaemon, name: string, running: RunningOrg, role: OrgRole, spawnRole: (role: OrgRole) => void): void {
  const MAX_ATTEMPTS = 6; // ~30 min of retrying before giving up loudly
  (async () => {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const waited = await waitForCapacity(5 * 60_000);
      if (daemon.orgs.get(name) !== running) return; // org stopped/restarted — abandon quietly
      if (waited.ok) {
        running.bus.emit({ type: 'audit', from: role.id, reason: 'resource-recovered',
          msg: `resources recovered after ${attempt} retr${attempt === 1 ? 'y' : 'ies'} — spawning deferred role "${role.id}"` });
        // Drain messages queued while the role was deferred BEFORE spawning
        // to prevent race condition where messages arrive during spawn window
        const queued = drainInbox(daemon.root, name);
        spawnRole(role);
        for (const msg of queued) {
          const agent = running.agents.get(msg.toRole);
          if (agent && !agent.mailbox.isClosed) {
            running.bus.emit({ type: 'xorg', from: msg.fromQualified, to: `${name}:${msg.toRole}`, subject: msg.subject, msg: msg.body });
            agent.mailbox.push(mailBody(daemon.root, name, running, `[message from ${msg.fromQualified}] subject: ${msg.subject}`, msg.body,
              `inbox-${msg.ts}-${Math.random().toString(36).slice(2, 8)}`));
          }
        }
        return;
      }
      running.bus.emit({ type: 'audit', from: role.id, reason: 'resource-pressure',
        msg: `still under pressure (attempt ${attempt}/${MAX_ATTEMPTS}) — retrying "${role.id}" spawn: ${waited.reason}` });
    }
    const missing = daemon.abandoned.get(name) ?? new Set<string>();
    missing.add(role.id);
    daemon.abandoned.set(name, missing);
    daemon.persistState(name, 'running', running.run);
    running.bus.emit({ type: 'audit', from: role.id, reason: 'resource-abandoned',
      msg: `giving up spawning "${role.id}" after ${MAX_ATTEMPTS} retries — org will run without this role until manually restarted` });
  })().catch(err => console.error(`org ${name}: deferred spawn of "${role.id}" failed:`, err instanceof Error ? err.message : err));
}
