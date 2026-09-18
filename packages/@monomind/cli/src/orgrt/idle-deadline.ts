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

export interface IdleWatchdogRecord {
  run: string;
  idle_minutes: number;
  /** ISO time the watchdog stops the run if nothing happens before then. */
  idle_stop_at: string | null;
  hold: IdleHold | null;
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
  if (!rec.idle_stop_at)
    return { idle_stop_at: null, idle_stop_in_seconds: null, idle_hold: rec.hold };
  return {
    idle_stop_at: rec.idle_stop_at,
    idle_stop_in_seconds: Math.max(0, Math.round((Date.parse(rec.idle_stop_at) - now) / 1000)),
    idle_hold: null,
  };
}
