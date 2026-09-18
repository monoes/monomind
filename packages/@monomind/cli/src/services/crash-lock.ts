/**
 * Advisory lock around the crash ledger's check-then-write sequence.
 *
 * Split out of crash-reporter.ts (i-055-cli revision round 1, alongside
 * crash-consent.ts) to keep that file under the repo's 500-line guideline —
 * locking is a distinct, self-contained concern from redaction/dedup/filing.
 */

import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureStateDir, STATE_DIR } from './crash-consent.js';

const LOCK_PATH = join(STATE_DIR, 'crash-reports.lock');

// Worst-case critical section is ~28s (5s hasGhAuth + 8s upstream search + 15s
// issue create) — stale threshold needs real margin above that so a slow-but-
// legitimate holder never gets its lock stolen mid-operation.
const LOCK_STALE_MS = 60 * 1000;
const LOCK_WAIT_MS = 3 * 1000; // bounded poll for a concurrent holder to finish — closes the
// near-simultaneous-crash race without blocking the handler for long

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Tries once to atomically create the lock file, tagged with an ownership id. */
function tryAcquireOnce(lockId: string): boolean {
  ensureStateDir();
  try {
    const fd = openSync(LOCK_PATH, 'wx');
    writeFileSync(fd, lockId);
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort advisory lock around the ledger's check-then-write sequence,
 * to close the race where two near-simultaneous crashes (e.g. a supervisor
 * restarting a process that panics on every startup) both pass the dedup
 * check before either records its result, filing duplicate issues.
 *
 * Returns an ownership id if acquired (pass to releaseLock so it only ever
 * removes its OWN lock, never one a stale-recovery elsewhere already
 * re-acquired), or null if not acquired — callers proceed unlocked rather
 * than block indefinitely, since a lock miss only reopens the same race this
 * exists to narrow, not something worth ever hanging a crash handler over.
 */
export async function acquireLock(): Promise<string | null> {
  const lockId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  if (tryAcquireOnce(lockId)) return lockId;

  // Bounded poll: closes the race for genuinely-simultaneous crashes (the
  // common real case — e.g. two crash handlers firing within the same
  // second) without blocking the handler for the full worst-case critical
  // section duration.
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(150);
    if (tryAcquireOnce(lockId)) return lockId;
  }

  // Still held — check staleness (crashed holder that never released it).
  try {
    const age = Date.now() - statSync(LOCK_PATH).mtimeMs;
    if (age > LOCK_STALE_MS) {
      unlinkSync(LOCK_PATH);
      if (tryAcquireOnce(lockId)) return lockId;
    }
  } catch {
    // lock disappeared or another race — fall through to unlocked
  }
  return null;
}

export function releaseLock(lockId: string | null): void {
  if (!lockId) return;
  try {
    if (readFileSync(LOCK_PATH, 'utf8') === lockId) unlinkSync(LOCK_PATH);
    // else: someone else's lock (ours was stolen after going stale) — leave it alone
  } catch {
    // already gone — fine
  }
}
