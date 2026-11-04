// packages/@monomind/cli/src/orgrt/sandbox-stubs-ledger.ts
// Split out of sandbox-stubs.ts (file-size sweep) — the per-machine crash
// ledger (defaultStubLedger, LedgerEntry, readLedger/writeLedger) and the
// pid-namespace/boot identity a reclaim() needs to tell a dead runtime's
// entries apart from a live one's (that identity now lives in
// shared/process-identity.ts and is re-exported here). See sandbox-stubs.ts's header.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

/** The per-machine crash ledger: `MONOMIND_ORGRT_STUBS_DIR`, else
 *  ~/.monomind/orgrt-sandbox-stubs (next to orgrt-broker and orgrt-operator). */
export function defaultStubLedger(env: NodeJS.ProcessEnv = process.env): string {
  return join(
    env.MONOMIND_ORGRT_STUBS_DIR || join(homedir(), '.monomind', 'orgrt-sandbox-stubs'),
    'ledger.json',
  );
}

export interface LedgerEntry {
  path: string;
  ino: number;
  dev: number;
  kind: 'file' | 'dir';
  /** A file stub's ctime at creation: an inode number is reused as soon as a
   *  file is deleted, so dev+ino alone cannot tell our stub from an empty file
   *  someone recreated at the same path. Absent on older entries. */
  ctimeMs?: number;
  pid: number;
  /** This pid's namespace and boot, so a later reclaim() can tell a dead pid
   *  in our own namespace apart from a live one we simply cannot see from a
   *  different namespace. Absent on an entry written before this field
   *  existed (see isLegacy). */
  pidNamespace?: string;
  bootId?: string;
  runId: string;
  createdAt: string;
}

export function readLedger(file: string): LedgerEntry[] {
  try {
    const entries = (JSON.parse(readFileSync(file, 'utf8')) as { entries?: unknown }).entries;
    if (!Array.isArray(entries)) return [];
    return entries.filter(
      (e): e is LedgerEntry =>
        !!e &&
        typeof e.path === 'string' &&
        isAbsolute(e.path) &&
        typeof e.ino === 'number' &&
        typeof e.dev === 'number' &&
        (e.kind === 'file' || e.kind === 'dir') &&
        (e.ctimeMs === undefined || typeof e.ctimeMs === 'number') &&
        Number.isInteger(e.pid) &&
        (e.pidNamespace === undefined || typeof e.pidNamespace === 'string') &&
        (e.bootId === undefined || typeof e.bootId === 'string'),
    );
  } catch {
    return []; // missing or corrupt: nothing to reclaim
  }
}

/** Atomic (tmp + rename). Only a write that adds entries makes the dir: a
 *  removal has nothing to record where there is no ledger. */
export function writeLedger(file: string, entries: LedgerEntry[], create: boolean): void {
  try {
    if (create) mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ entries }, null, 2)}\n`);
    renameSync(tmp, file);
  } catch {
    /* best-effort: the stubs still work, only crash recovery is lost */
  }
}

export const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
};

export { defaultIdentity, type IdentitySource } from '../shared/process-identity.js';

/** An entry recorded before pid-namespace awareness (no `pidNamespace`/
 *  `bootId`), or one whose reader could not read them: falls back to the
 *  bare pid check (today's behavior, and correct outside any sandbox). */
export function isLegacy(e: LedgerEntry): boolean {
  return e.pidNamespace === undefined || e.bootId === undefined;
}
