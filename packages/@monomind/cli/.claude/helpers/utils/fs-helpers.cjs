'use strict';
// Shared fs helpers for hook handlers.
//
// exFAT / macOS AppleDouble junk files (`._foo.json`, `.__protocol.md`, etc.)
// get created whenever files touch an exFAT volume (external drives, some
// network shares) and then get picked up by naive `readdirSync().filter(...)`
// calls as if they were real data — corrupting counts, getting parsed as
// JSON and failing, or (worst case) surfacing as garbage entries in
// Claude Code's own skill/command list. Every readdir in the hook handlers
// should route through `cleanEntries()` so this is filtered exactly once.

const fs = require('fs');
const path = require('path');

/**
 * Read a directory and filter out exFAT AppleDouble junk (`._*`) before
 * applying the caller's own filter predicate.
 * @param {string} dir - directory to read
 * @param {(name: string) => boolean} [filterFn] - optional additional filter
 * @returns {string[]} entry names (not full paths), junk-free
 */
function cleanEntries(dir, filterFn) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  entries = entries.filter(f => !f.startsWith('._'));
  return filterFn ? entries.filter(filterFn) : entries;
}

/**
 * Same as cleanEntries but returns full paths.
 */
function cleanEntryPaths(dir, filterFn) {
  return cleanEntries(dir, filterFn).map(f => path.join(dir, f));
}

/**
 * Synchronous sleep (blocks the event loop) — used for tiny lock-retry
 * backoffs where an async setTimeout would require restructuring a
 * short-lived hook script into a promise chain for no real benefit.
 * Falls back to a busy-wait if Atomics.wait is unavailable.
 */
function sleepSync(ms) {
  try {
    const sab = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(sab), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* spin */ }
  }
}

/**
 * Write a file atomically: write to a unique temp path then rename into
 * place. `fs.renameSync` is atomic on POSIX and Windows (same volume), so
 * concurrent readers of `filePath` never observe a partially-written file
 * (torn read) — they see either the old complete file or the new complete
 * file, never a half-written one. Does not by itself prevent lost updates
 * from concurrent read-modify-write cycles — pair with `claimLock` when
 * that matters (see hook-latency.json / swarm-activity.json writers).
 */
function atomicWriteFileSync(filePath, data, encoding) {
  const dir = path.dirname(filePath);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data, encoding);
  fs.renameSync(tmp, filePath);
}

/**
 * Claim an exclusive lock file for short-lived critical sections (e.g. a
 * rebuild-cooldown or spawn-once guard). Uses `wx` (exclusive create) so
 * the claim itself is atomic — no read-check-write window.
 *
 * On contention, a lock older than `staleMs` is treated as abandoned (the
 * holder crashed or never released it) and broken via an atomic RENAME
 * (never unlink-then-create): renaming the stale lock path away is only
 * ever won by exactly one racing process, so a concurrent process that
 * also decided the lock was stale cannot delete *this* process's
 * freshly-reclaimed lock out from under it (the TOCTOU race an
 * unlink-then-create approach is vulnerable to). The loser of the rename
 * race backs off and retries the whole claim sequence from the top rather
 * than assuming it owns anything.
 *
 * Returns true if the lock was claimed (caller must eventually call
 * `releaseLock`), false if another live/fresh owner holds it.
 */
function claimLock(lockPath, staleMs, maxAttempts) {
  staleMs = staleMs || 30000;
  maxAttempts = maxAttempts || 3;
  try { fs.mkdirSync(path.dirname(lockPath), { recursive: true }); } catch { /* ignore */ }
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      return true;
    } catch {
      let stat;
      try {
        stat = fs.statSync(lockPath);
      } catch {
        // Lock vanished between our failed wx-create and this stat check —
        // retry the create immediately.
        continue;
      }
      if (Date.now() - stat.mtimeMs < staleMs) return false; // held by a live/fresh owner

      const claimedName = `${lockPath}.${process.pid}.${Date.now()}.stale`;
      try {
        fs.renameSync(lockPath, claimedName);
      } catch {
        // Someone else already renamed the stale lock away — they're
        // claiming it. Back off briefly and retry from the top rather than
        // proceeding as if we own it.
        sleepSync(5);
        continue;
      }
      try { fs.unlinkSync(claimedName); } catch { /* ignore */ }
      // We won the rename race — loop back and attempt the wx-create fresh.
    }
  }
  return false;
}

/** Release a lock previously claimed by this process via `claimLock`. */
function releaseLock(lockPath) {
  try {
    if (Number(fs.readFileSync(lockPath, 'utf-8')) === process.pid) fs.unlinkSync(lockPath);
  } catch { /* ignore */ }
}

/**
 * Run `fn` while holding a lock (see `claimLock`) so a read-modify-write
 * cycle is protected end-to-end, not just the final write. If the lock
 * can't be claimed after retries, `fn` still runs (never block a hook) but
 * without lost-update protection — best-effort, matching this codebase's
 * "hooks must not block the session" rule.
 */
function withLock(lockPath, fn, staleMs, maxAttempts) {
  const acquired = claimLock(lockPath, staleMs, maxAttempts);
  try {
    return fn();
  } finally {
    if (acquired) releaseLock(lockPath);
  }
}

/**
 * Append a JSONL line and rotate the file down to `maxLines` (keep the
 * most recent lines) when it exceeds that count — mirrors the size-cap
 * pattern already used for intelligence-outcomes.jsonl (500 lines) and
 * episodes.jsonl. Prevents unbounded JSONL growth. Rotation write is
 * atomic (tmp+rename).
 */
function appendJsonlWithRotation(filePath, line, maxLines) {
  maxLines = maxLines || 500;
  try { fs.mkdirSync(path.dirname(filePath), { recursive: true }); } catch { /* ignore */ }
  fs.appendFileSync(filePath, line.endsWith('\n') ? line : line + '\n');
  try {
    const st = fs.statSync(filePath);
    // Cheap heuristic to skip reading huge files line-by-line on every
    // append: only bother counting lines once the file is already
    // suspiciously large relative to a plausible maxLines * avg-line-size.
    if (st.size < 4096) return;
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
    if (lines.length > maxLines) {
      atomicWriteFileSync(filePath, lines.slice(-maxLines).join('\n') + '\n', 'utf-8');
    }
  } catch { /* non-fatal — rotation is best-effort */ }
}

module.exports = {
  cleanEntries,
  cleanEntryPaths,
  sleepSync,
  atomicWriteFileSync,
  claimLock,
  releaseLock,
  withLock,
  appendJsonlWithRotation,
};
