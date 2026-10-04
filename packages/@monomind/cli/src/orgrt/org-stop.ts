// packages/@monomind/cli/src/orgrt/org-stop.ts
// Extracted from daemon.ts — stopping an org run: stopOrg's join/remove
// sequence and finishStop's teardown (checkpoint, drain, history, cleanup).
import { reapOrphanedSdkProcesses } from '../utils/resource-governor.js';
import { captureCheckpoint } from './checkpoint.js';
import type { OrgDaemon } from './daemon.js';
import type { RunningOrg } from './daemon-types.js';
import * as decisionOps from './decisions.js';
import { stopEndpointRetries } from './endpoint-roles.js';
import { clearIdleRecord, readIdleRecord } from './idle-deadline.js';
import { historyFile, readRunEvents, summarizeRun } from './reporting.js';
import { releaseRunTmpdirs } from './role-tmpdir.js';
import { sandboxStubs } from './sandbox-stubs.js';

export async function stopOrg(
  daemon: OrgDaemon,
  name: string,
  opts?: { drainMs?: number; closedBy?: string },
): Promise<void> {
  // Join an in-flight stop instead of no-oping: the self-stop paths
  // (org_complete, idle watchdog) run detached, and a caller like
  // `org run`'s final stopAll() must not resolve — letting the process
  // exit — while that stop is still flushing the bus and writing
  // history/runtime.json.
  const inflight = daemon.stopping.get(name);
  if (inflight) return inflight;
  const org = daemon.orgs.get(name);
  if (!org) return; // already stopped
  org.pendingRoles?.clear(); // prevent lazy spawns after stop
  daemon.spawning.delete(name); // clean up spawning tracking for this org
  // #304: set before the delete below, since that delete is what makes
  // abortedByStop (role loop) true — the role loop reads it off this same
  // object reference, not a fresh lookup (the org is gone from the map by then).
  org.closedBy = opts?.closedBy;
  // Remove immediately (not at the end) so a concurrent stopOrg(name) call —
  // e.g. stopAll() racing a scheduler-triggered stop on SIGINT — joins this
  // shutdown via `stopping` instead of re-running the whole sequence and
  // double-emitting 'org stopped' (duplicate org:complete/session:complete).
  daemon.orgs.delete(name);
  const p = finishStop(daemon, name, org, opts?.drainMs, opts?.closedBy);
  daemon.stopping.set(name, p);
  try {
    await p;
  } finally {
    daemon.stopping.delete(name);
    daemon.releaseDaemonLock(name);
  }
}

async function finishStop(
  daemon: OrgDaemon,
  name: string,
  org: RunningOrg,
  drainMs?: number,
  closedBy?: string,
): Promise<void> {
  // Process- and daemon-level handles come off FIRST, before anything that
  // can throw. These used to be removed after captureCheckpoint(), so a
  // throw there — which a half-started org can provoke, since it may be
  // missing state a checkpoint expects — aborted the whole stop and left a
  // process 'exit' listener, an interval and a broker lease behind for a run
  // that no longer exists. startOrg()'s teardown-on-failure path swallows a
  // rejecting stopOrg (it has its own error to report), so the leak was
  // silent.
  const cleanup = (org as RunningOrg & { _crashCleanup?: () => void })._crashCleanup;
  if (cleanup) process.removeListener('exit', cleanup);
  daemon.leadWatches.get(name)?.();
  daemon.leadWatches.delete(name);
  const wd = daemon.watchdogs.get(name);
  if (wd) {
    clearInterval(wd);
    daemon.watchdogs.delete(name);
  }
  // #352: the watchdog's last published state goes onto the org-stopped
  // event below, so a run cut short (e.g. a `timeout`-bounded drill) shows
  // whether an idle nudge was still due or was missed. The file itself is
  // not a durable record — it is removed here.
  const idleRecord = readIdleRecord(daemon.root, name, org.run);
  const idleWatchdog = idleRecord
    ? {
        idle_minutes: idleRecord.idle_minutes,
        next_nudge_at: idleRecord.next_nudge_at ?? null,
        idle_stop_at: idleRecord.idle_stop_at,
        hold: idleRecord.hold,
      }
    : undefined;
  clearIdleRecord(daemon.root, name);
  // The run's gates are authoritative; put them back over whatever the file
  // holds now (a role may have rewritten it).
  if (org.gates) {
    try {
      decisionOps.writeGates(daemon.root, name, org.gates);
    } catch {
      /* the next start reads the last write-through */
    }
  }
  daemon.leases.get(name)?.stop();
  daemon.leases.delete(name);
  // Capture THIS run's forwarder now: an autoWake-restart of the same org
  // during the long tail below (agent wait, flush, history write) would
  // register a NEW forwarder under the same name — settling/unsubscribing
  // that one would sever the new run's dashboard stream.
  const forwarder = daemon.forwarders.get(name);
  // Snapshot checkpoint BEFORE closing mailboxes / draining sessions — the
  // queue is emptied during the drain, so capturing afterwards loses all
  // unconsumed messages (the whole point of checkpoint-resume). Best-effort:
  // a run that cannot be checkpointed must still be stopped and cleaned up.
  let stopCheckpoint: ReturnType<typeof captureCheckpoint> | undefined;
  try {
    stopCheckpoint = captureCheckpoint(org, 'stopped');
  } catch (err) {
    console.error(
      `org ${name}: could not capture the stop checkpoint:`,
      err instanceof Error ? err.message : err,
    );
  }
  // #275: drop task dispatches still inside their coalescing window — the
  // mailboxes they target are closed on the next line anyway.
  for (const held of org.pendingDispatch?.values() ?? []) clearTimeout(held.timer);
  org.pendingDispatch?.clear();
  for (const a of org.agents.values()) a.mailbox.close();
  // Closing the mailbox stops new work being handed to a session, but does
  // NOT cancel a turn already in flight (e.g. mid provider call) — that
  // session can keep running, and eventually crash/finish, well past this
  // function's own bounded drain below. Abort each slot's live incarnation
  // too, reusing respawnRole's existing force-stop handle, so in-flight
  // work is told to stop now instead of merely being denied new input.
  for (const slot of org.roleSlots.values()) slot.abort?.abort();
  // M1: kill every tool-provider process of this org's sessions.
  daemon.toolProviders.closeOrg(name);
  // M2: stop endpoint retry timers (queued entries stay queued).
  stopEndpointRetries(daemon, name);
  // Bounded: a genuinely hung agent session (stuck mid-tool-call, not just
  // idle) must not make stopOrg() hang forever — callers like the scheduler
  // already race their own timeout around a run, and this wait re-blocking
  // unboundedly on the same never-resolving promises defeated that bound.
  // A planned completion is not an abort. The boss declaring the cycle done
  // says nothing about its siblings: they are routinely mid-build or mid-edit
  // when it fires, and a 15s window SIGTERM'd them (exit 143, reported as
  // "crashed") and threw the work away. allSettled resolves as soon as every
  // session ends, so a long drain is a ceiling, not a delay.
  const stopWaitMs = drainMs ?? daemon.opts.stopWaitMs ?? 15_000;
  const allDone = Promise.allSettled([...org.agents.values()].map((a) => a.done)).then(() => false);
  // Clear the ceiling timer once the sessions win the race: left pending, a
  // COMPLETE_DRAIN_MS stop kept `org run` (which returns without
  // process.exit on a clean completion) alive for up to five minutes after
  // every session had already ended. Deliberately NOT unref'd — on the
  // timed-out path this timer may be the only thing keeping the loop alive
  // long enough to write 'stopped' to runtime.json and flush the bus.
  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    allDone,
    new Promise<boolean>((r) => {
      drainTimer = setTimeout(() => r(true), stopWaitMs);
    }),
  ]);
  clearTimeout(drainTimer);
  if (timedOut) {
    // #152: "proceeding anyway" alone didn't say WHO got cut off — a run
    // reviewer had no way to tell whether real, in-progress work (a
    // mid-build, a mid-write) was force-stopped, or the drain window
    // simply outlived a handful of already-idle sessions. status is only
    // 'ended'/'crashed' once a role's session promise has actually
    // settled; still 'running' here means it was mid-turn when the
    // ceiling hit, not merely idle-but-not-yet-reaped.
    const stillActive = [...org.agents.entries()]
      .filter(([, a]) => a.status === 'running')
      .map(([roleId]) => roleId);
    const rosterSuffix = stillActive.length ? ` — still active: ${stillActive.join(', ')}` : '';
    org.bus.emit({
      type: 'audit',
      msg: `org stop timed out after ${stopWaitMs}ms waiting for agent sessions to finish — proceeding anyway${rosterSuffix}`,
      reason: 'stop-timeout',
      data: { stillActive },
    });
    // Reap only SDK processes spawned by THIS node process — ownerPid filter
    // ensures other `monomind org run` daemons' agents are untouched.
    try {
      const reaped = reapOrphanedSdkProcesses(new Set(), process.pid);
      if (reaped > 0)
        org.bus.emit({
          type: 'audit',
          reason: 'orphan-reap',
          msg: `reaped ${reaped} orphaned SDK process(es) after stop timeout`,
        });
    } catch {
      /* best-effort */
    }
  }
  // The run's sessions are gone: take down the sandbox stubs it held.
  sandboxStubs.release(`${name}:${org.run}`);
  // #480: and every private role TMPDIR a session did not already remove.
  releaseRunTmpdirs(name, org.run);
  // #302 truth gate: every stop path funnels through here, so this is the
  // one place that can record how the run ACTUALLY ended, regardless of
  // which of the five paths triggered it. `closedBy` is undefined only for
  // a bare manual `stopOrg(name)` (CLI `org stop`, shutdown) — every
  // automated path above now tags its own real cause. reporting.ts reads
  // this event (reason: 'org-stopped') to decide whether the run's outcome
  // may be rendered as a boss-attributed 'partial'/'achieved' at all: only
  // closedBy === 'org-complete' may be.
  const runnableTasks = org.taskDag?.pendingTaskCount() ?? 0;
  // Rendered, not just recorded (#302 AC6, same reasoning as the
  // blockerSuffix above): `org logs` prints `msg` verbatim.
  const stopSuffix =
    closedBy && closedBy !== 'org-complete'
      ? ` (${closedBy}${runnableTasks > 0 ? `, ${runnableTasks} task(s) left` : ''})`
      : '';
  org.bus.emit({
    type: 'status',
    reason: 'org-stopped',
    msg: `org stopped${stopSuffix}`,
    data: { closedBy, runnableTasks, idleWatchdog },
  });
  await org.bus.flush();
  // Append this run's summary to <org>/history.jsonl — read back from the
  // flushed bus.jsonl (the full durable record) rather than the bounded
  // in-memory buffer, so long runs summarize completely.
  //
  // This block runs BEFORE the seal below (#293): storeRunMemory emits an
  // audit event when the run's memory could not be stored, and a sealed bus
  // fans out to in-memory listeners without ever reaching bus.jsonl — an
  // event the live view shows and the durable record does not, which is both
  // the divergence test-loop's `persisted` check exists to catch and useless
  // to whoever reads the run back later. Sealing after it keeps every emitted
  // event durable. The seal still closes before this function returns, which
  // is what its own contract (below) is about.
  try {
    const events = readRunEvents(daemon.root, name, org.run);
    if (events.length) {
      const summary = summarizeRun(events);
      const { appendFileSync } = await import('node:fs');
      appendFileSync(historyFile(daemon.root, name), `${JSON.stringify(summary)}\n`, 'utf8');
      // Cross-run memory: make this run's outcome recallable by meaning.
      // #293: the result is CHECKED — a store that silently did nothing used
      // to be indistinguishable from one that worked, and the symptom
      // (org_recall always empty) showed up runs later with no trail. The
      // reason is stashed for persistState() below so runtime.json — and
      // therefore `org status` — carries it after the bus event and the
      // stderr warning have scrolled away.
      const memory = await daemon.storeRunMemory(name, org.def, org.run, summary, org.bus);
      if (memory.stored) daemon.memoryErrors.delete(name);
      else daemon.memoryErrors.set(name, memory.reason ?? 'unknown');
    }
  } catch (err) {
    console.error(
      `org ${name}: could not write run history:`,
      err instanceof Error ? err.message : err,
    );
  } finally {
    daemon.recallUsage.delete(name);
    daemon.orgLearnedRuns.delete(`${name}:${org.run}`);
  }
  org.documents?.close(); // org sections (plan P3.6): no document call after this point writes
  // flush() only awaits a snapshot of writes queued at call time (see its
  // own doc comment) — it has no visibility into a session that crashes
  // after the abort signal above but before this function returns. Seal
  // the bus now so any such late bus.emit() still reaches in-memory
  // listeners but can never schedule a new disk write into a run
  // directory a caller (e.g. a test's afterEach) may already be deleting.
  // seal() awaits the pending writes first, so the audit event the block
  // above may have emitted is on disk before the bus closes.
  await org.bus.seal();
  // the "org stopped" event above triggers the forwarder's final org:complete /
  // session:complete POST — without waiting for it here, the CLI process can exit
  // (and kill the in-flight fetch) before that last event reaches the dashboard,
  // leaving the run stuck showing "running" forever. Bounded: a stalled
  // dashboard must not hang org shutdown indefinitely.
  if (forwarder) {
    await Promise.race([
      forwarder.settle(),
      new Promise<void>((r) => {
        const t = setTimeout(r, 5_000);
        (t as { unref?: () => void }).unref?.();
      }),
    ]);
    forwarder.unsubscribe();
    // Only remove from the map if it's still OURS — an autoWake-restart may
    // have registered the new run's forwarder under this name meanwhile.
    if (daemon.forwarders.get(name) === forwarder) daemon.forwarders.delete(name);
  }
  // Same guard for runtime.json: if a new run started during shutdown, its
  // 'running' record must not be overwritten with this old run's 'stopped'.
  // Pass the org directly since we already removed it from the map.
  if (!daemon.orgs.has(name))
    daemon.persistState(name, 'stopped', org.run, org, stopCheckpoint, closedBy);
  // Clean up git worktrees — shared (workspace: 'worktree') and per-role.
  try {
    const { execFileSync } = await import('node:child_process');
    if (org.worktreePath) {
      try {
        execFileSync('git', ['worktree', 'remove', '--force', org.worktreePath], {
          cwd: daemon.root,
          stdio: 'ignore',
          timeout: 30_000,
        });
      } catch {
        /* best-effort */
      }
    }
    for (const agent of org.agents.values()) {
      if (agent.worktreePath) {
        try {
          execFileSync('git', ['worktree', 'remove', '--force', agent.worktreePath], {
            cwd: daemon.root,
            stdio: 'ignore',
            timeout: 30_000,
          });
        } catch {
          /* best-effort */
        }
      }
    }
    // #301: roles create their own linked worktrees with Bash (paths the
    // daemon never recorded — org.worktreePath/agent.worktreePath above are
    // only ever set for workspace: 'worktree'/'worktree-per-role', empty
    // for the common workspace: 'repo' shape), and deleting the working
    // directory from inside a role sandbox leaves .git/worktrees/<name>
    // behind — `git worktree list` then hides it, and it never gets
    // cleaned up. Unconditional on purpose: gating this on
    // org/agent.worktreePath would skip exactly the runs that hit the bug.
    // prune only drops metadata whose worktree directory is already gone,
    // so a live worktree — including the owner's — is never touched; it is
    // idempotent; and the two removals just above already run `git
    // worktree remove --force` against this same repo from this same cwd,
    // so this is strictly less invasive than what already ships. Run after
    // both removal loops so a worktree just removed is also pruned.
    //
    // Bounded race, measured rather than assumed (same treatment as the
    // SIGKILL case above): an entry whose `gitdir` file is absent is
    // pruned unconditionally, and `--expire` cannot protect it — measured
    // across every window from `--expire=now` to `--expire=3.months.ago`,
    // a fresh no-gitdir entry is removed regardless, while `--expire` also
    // makes an already-deleted worktree SURVIVE, breaking the "a run
    // always begins clean" guarantee this fix exists to provide. So a
    // concurrent `git worktree add` by another process in this repo is
    // vulnerable for the microseconds between its `mkdir` and its
    // `gitdir` write. A mid-creation state cannot persist longer than
    // that, so an entry found in that state is dead metadata, not a live
    // worktree in progress.
    try {
      execFileSync('git', ['worktree', 'prune'], {
        cwd: daemon.root,
        stdio: 'ignore',
        timeout: 30_000,
      });
    } catch {
      /* best-effort: not a git repo, git missing, or a wedged hook */
    }
  } catch {
    /* node:child_process unavailable — skip */
  }
}
