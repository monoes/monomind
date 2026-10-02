// packages/@monomind/cli/src/orgrt/session.ts

import { createHash } from 'node:crypto';
import { contextSurface } from './context-surface.js';
import { CumulativeMeter } from './cumulative-meter.js';
import type { StreamOptions } from './mailbox.js';
import { Mailbox } from './mailbox.js';
import { beginPlantWatch } from './planted-paths.js';
import type { TokenUsage } from './policy.js';
import { createRoleTmpdir, removeRoleTmpdir, roleTmpBase } from './role-tmpdir.js';
import { buildRotationDigest } from './rotation-digest.js';
import { effectiveRoleRuntime } from './runner-resolve.js';
import { FaultRestarts, ProcessFaultError } from './sandbox-fault.js';
import { capReached, SessionCounters } from './session-cap.js';
import type { SessionStartReason } from './session-ledger.js';
import {
  mailRouteKey,
  ROLE_SESSION_KEY,
  resolveSessionScope,
  SessionLedger,
} from './session-ledger.js';
import { rolePromptFor } from './session-prompt.js';
import { runOneSession } from './session-run.js';
import type { SessionOpts } from './session-types.js';
import { queueCancelNotice, TaskCancelledError, trackTaskProcess } from './task-cancel.js';

export { gatedCanUseTool } from './session-gate.js';
export {
  buildRolePrompt,
  resolveModel,
  resolveRoleExtraGuidance,
} from './session-prompt.js';
export type { DeliverFn, SessionOpts } from './session-types.js';

/**
 * Runs a role for the life of the org, transparently restarting the
 * underlying SDK session whenever it ends on its own (`maxTurns` reached)
 * while the mailbox is still open. `maxTurns` bounds a single SDK query()
 * call's TOTAL turns, not "turns per incoming message" - since one query()
 * call stays open across every mailbox message for as long as the mailbox
 * itself stays open, without a restart the role would go permanently silent
 * (no crash, no alert) once its lifetime turn count crossed the limit, while
 * deliver() kept queuing new messages into a mailbox nobody was reading.
 */
export async function runAgentSession(opts: SessionOpts): Promise<void> {
  // `emit()` intentionally does not block agents on disk I/O, but a completed
  // session is a lifecycle boundary: callers may immediately summarize a run,
  // stop its daemon, or remove an isolated workspace.  Do not let queued bus
  // writes outlive that boundary (which could otherwise lose terminal events
  // or race cleanup of the run directory).
  // #480: one private TMPDIR per session key (the role's, or each task's),
  // removed when its task closes and, for whatever is left, when this ends.
  const tmp = new SessionTmpdirs(opts);
  try {
    await runAgentSessionLoop(opts, tmp);
  } finally {
    tmp.removeAll();
    await opts.bus.flush();
  }
}

/** The private TMPDIRs of one runAgentSession (role-tmpdir.ts, #480). */
class SessionTmpdirs {
  private readonly dirs = new Map<string, string>();
  private readonly base = roleTmpBase();
  constructor(private readonly opts: SessionOpts) {}
  /** The TMPDIR for `sessionKey`, created on first use; undefined = not
   *  creatable, the session keeps the shared base. */
  for(sessionKey: string): string | undefined {
    let dir = this.dirs.get(sessionKey);
    if (!dir) {
      dir = createRoleTmpdir({
        org: this.opts.org,
        role: this.opts.role.id,
        run: this.opts.run,
        root: this.opts.orgRoot ?? this.opts.cwd,
        base: this.base,
      });
      if (dir) this.dirs.set(sessionKey, dir);
    }
    return dir;
  }
  remove(sessionKey: string): void {
    const dir = this.dirs.get(sessionKey);
    if (!dir) return;
    this.dirs.delete(sessionKey);
    removeRoleTmpdir(dir, { org: this.opts.org, role: this.opts.role.id, base: this.base });
  }
  removeAll(): void {
    for (const key of [...this.dirs.keys()]) this.remove(key);
  }
}

async function runAgentSessionLoop(opts: SessionOpts, tmp: SessionTmpdirs): Promise<void> {
  const { mailbox } = opts;
  // Carries the SDK's own session_id across a maxTurns restart so the next
  // query() call resumes the prior conversation instead of starting cold -
  // without this, a restart silently discarded all in-progress reasoning.
  // Seeded from opts.resumeSessionId (a checkpoint's persisted sessionId) when
  // this is a checkpoint resume, not a fresh run — P2-13.
  let resumeSessionId: string | undefined = opts.resumeSessionId;
  // #149: a resumeSessionId seeded from a persisted checkpoint (org run
  // --resume) points at an SDK session that may no longer exist on the
  // provider's side by the time resume happens — hours can pass between
  // `org stop` and `org run --resume`. Track whether we've already tried
  // falling back to a fresh session for THIS specific session id, so a
  // stale checkpoint session gets one recovery attempt instead of crashing
  // the whole role outright, but a second failure (a real, non-staleness
  // error) still crashes normally rather than looping forever.
  const initialResumeSessionId = opts.resumeSessionId;
  let triedFreshAfterResumeFailure = false;
  // #1: when a session ends on the turn limit mid-work, push a continuation so
  // the restarted query() has input to act on instead of blocking on an empty
  // mailbox until the 10-minute idle watchdog. Bounded: if the role consumed no
  // real message since the last restart (it is spinning on its own
  // continuations), stop auto-pushing after MAX_CONTINUATIONS and let the
  // watchdog re-engage — so a stuck role can't burn tokens forever.
  const MAX_CONTINUATIONS = 3;
  let consecutiveSpin = 0;
  // The SDK's result message reports total_cost_usd CUMULATIVELY for the whole
  // SDK session: one query() call stays open across every mailbox message
  // (streaming-input mode) and emits one result per message, and the running
  // total can survive a resume after a restart. daemon.ts and
  // reporting.ts both SUM the cost_usd of usage events, so forwarding the raw
  // value charged every previous turn again on each new message - observed as
  // ~10-20x cost inflation on long org runs. The meter outlives individual
  // runOneSession calls and emits only deltas; see cumulative-meter.ts for why
  // it is also told when a new process starts.
  const sessionCostTotals = new CumulativeMeter<{ usd: number }>();
  // ADR-O001 D1: modelUsage is cumulative per session exactly like
  // total_cost_usd, so it needs the same meter to become a delta.
  const sessionTokenTotals = new CumulativeMeter<TokenUsage>();
  // bwrap errors and a closed tool permission channel restart the process, bounded (sandbox-fault.ts).
  const faultRestarts = new FaultRestarts({
    bus: opts.bus,
    roleId: opts.role.id,
    coordinator: opts.role.reports_to ?? undefined,
    deliver: (from, to, subject, body) => sessionOpts.deliver(from, to, subject, body),
  });
  // ADR-O001 D3. 'role' scope (the default) keeps the pre-D3 loop exactly: one
  // model session for the role's life, resumed across maxTurns restarts via
  // resumeSessionId. 'task' scope keys model sessions by the task a message
  // belongs to: the process exits at a task boundary (or on idle) and the next
  // one resumes that task's session from the ledger. Either way every session
  // run is recorded with its session id before and after.
  const scope = resolveSessionScope(opts.role, opts.def);
  const idleExitMs = (opts.def?.run_config as { session_idle_exit_ms?: number } | undefined)
    ?.session_idle_exit_ms;
  const ledger = opts.sessionLedger ?? new SessionLedger();
  // #562: the runtime that actually hosts the role, as runner selection
  // resolves it (a provider.kind of vercel-api-key runs on 'vercel').
  const configuredRuntime = opts.role.runtime ?? opts.def?.runtime;
  // An unknown or empty MONOMIND_RUNTIME selects no runner, so Claude hosts it.
  const runtimeKey = effectiveRoleRuntime(
    opts.role.runtime,
    opts.def?.runtime,
    opts.role.provider?.kind,
  );
  // Older builds filed such a role's records under 'claude'; such a record
  // holds this same runner's session, so it is still resumed (the ledger only
  // moves records those builds wrote). A role that set its runtime was never
  // keyed that way and never reads it.
  const legacyRuntimeKey =
    configuredRuntime === undefined && runtimeKey !== 'claude' ? 'claude' : undefined;
  let taskKey = ROLE_SESSION_KEY;
  // Why the next fresh session for a key is fresh, when the loop itself threw
  // the record away (stale resume, turn-limit error) — recorded, not guessed.
  const droppedBecause = new Map<string, SessionStartReason>();
  const staleTried = new Set<string>();
  // The options THIS session is built from — the role's own, except that a
  // task-scoped session carries its task's loadout (D7).
  let sessionOpts: SessionOpts = opts;
  let promptHash = '*';
  // Task scope: which task last wrote to each correspondent, so their
  // untagged reply goes back to that task's session (see mailRouteKey).
  const correspondents = new Map<string, string>();
  // Org sections spec 6.10 (Phase 2): the session cap, a between-turn rotation
  // threshold. Active only when context.session_cap sets a threshold.
  const sessionCap = contextSurface(opts.def).sessionCap;
  const capActive =
    sessionCap !== undefined && (sessionCap.tasks !== undefined || sessionCap.tokens !== undefined);
  // The task ids a message brings to a session, for the cap: its route key, if any.
  const incomingTasks = (message: string): string[] => {
    const k = mailRouteKey(message, correspondents);
    return k ? [k] : [];
  };
  const countersFor = (key: string): SessionCounters =>
    new SessionCounters(opts.bus.dir, opts.role.id, key);
  const doneTasks = (): number => {
    try {
      return (
        JSON.parse(opts.listTasks?.() ?? '[]') as { assignee?: string; status?: string }[]
      ).filter((t) => t.assignee === opts.role.id && t.status === 'done').length;
    } catch {
      return 0;
    }
  };
  /** Rotate the generation for `key` if its counters are at the cap; true when it did. */
  const rotateIfCapped = (key: string, next?: string): boolean => {
    const c = countersFor(key);
    const hit = capReached(
      c.state,
      sessionCap,
      next === undefined ? undefined : incomingTasks(next),
    );
    if (!hit) return false;
    const { from, overshoot } = c.rotate(hit, doneTasks());
    opts.bus.emit({
      type: 'audit',
      from: opts.role.id,
      reason: 'session-rotated',
      msg: `session for ${key} rotated: ${hit.reason} ${hit.value} reached the cap ${hit.cap}${overshoot ? ` (overshoot ${overshoot})` : ''}`,
      data: {
        role: opts.role.id,
        taskKey: key,
        generation: c.state.generation,
        reason: hit.reason,
        cap: hit.cap,
        tokens: from.tokens,
        tasks: from.tasks.length,
        overshoot,
      },
    });
    return true;
  };
  // Always run at least once: a mailbox can be closed with queued items still
  // pending (stream() drains the queue before honoring `closed`), which is a
  // normal, valid starting state - checking isClosed before the first run
  // would skip that drain entirely.
  while (true) {
    // Opt-in only: keep the process DOWN until there is mail, instead of
    // starting a query() that parks on an empty mailbox. waitForMessage()
    // still returns true for a closed mailbox with queued items.
    if (scope !== 'role' || idleExitMs !== undefined) {
      if (!(await mailbox.waitForMessage())) return;
    }
    let startReason: SessionStartReason;
    if (scope === 'cold') {
      // D6: nothing carries over — not a checkpointed session, not the last
      // message's. Paying the cache miss here is the point.
      resumeSessionId = undefined;
      startReason = 'fresh-cold';
    } else if (scope === 'task') {
      // An untagged message (mail, an answer, a continuation) belongs to the
      // session the role is already in.
      taskKey = mailRouteKey(mailbox.peek() ?? '', correspondents) ?? taskKey;
      const key = taskKey;
      // Past the cap this task's session starts fresh; its history is dropped, the task is not.
      if (capActive && rotateIfCapped(key, mailbox.peek())) {
        ledger.drop({ role: opts.role.id, runtime: runtimeKey, taskKey: key });
        droppedBecause.set(key, 'fresh-rotation');
      }
      sessionOpts = {
        ...opts,
        // D7: this task's session is built with this task's loadout.
        ...(key !== ROLE_SESSION_KEY && opts.loadoutFor ? { loadout: opts.loadoutFor(key) } : {}),
        // Mail sent from a task's session names the task in its subject, so
        // the reader knows what it is about and a reply can find its way back.
        deliver: (from, to, subject, body) => {
          if (key === ROLE_SESSION_KEY) return opts.deliver(from, to, subject, body);
          correspondents.set(to, key);
          const tagged = subject.includes('[task:') ? subject : `[task:${key}] ${subject}`;
          return opts.deliver(from, to, tagged, body);
        },
      };
      promptHash = createHash('sha256')
        .update(rolePromptFor(sessionOpts))
        .digest('hex')
        .slice(0, 16);
      const pick = ledger.resumeFor({
        role: opts.role.id,
        runtime: runtimeKey,
        taskKey,
        cwd: opts.cwd,
        promptHash,
        legacyRuntime: legacyRuntimeKey,
      });
      resumeSessionId = pick.sessionId;
      startReason =
        pick.reason === 'fresh-no-record'
          ? (droppedBecause.get(taskKey) ?? pick.reason)
          : pick.reason;
    } else {
      const rotated = capActive && rotateIfCapped(taskKey, mailbox.peek());
      if (rotated) resumeSessionId = undefined;
      startReason = rotated ? 'fresh-rotation' : resumeSessionId ? 'resumed' : 'fresh-no-record';
    }
    const sessionKey = taskKey;
    const roleTmpdir = tmp.for(sessionKey);
    if (roleTmpdir) sessionOpts = { ...sessionOpts, roleTmpdir };
    sessionOpts = { ...sessionOpts, contextKey: sessionKey };
    const baseStreamOpts: StreamOptions | undefined =
      scope === 'cold'
        ? { stopBefore: () => true, idleExitMs }
        : scope === 'task'
          ? {
              stopBefore: (next) => {
                const k = mailRouteKey(next, correspondents);
                return k !== undefined && k !== sessionKey;
              },
              idleExitMs,
            }
          : idleExitMs !== undefined
            ? { idleExitMs }
            : undefined;
    // The cap ends the stream between turns, whichever scope and mail path
    // (tagged, untagged fallback) the next message comes by.
    const streamOpts: StreamOptions | undefined =
      capActive && scope !== 'cold'
        ? {
            ...(baseStreamOpts ?? {}),
            stopBefore: (next) =>
              baseStreamOpts?.stopBefore?.(next) === true ||
              capReached(countersFor(sessionKey).state, sessionCap, incomingTasks(next)) !==
                undefined,
          }
        : baseStreamOpts;
    if (capActive && scope !== 'cold') {
      const counters = countersFor(sessionKey);
      sessionOpts = {
        ...sessionOpts,
        sessionCap: {
          admit: (message) => counters.admit(mailRouteKey(message, correspondents)),
          addTokens: (n) => counters.addTokens(n),
          usageMissing: () => {
            if (counters.noteUsageMissing() === 1)
              opts.bus.emit({
                type: 'audit',
                from: opts.role.id,
                reason: 'session-cap-usage-missing',
                msg: `a turn of ${sessionKey} reported no usage; the session cap cannot count it`,
                data: { role: opts.role.id, taskKey: sessionKey },
              });
          },
          rotation: (maxChars) => {
            const st = counters.state;
            const p = st.pending_rotation;
            if (!p) return undefined;
            let tasks: { id: string; title: string; assignee: string; status: string }[] = [];
            try {
              tasks = JSON.parse(opts.listTasks?.() ?? '[]');
            } catch {
              /* a digest without the task list still names the budget */
            }
            const pol = opts.policy;
            return {
              generation: st.generation,
              digest:
                maxChars < 200
                  ? ''
                  : buildRotationDigest(
                      {
                        role: opts.role.id,
                        generation: st.generation,
                        previous: { ...p.previous, cap: sessionCap ?? {}, reason: p.reason },
                        tasks,
                        stalled: st.stalled_rotations,
                        budget: {
                          usd: pol.usageUsd,
                          ...(pol.policy.maxUsd !== undefined ? { maxUsd: pol.policy.maxUsd } : {}),
                          tokens: pol.budgetedUsage,
                          ...(pol.policy.maxTokens !== undefined
                            ? { maxTokens: pol.policy.maxTokens }
                            : {}),
                        },
                      },
                      maxChars,
                    ),
            };
          },
          rotationApplied: () => counters.clearPendingRotation(),
        },
      };
    }
    const sessionIdBefore = resumeSessionId;
    const startedAt = Date.now();
    const recordRun = (after: string | undefined, error?: string): void => {
      const run = ledger.recordRun({
        role: opts.role.id,
        runtime: runtimeKey,
        taskKey: sessionKey,
        sessionIdBefore,
        sessionIdAfter: after,
        reason: startReason,
        startedAt,
        endedAt: Date.now(),
        ...(error ? { error } : {}),
      });
      opts.bus.emit({
        type: 'audit',
        from: opts.role.id,
        reason: 'session-run',
        msg: `session ${run.resumed ? 'resumed' : 'started fresh'} (${startReason}) for ${sessionKey}`,
        data: run as unknown as Record<string, unknown>,
      });
    };
    const realBefore = mailbox.consumedRealCount;
    let sessionId: string | undefined;
    let hitTurnLimit: boolean | undefined = false;
    const attempt = { replied: false };
    // Task scope: this process works on one task, so cancelling it ends it.
    const tracked = trackTaskProcess(opts.taskProcesses, scope, sessionKey);
    // #502 review round 3: what this session could plant is checked when it ends.
    const endPlantWatch = await beginPlantWatch(opts);
    try {
      const res = await runOneSession(
        sessionOpts,
        resumeSessionId,
        sessionCostTotals,
        attempt,
        sessionTokenTotals,
        streamOpts,
        faultRestarts.watch(sessionKey),
        tracked?.signal,
      ).finally(endPlantWatch);
      // Cancelled as the process was ending on its own: still owed the notice.
      if (tracked?.signal.aborted) throw tracked.signal.reason;
      sessionId = res.sessionId;
      hitTurnLimit = res.hitTurnLimit;
      resumeSessionId = sessionId;
      recordRun(sessionId);
      if (scope === 'task' && sessionId) {
        droppedBecause.delete(sessionKey);
        ledger.set({
          role: opts.role.id,
          runtime: runtimeKey,
          taskKey: sessionKey,
          cwd: opts.cwd,
          promptHash,
          sessionId,
        });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      recordRun(undefined, errMsg);
      // #304 (review round 3): an org's own stop aborts whatever this attempt
      // was doing — max-turns and stale-resume below are diagnoses for a
      // genuinely failed attempt, not for one the org itself just cut off.
      // Both branches SWALLOW (the loop continues or returns normally instead
      // of rethrowing), so if either fired during a stop the daemon's role
      // loop never runs its catch at all: no agent-stopped, no crash audit —
      // runAgentSession simply resolves. Excluding a stop/external-abort from
      // both conditions lets the error fall through to `else { throw err; }`
      // instead, so the daemon classifies it the same way it classifies every
      // other abort during a stop. Neither branch's own "retry"/"continue"
      // promise is worth anything once the mailbox is closed anyway — the
      // very next check below (`mailbox.isClosed || mailbox.isDraining`)
      // returns immediately — so rethrowing here costs nothing.
      const stopping = mailbox.isClosed || (opts.externalAbort?.signal.aborted ?? false);
      if (!stopping && err instanceof TaskCancelledError) {
        // Its work is abandoned: the notice starts a fresh, small session.
        sessionId = undefined;
        resumeSessionId = undefined;
        ledger.drop({ role: opts.role.id, runtime: runtimeKey, taskKey: sessionKey });
        queueCancelNotice(err, mailbox, opts.bus, opts.role.id, sessionKey);
      } else if (!stopping && err instanceof ProcessFaultError) {
        // Same session, new process: resume it and tell the role why.
        resumeSessionId = err.sessionId ?? resumeSessionId;
        if (scope === 'task' && err.sessionId) {
          ledger.set({
            role: opts.role.id,
            runtime: runtimeKey,
            taskKey: sessionKey,
            cwd: opts.cwd,
            promptHash,
            sessionId: err.sessionId,
          });
        }
        mailbox.push(faultRestarts.restarted(sessionKey, err.kind));
      } else if (!stopping && /Reached maximum number of turns|error_max_turns/i.test(errMsg)) {
        // Runner/SDK threw an error on max turns or exhausted turns on resume.
        // Drop the dead resumeSessionId and grant continuation turn with fresh session.
        sessionId = undefined;
        resumeSessionId = undefined;
        hitTurnLimit = true;
        if (scope === 'task') {
          ledger.drop({ role: opts.role.id, runtime: runtimeKey, taskKey: sessionKey });
          droppedBecause.set(sessionKey, 'fresh-after-turn-limit');
        }
      } else if (
        !stopping &&
        scope === 'task' &&
        sessionIdBefore !== undefined &&
        !staleTried.has(sessionKey) &&
        !attempt.replied
      ) {
        // D3's per-key form of #149 below: a recorded session that fails
        // before replying is treated as expired — forget it and retry that
        // task fresh once. Anything it had already pulled goes back first.
        staleTried.add(sessionKey);
        ledger.drop({ role: opts.role.id, runtime: runtimeKey, taskKey: sessionKey });
        droppedBecause.set(sessionKey, 'fresh-after-stale-resume');
        mailbox.reclaimInFlight();
        sessionId = undefined;
        resumeSessionId = undefined;
        hitTurnLimit = false;
        opts.bus.emit({
          type: 'status',
          from: opts.role.id,
          reason: 'resume-session-stale',
          msg: `agent "${opts.role.id}" could not resume its session for ${sessionKey} — retrying with a fresh session`,
          data: { error: errMsg },
        });
      } else if (
        !stopping &&
        scope === 'role' &&
        resumeSessionId &&
        resumeSessionId === initialResumeSessionId &&
        !triedFreshAfterResumeFailure &&
        // #247: a resumed session that already replied was resumable — a
        // later failure is a real crash. Let it reach the daemon's
        // crash-restart (which resumes again) instead of silently
        // continuing in a fresh, context-less session.
        !attempt.replied
      ) {
        // #149: first failure on a checkpoint-provided session id — treat as
        // a stale/expired resume, not a genuine crash. Retry once with a
        // fresh session before falling into the crash/backoff path below;
        // a second failure with no resumeSessionId in play is a real error.
        triedFreshAfterResumeFailure = true;
        sessionId = undefined;
        resumeSessionId = undefined;
        hitTurnLimit = false;
        // #304: no raw SDK text here either, same reason as runOneSession's
        // breadcrumb — this describes what session.ts itself did (retried),
        // not a characterisation of the underlying error. Kept in `data` for
        // debugging.
        opts.bus.emit({
          type: 'status',
          from: opts.role.id,
          reason: 'resume-session-stale',
          msg: `agent "${opts.role.id}" could not resume its prior session — retrying with a fresh session`,
          data: { error: errMsg },
        });
      } else {
        throw err;
      }
    } finally {
      tracked?.release();
      // #480: a closed task's session is over — its scratch goes with it.
      if (sessionKey !== ROLE_SESSION_KEY && opts.isTaskClosed?.(sessionKey))
        tmp.remove(sessionKey);
    }
    // The dead session's generator may still hold the waker - drop it so a
    // push() before the next stream() starts only queues instead of being
    // consumed by the abandoned generator (silent message loss).
    mailbox.detach();
    // A draining mailbox (mid-run role replacement's graceful quiesce, see
    // Mailbox.beginDrain) is the same terminal condition as closed for THIS
    // loop's purposes: stream() already returned cleanly instead of throwing,
    // so without this check the loop would just keep calling runOneSession
    // forever, since isClosed alone stays false for a deliberate drain.
    if (mailbox.isClosed || mailbox.isDraining) return;
    const madeProgress = mailbox.consumedRealCount > realBefore;
    if (hitTurnLimit && madeProgress) consecutiveSpin = 0;
    if (hitTurnLimit) {
      if (!madeProgress) consecutiveSpin++;
      if (consecutiveSpin < MAX_CONTINUATIONS) {
        mailbox.push(
          `${Mailbox.CONTINUE_PREFIX} You reached the per-session turn limit while still working. Continue your in-progress task from where you left off; if nothing remains, end your turn.`,
        );
        opts.bus.emit({
          type: 'status',
          from: opts.role.id,
          reason: 'turn-limit-resume',
          msg: 'session restarting (turn limit reached, mailbox still open)',
        });
      } else {
        // Spinning on continuations alone — park for the watchdog instead of
        // looping forever. Reset so the watchdog's nudge buys a fresh budget.
        consecutiveSpin = 0;
        opts.bus.emit({
          type: 'status',
          from: opts.role.id,
          reason: 'turn-limit-park',
          msg: 'turn limit hit repeatedly with no new input — parking for idle watchdog',
        });
      }
    } else if (mailbox.lastStreamEnd) {
      // D3: the process ended on purpose — a task boundary or idle — and the
      // model session is kept for the next wake.
      opts.bus.emit({
        type: 'status',
        from: opts.role.id,
        reason: 'session-cycled',
        msg: `process cycled (${mailbox.lastStreamEnd}); model session kept for ${sessionKey}`,
        data: { taskKey: sessionKey, end: mailbox.lastStreamEnd, sessionId },
      });
    } else {
      opts.bus.emit({
        type: 'status',
        from: opts.role.id,
        msg: 'session restarting (turn limit reached, mailbox still open)',
      });
    }
  }
}

export { buildOrgTools } from './org-tools.js';
export { AUTO_ASSIGNEE } from './task-tools.js';
