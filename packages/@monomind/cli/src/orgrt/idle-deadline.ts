/**
 * Idle-watchdog deadline (#296, capability `org-idle-deadline`).
 *
 * The daemon's idle watchdog (daemon.ts) keeps its clock in memory, but
 * `org status --json` runs in another process. The watchdog therefore
 * publishes its projected stop time to `<org>/idle-watchdog.json` on each
 * check, and status reads it back. It is a file, not a bus event, because
 * every bus event counts as org activity and would reset the very clock
 * it reports.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonFileAtomic } from '../utils/json-file.js';
import { ORG_DIR } from './types.js';

export const IDLE_WATCHDOG_FILE = 'idle-watchdog.json';

/** Why there is no deadline right now. Every value except `disabled` is a
 *  legitimate wait the watchdog will not nudge or stop through. */
export type IdleHold =
  | 'disabled'
  | 'restarting'
  | 'pending-gate'
  | 'pending-question'
  | 'pending-approval'
  | 'endpoint-reply-due'
  | 'task-blocked';

/** Every hold reason except `disabled` describes a *wait*: the run is alive
 *  and legitimately not progressing yet. `disabled` is the operator having
 *  switched the watchdog off (`run_config.idle_minutes: 0`), which is not a
 *  wait and not a stall. */
export type WaitHold = Exclude<IdleHold, 'disabled'>;

/** ADR-O001 D4 — "every hold carries a deadline". The shape makes a hold
 *  with no expiry unrepresentable: a wait hold MUST name the instant it stops
 *  suppressing the idle clock. A `hold` used to be a bare reason string and a
 *  `null` deadline, which disabled the idle stop for as long as the reason
 *  held — measured live at 8.3 hours on `{"hold":"pending-question"}`, with
 *  the first turn after the gap costing $17.33 because the prompt cache had
 *  long since expired. */
export type IdleHoldState =
  | { reason: 'disabled'; until: null }
  | { reason: WaitHold; until: string };

/** How long any single wait may suppress the idle watchdog before the run
 *  goes back on the normal nudge-then-stop path. Deliberately generous — a
 *  human answering a question, approving a tool call or resolving a gate has
 *  an hour — and deliberately finite, because the alternative measured 8.3
 *  hours. An expired hold does not stop the run by itself: it hands the run
 *  back to the idle clock, which nudges the boss first. */
export const HOLD_TTL_MS = 60 * 60_000;

/** One watchdog tick's view of the current hold. `since` anchors the deadline
 *  to when the reason FIRST appeared — recomputing it per tick is exactly how
 *  a hold lives forever. `alarmed` keeps the expiry audit event to one per
 *  spell (same "once, not every tick" rule as `resolvedIdleNudgeCount`). */
export interface HoldTrack {
  reason: WaitHold;
  since: number;
  alarmed: boolean;
}

/** Advance the hold tracker one watchdog tick.
 *  - `hold` is the hold still in force, or null once it has expired (or when
 *    nothing is holding) — null means the caller runs its normal idle checks.
 *  - `expired` names the reason on the single tick the deadline passes, so
 *    the caller can say so loudly once instead of every 30 seconds.
 *
 *  A wait that knows its own end (a task blocked until a stated real-world
 *  time) passes that instant as `until` and keeps it; everything else — the
 *  waits on a human or a remote peer, which are the ones that can wait
 *  forever — gets `ttlMs` from when the reason first appeared. A changed
 *  reason is a new wait and gets a fresh deadline. */
export function advanceHold(
  prev: HoldTrack | null,
  wait: WaitHold | { reason: WaitHold; until: number } | null,
  now: number,
  ttlMs: number = HOLD_TTL_MS,
): { track: HoldTrack | null; hold: IdleHoldState | null; expired: WaitHold | null } {
  if (!wait) return { track: null, hold: null, expired: null };
  const reason = typeof wait === 'string' ? wait : wait.reason;
  const track: HoldTrack =
    prev && prev.reason === reason ? prev : { reason, since: now, alarmed: false };
  const until = typeof wait === 'string' ? track.since + ttlMs : wait.until;
  if (now < until)
    return { track, hold: { reason, until: new Date(until).toISOString() }, expired: null };
  return { track: { ...track, alarmed: true }, hold: null, expired: track.alarmed ? null : reason };
}

/** ADR-O001 D4 — the no-progress detector, Gas Town's "30 minutes hooked
 *  without progress" alarm. The idle clock is org-wide and says nothing at
 *  all while a hold is in force, so a role that is nominally working while
 *  producing no bus activity has to be surfaced on its own. A role that has
 *  ended or crashed is silent for a good reason and is not reported. */
export const NO_PROGRESS_MS = 30 * 60_000;

export function noProgressRoles(
  roles: ReadonlyArray<{ id: string; working: boolean; lastActivity: number; alarmed: boolean }>,
  now: number,
  thresholdMs: number = NO_PROGRESS_MS,
): Array<{ id: string; silentMs: number }> {
  return roles
    .filter((r) => r.working && !r.alarmed && now - r.lastActivity >= thresholdMs)
    .map((r) => ({ id: r.id, silentMs: now - r.lastActivity }));
}

export interface IdleWatchdogRecord {
  run: string;
  idle_minutes: number;
  /** ISO time the watchdog stops the run if nothing happens before then. */
  idle_stop_at: string | null;
  hold: IdleHoldState | null;
}

/** When the watchdog stops the run, assuming no further activity. The stop
 *  lands on the first check at or after this time (checks run every
 *  min(idle/2, 30s)), so treat it as the earliest stop, not an exact one.
 *  - after a nudge: one more idle window from the nudge;
 *  - nudge cap reached, or boss unreachable: at the end of this idle window;
 *  - otherwise: a nudge at the end of this window, then one more window. */
export function projectIdleStop(s: {
  lastActivity: number;
  nudgedAt: number;
  nudges: number;
  maxNudges: number;
  idleMs: number;
  bossReachable: boolean;
}): number {
  if (s.nudgedAt !== 0) return s.nudgedAt + s.idleMs;
  if (s.nudges >= s.maxNudges || !s.bossReachable) return s.lastActivity + s.idleMs;
  return s.lastActivity + 2 * s.idleMs;
}

function recordPath(root: string, name: string): string {
  return join(root, ORG_DIR, name, IDLE_WATCHDOG_FILE);
}

export function writeIdleRecord(root: string, name: string, rec: IdleWatchdogRecord): void {
  writeJsonFileAtomic(recordPath(root, name), rec);
}

export function clearIdleRecord(root: string, name: string): void {
  rmSync(recordPath(root, name), { force: true });
}

/** Status fields for a running org. A missing or mismatched record (a daemon
 *  older than this feature, or one that has not checked yet) is reported as
 *  `idle_hold: 'unknown'` rather than guessed. */
export function readIdleStatus(
  root: string,
  name: string,
  run: string | undefined,
  now = Date.now(),
): {
  idle_stop_at: string | null;
  idle_stop_in_seconds: number | null;
  idle_hold: IdleHold | 'unknown' | null;
  /** ISO time the hold expires and the idle clock resumes (ADR-O001 D4).
   *  `null` for `disabled`, and for a record written by a pre-D4 daemon whose
   *  holds had no deadline at all. */
  idle_hold_until?: string | null;
} {
  const unknown = { idle_stop_at: null, idle_stop_in_seconds: null, idle_hold: 'unknown' as const };
  const p = recordPath(root, name);
  if (!run || !existsSync(p)) return unknown;
  let rec: IdleWatchdogRecord;
  try {
    rec = JSON.parse(readFileSync(p, 'utf8')) as IdleWatchdogRecord;
  } catch {
    return unknown;
  }
  if (rec.run !== run) return unknown;
  if (!rec.idle_stop_at) {
    // A pre-D4 daemon wrote the reason as a bare string with no deadline.
    const hold = rec.hold as IdleHoldState | IdleHold | null;
    return typeof hold === 'string'
      ? { idle_stop_at: null, idle_stop_in_seconds: null, idle_hold: hold, idle_hold_until: null }
      : {
          idle_stop_at: null,
          idle_stop_in_seconds: null,
          idle_hold: hold?.reason ?? null,
          idle_hold_until: hold?.until ?? null,
        };
  }
  return {
    idle_stop_at: rec.idle_stop_at,
    idle_stop_in_seconds: Math.max(0, Math.round((Date.parse(rec.idle_stop_at) - now) / 1000)),
    idle_hold: null,
    idle_hold_until: null,
  };
}
