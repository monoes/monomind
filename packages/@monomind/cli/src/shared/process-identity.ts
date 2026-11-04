// packages/@monomind/cli/src/shared/process-identity.ts
// Moved out of orgrt/sandbox-stubs-ledger.ts so utils/optional-deps.ts (lock
// staleness) and the Org Runtime's stub ledger share it without an import
// cycle between orgrt and the rest of the cli. orgrt/sandbox-stubs-ledger.ts
// re-exports it.
import { readdirSync, readFileSync, readlinkSync } from 'node:fs';

/** Reads what identifies THIS process's pid namespace and boot, so a ledger
 *  entry can later tell a dead pid in our own namespace (safe to reclaim)
 *  apart from a live daemon's pid that we simply cannot see (the Claude SDK
 *  sandbox runs every role with `bwrap --unshare-pid`: `process.kill(pid, 0)`
 *  on a pid outside our namespace always throws ESRCH, alive or not). */
export interface IdentitySource {
  /** `/proc/self/ns/pid`'s target, e.g. `pid:[4026531836]`; undefined if it
   *  cannot be read (older kernel, no /proc). */
  pidNamespace(): string | undefined;
  /** `/proc/sys/kernel/random/boot_id`, stable for one boot and never reused
   *  across a reboot — unlike a pid, which is. */
  bootId(): string | undefined;
  /** Is any process still in pid namespace `ns`? `false` only when that is
   *  provable — we are in the initial pid namespace, which sees every
   *  process, and none of our own readable processes is in `ns` (a namespace
   *  our roles' bwrap created holds only this user's processes). `undefined`
   *  when we cannot tell: inside a sandbox's own namespace, or no /proc. */
  namespaceLive?(ns: string): boolean | undefined;
}

/** The initial pid namespace's inode on Linux (PROC_PID_INIT_INO). */
const INIT_PID_NS = 'pid:[4026531836]';

export const defaultIdentity: IdentitySource = {
  pidNamespace(): string | undefined {
    try {
      return readlinkSync('/proc/self/ns/pid');
    } catch {
      return undefined;
    }
  },
  bootId(): string | undefined {
    try {
      return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    } catch {
      return undefined;
    }
  },
  namespaceLive(ns: string): boolean | undefined {
    try {
      if (readlinkSync('/proc/self/ns/pid') !== INIT_PID_NS) return undefined;
      for (const pid of readdirSync('/proc')) {
        if (!/^\d+$/.test(pid)) continue;
        try {
          if (readlinkSync(`/proc/${pid}/ns/pid`) === ns) return true;
        } catch {
          /* exited, or another user's process — never in our roles' namespaces */
        }
      }
      return false;
    } catch {
      return undefined;
    }
  },
};
