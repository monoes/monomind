/**
 * Per-session CLI state: the browse session index, and the AX-tree ref cache
 * each session owns.
 *
 * Both are keyed by CDP port and scoped to the working directory: one file
 * per browse session under `sessions/`, one ref cache per session beside it.
 * A single shared `active-port.json` / `ax-snapshot.json` pair used to stand
 * for "the" session, which is why two concurrent `open` invocations in one
 * directory overwrote each other's handle (#318).
 *
 * `snapshot` and `find` are separate CLI invocations — each starts a fresh
 * node process, so the in-memory ElementRef Map built by captureSnapshot()
 * does not survive between them. This module persists a lightweight lookup
 * index (ref -> role/name/nodeId/backendDOMNodeId, i.e. everything CDP needs
 * to re-target an element) to disk so a later process can rehydrate it.
 *
 * The full AX-tree text/dump is intentionally NOT persisted — only the
 * per-ref index, to keep the file small.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElementRef } from './types.js';

const CACHE_DIR = join(process.cwd(), '.monomind', 'monobrowse');
const SESSIONS_DIR = join(CACHE_DIR, 'sessions');
const refCacheFile = (port: number) => join(CACHE_DIR, `ax-snapshot-${port}.json`);
const sessionFile = (port: number) => join(SESSIONS_DIR, `${port}.json`);
// The pre-#318 layout: one session per directory, plus its one ref cache.
// Still read (see loadLegacySessionRecord) so a session opened by an older
// CLI is adopted rather than orphaned when monobrowse is upgraded under it.
const LEGACY_SESSION_FILE = join(CACHE_DIR, 'active-port.json');
const LEGACY_REF_CACHE_FILE = join(CACHE_DIR, 'ax-snapshot.json');

/** Snapshot older than this is flagged as possibly stale (page may have changed). */
export const REF_CACHE_STALE_MS = 30_000;

interface RefCacheFile {
  targetId: string;
  url: string;
  savedAt: number;
  refs: ElementRef[];
}

export interface RefCacheEntry {
  refs: Map<string, ElementRef>;
  url: string;
  savedAt: number;
  ageMs: number;
  stale: boolean;
}

/** Persist the current ref index for a target so a later CLI process can read
 *  it back. Scoped to the session's port so two sessions open in the same
 *  directory keep their own refs instead of clobbering one file. */
export async function saveRefCache(
  port: number,
  targetId: string,
  url: string,
  refs: Map<string, ElementRef>,
): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const data: RefCacheFile = {
      targetId,
      url,
      savedAt: Date.now(),
      refs: [...refs.values()],
    };
    await writeFile(refCacheFile(port), JSON.stringify(data));
  } catch {
    // Best-effort — persistence failure just means cross-process rehydration
    // won't work; in-process (same run) behavior is unaffected.
  }
}

/**
 * Load the persisted ref index, scoped to the given targetId (a cache from a
 * different tab/target is ignored). Returns null if no usable cache exists —
 * callers fall back to an empty in-memory Map, matching prior behavior.
 */
export async function loadRefCache(port: number, targetId: string): Promise<RefCacheEntry | null> {
  try {
    const raw = await readFile(refCacheFile(port), 'utf8');
    const data: RefCacheFile = JSON.parse(raw);
    if (!data || !Array.isArray(data.refs) || data.targetId !== targetId) return null;

    const refs = new Map<string, ElementRef>();
    for (const ref of data.refs) {
      if (ref && typeof ref.ref === 'string') refs.set(ref.ref, ref);
    }
    if (refs.size === 0) return null;

    const ageMs = Date.now() - data.savedAt;
    return { refs, url: data.url, savedAt: data.savedAt, ageMs, stale: ageMs > REF_CACHE_STALE_MS };
  } catch {
    return null;
  }
}

/** Drop the persisted ref index — call whenever refs are invalidated (navigation, tab switch, close). */
export async function clearRefCache(port: number): Promise<void> {
  try {
    await rm(refCacheFile(port), { force: true });
  } catch {
    // Nothing to clear, or not writable — non-fatal.
  }
}

/**
 * A browse session: one Chrome instance, identified by the CDP port it
 * listens on, recorded so a LATER CLI invocation (each command is its own
 * node process — see module header) can find it again.
 */
export interface SessionRecord {
  port: number;
  /** true = monobrowse launched this Chrome (safe to Browser.close later);
   *  false = we attached to a browser someone else owns (never kill it). */
  launched: boolean;
  pid?: number;
  userDataDir?: string;
  savedAt?: number;
}

/**
 * Record a browse session under its own port, so concurrent sessions in the
 * same working directory coexist instead of overwriting one shared handle.
 *
 * `pid`/`userDataDir` are persisted so a later, fresh CLI process can still
 * find and kill the Chrome this one launched. Without them, closeBrowser()'s
 * PID-kill fallback can never fire outside the launching process, since the
 * in-memory launchedPids Map (browser.ts) is empty there.
 */
export async function saveSessionRecord(
  port: number,
  opts?: { launched?: boolean; pid?: number; userDataDir?: string; savedAt?: number },
): Promise<void> {
  try {
    await mkdir(SESSIONS_DIR, { recursive: true });
    // `launched` absent (older files) reads as launched — matches the
    // pre-flag behavior where every persisted port came from `open`.
    //
    // `savedAt` is passed only when re-recording a session that already
    // existed (adopting a legacy record), so its real age — which is what
    // the idle reaper and the newest-first ordering read — is preserved.
    await writeFile(
      sessionFile(port),
      JSON.stringify({
        port,
        launched: opts?.launched !== false,
        pid: opts?.pid,
        userDataDir: opts?.userDataDir,
        savedAt: opts?.savedAt ?? Date.now(),
      }),
    );
  } catch {
    // Best-effort — persistence failure costs the next process the ability to
    // find this session, not this command's own correctness.
  }
}

/** Forget one session (it was closed, or its browser is gone) so later
 *  invocations don't chase a dead endpoint. */
export async function removeSessionRecord(port: number): Promise<void> {
  try {
    await rm(sessionFile(port), { force: true });
  } catch {
    // Best-effort — a stale record only costs one failed probe later.
  }
}

/** The session recorded for `port`, or null if there is none / it's unreadable. */
export async function loadSessionRecord(port: number): Promise<SessionRecord | null> {
  try {
    return parseSessionRecord(await readFile(sessionFile(port), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The session a pre-#318 CLI left behind in this directory, if any.
 *
 * That layout held exactly one session in `active-port.json`. Upgrading
 * monobrowse while such a session was open would otherwise strand its
 * Chrome: nothing reads that file any more, so the new CLI could neither
 * find nor close it. It is read here as one more candidate session and then
 * either adopted (rewritten as `sessions/<port>.json`) or dropped — see
 * adoptLegacySession() in cli/session.ts. Nothing ever writes it again.
 */
export async function loadLegacySessionRecord(): Promise<SessionRecord | null> {
  try {
    return parseSessionRecord(await readFile(LEGACY_SESSION_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/** Drop the pre-#318 files, once their session has been adopted or found
 *  dead. The single ref cache goes with them: it belonged to that one
 *  session, and nothing reads it any more either. */
export async function removeLegacySessionRecord(): Promise<void> {
  try {
    await rm(LEGACY_SESSION_FILE, { force: true });
    await rm(LEGACY_REF_CACHE_FILE, { force: true });
  } catch {
    // Best-effort — a leftover file is inert; it is only ever read again.
  }
}

/** Every recorded session in this working directory, newest first. */
export async function listSessionRecords(): Promise<SessionRecord[]> {
  let entries: string[];
  try {
    entries = await readdir(SESSIONS_DIR);
  } catch {
    return [];
  }
  const records: SessionRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const record = parseSessionRecord(await readFile(join(SESSIONS_DIR, entry), 'utf8'));
      if (record) records.push(record);
    } catch {
      // Unreadable file — skip it rather than failing the whole listing.
    }
  }
  return records.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

function parseSessionRecord(raw: string): SessionRecord | null {
  const data = JSON.parse(raw) as {
    port?: unknown;
    launched?: unknown;
    pid?: unknown;
    userDataDir?: unknown;
    savedAt?: unknown;
  };
  if (
    typeof data.port !== 'number' ||
    !Number.isInteger(data.port) ||
    data.port < 1024 ||
    data.port > 65535
  ) {
    return null;
  }
  return {
    port: data.port,
    launched: data.launched !== false,
    pid:
      typeof data.pid === 'number' && Number.isInteger(data.pid) && data.pid > 0
        ? data.pid
        : undefined,
    userDataDir: typeof data.userDataDir === 'string' ? data.userDataDir : undefined,
    savedAt: typeof data.savedAt === 'number' ? data.savedAt : undefined,
  };
}
