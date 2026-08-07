/**
 * File-permission hardening for the local memory store.
 *
 * memory.db holds personal "second brain" data (memories, knowledge,
 * session notes). sql.js exports it via writeFileSync, which creates the
 * file with the process umask default — world-readable on many systems.
 * Restrict the persisted DB to owner read/write (0600) after every write.
 */

import { chmodSync } from 'node:fs';

/**
 * Restrict a persisted memory DB file to owner-only (0600).
 * No-op on win32 (POSIX modes unsupported) and best-effort elsewhere —
 * a chmod failure must never break a memory write.
 */
export function secureDbFilePermissions(filePath: string): void {
  if (process.platform === 'win32') return;
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // best effort — e.g. filesystem without POSIX permission support
  }
}
