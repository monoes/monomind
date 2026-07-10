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
