/**
 * AX-tree ref cache persistence.
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
import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import type { ElementRef } from './types.js';

const CACHE_DIR = join(process.cwd(), '.monomind', 'monobrowse');
const CACHE_FILE = join(CACHE_DIR, 'ax-snapshot.json');
const PORT_FILE = join(CACHE_DIR, 'active-port.json');

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

/** Persist the current ref index for a target so a later CLI process can read it back. */
export async function saveRefCache(
  targetId: string,
  url: string,
  refs: Map<string, ElementRef>
): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const data: RefCacheFile = {
      targetId,
      url,
      savedAt: Date.now(),
      refs: [...refs.values()],
    };
    await writeFile(CACHE_FILE, JSON.stringify(data));
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
export async function loadRefCache(targetId: string): Promise<RefCacheEntry | null> {
  try {
    const raw = await readFile(CACHE_FILE, 'utf8');
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
export async function clearRefCache(): Promise<void> {
  try {
    await rm(CACHE_FILE, { force: true });
  } catch {
    // Nothing to clear, or not writable — non-fatal.
  }
}

/**
 * Persist the "active" CDP port so a later CLI invocation (each command is a
 * fresh process — see module header) can find the browser a prior `open
 * --port N` attached to, instead of every subsequent command silently
 * falling back to the hardcoded default port and launching/attaching to a
 * second, unrelated Chrome instance.
 */
export async function saveActivePort(port: number, opts?: { launched?: boolean }): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    // `launched` records provenance: true = monobrowse spawned this Chrome
    // (safe to Browser.close later); false = attached to a browser someone
    // else owns (must never be killed). Absent (old files) reads as launched
    // — matches pre-flag behavior where every persisted port came from open.
    await writeFile(PORT_FILE, JSON.stringify({ port, launched: opts?.launched !== false, savedAt: Date.now() }));
  } catch {
    // Best-effort — persistence failure just means the next process falls
    // back to the hardcoded default port, matching prior behavior.
  }
}

/** Forget the persisted active port (session closed) so later invocations
 *  fall back to the default instead of chasing a dead endpoint. */
export async function clearActivePort(): Promise<void> {
  try {
    await rm(PORT_FILE, { force: true });
  } catch {
    // Best-effort — a stale port file only costs one failed probe later.
  }
}

/** Load the persisted active port, or null if none was ever saved / it's unreadable. */
export async function loadActivePort(): Promise<number | null> {
  return (await loadActivePortInfo())?.port ?? null;
}

/** Load the persisted active port with its provenance flag. */
export async function loadActivePortInfo(): Promise<{ port: number; launched: boolean } | null> {
  try {
    const raw = await readFile(PORT_FILE, 'utf8');
    const data = JSON.parse(raw) as { port?: unknown; launched?: unknown };
    if (typeof data.port === 'number' && Number.isInteger(data.port) && data.port >= 1024 && data.port <= 65535) {
      return { port: data.port, launched: data.launched !== false };
    }
    return null;
  } catch {
    return null;
  }
}
