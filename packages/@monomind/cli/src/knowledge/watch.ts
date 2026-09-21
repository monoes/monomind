/**
 * Watch a captured page for change (RCL-08).
 *
 * WHAT THIS IS NOT: a scheduler, a daemon, or a fetcher. `checkWatches` is
 * invoked by something else — mono-agent's scheduler drives it — and it does
 * not touch the network. It re-reads what the pipeline already stored and
 * compares content hashes, which is exactly the versioning RCL-06 put there.
 * A re-capture is what makes a page "change"; this reports it.
 *
 * The watch list is a small JSON file next to the metadata log, keyed by the
 * page's identity URL (or, for a local file, its path). Writes go through a
 * temp file and a rename so a crashed check cannot leave a half-written list.
 *
 * @module v1/cli/knowledge/watch
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { diffSections, type SectionDiff } from './section-diff.js';

export const WATCH_FILE = 'watches.json';
export const DEFAULT_INTERVAL_SECONDS = 86_400;

export interface WatchEntry {
  /** Identity: the capture's canonical URL, or an indexed file path. */
  url: string;
  scope: string;
  intervalSeconds: number;
  /** Content hash last seen by a check — the baseline the next one compares to. */
  lastHash?: string;
  lastCheckedAt?: string;
  lastChangedAt?: string;
  addedAt: string;
  label?: string;
}

export type WatchStatus = 'changed' | 'unchanged' | 'new' | 'missing' | 'not-due';

export interface WatchCheck {
  url: string;
  scope: string;
  status: WatchStatus;
  checkedAt: string;
  filePath?: string;
  title?: string;
  previousHash?: string;
  currentHash?: string;
  version?: number;
  capturedAt?: string;
  /** Present on `changed`, unless the previous version's file is gone. */
  diff?: SectionDiff;
  /** Why a change could not be summarized, when it could not. */
  note?: string;
}

export interface WatchCheckReport {
  checked: number;
  changed: number;
  skipped: number;
  results: WatchCheck[];
}

// ── Store ──────────────────────────────────────────────────────────

function watchPath(rootDir: string): string {
  return path.join(rootDir, '.monomind', 'knowledge', WATCH_FILE);
}

export function listWatches(rootDir: string): WatchEntry[] {
  try {
    const raw = fs.readFileSync(watchPath(rootDir), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((w): w is WatchEntry => !!w && typeof w.url === 'string');
  } catch {
    // Absent, unreadable or corrupt: an empty watch list, never a thrown error
    // in something a scheduler calls on a timer.
    return [];
  }
}

function writeWatches(rootDir: string, entries: WatchEntry[]): void {
  const file = watchPath(rootDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(entries, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmp, file);
}

const INTERVAL_RE = /^(\d+(?:\.\d+)?)\s*(s|m|h|d|w)?$/i;
const INTERVAL_UNIT: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400, w: 604_800 };

/** `30m`, `6h`, `2d`, or bare seconds. Throws on a typo — a watch that
 *  silently defaulted to daily would look like it was working. */
export function parseInterval(value: string | number | undefined): number {
  if (value === undefined || value === '') return DEFAULT_INTERVAL_SECONDS;
  const m = INTERVAL_RE.exec(String(value).trim());
  if (!m) throw new Error(`unparseable interval: ${value} (use 30m, 6h, 2d)`);
  const seconds = Number(m[1]) * INTERVAL_UNIT[(m[2] ?? 's').toLowerCase()];
  if (!Number.isFinite(seconds) || seconds <= 0)
    throw new Error(`interval must be positive: ${value}`);
  return Math.round(seconds);
}

export interface AddWatchOptions {
  interval?: string | number;
  scope?: string;
  label?: string;
  now?: Date;
}

/**
 * Watch `target` (a URL, a docId or an indexed path).
 *
 * The baseline is seeded from what is indexed RIGHT NOW, so the first check
 * after adding reports nothing — a watch exists to catch the NEXT change, not
 * to re-announce the capture that created it. Re-adding an existing watch
 * updates its interval and label and keeps the baseline.
 */
export async function addWatch(
  rootDir: string,
  target: string,
  opts: AddWatchOptions = {},
): Promise<WatchEntry> {
  const { findDocumentRecord } = await import('./document-pipeline.js');
  const scope = opts.scope ?? 'shared';
  const record = findDocumentRecord(rootDir, target, opts.scope);
  const url = record?.canonicalUrl ?? record?.filePath ?? target;
  const intervalSeconds = parseInterval(opts.interval);
  const now = (opts.now ?? new Date()).toISOString();

  const entries = listWatches(rootDir);
  const existing = entries.find((w) => w.url === url && w.scope === scope);
  if (existing) {
    existing.intervalSeconds = intervalSeconds;
    if (opts.label) existing.label = opts.label;
    writeWatches(rootDir, entries);
    return existing;
  }

  const entry: WatchEntry = {
    url,
    scope: record?.scope ?? scope,
    intervalSeconds,
    addedAt: now,
    ...(record?.contentHash ? { lastHash: record.contentHash, lastCheckedAt: now } : {}),
    ...((opts.label ?? record?.provenance?.title)
      ? { label: opts.label ?? record?.provenance?.title }
      : {}),
  };
  entries.push(entry);
  writeWatches(rootDir, entries);
  return entry;
}

/** Stop watching. Matches the stored identity URL, a docId, or a path. */
export function removeWatch(rootDir: string, target: string, scope?: string): boolean {
  const entries = listWatches(rootDir);
  const wanted = new Set([target, path.resolve(target)]);
  const kept = entries.filter(
    (w) => !((wanted.has(w.url) || w.label === target) && (!scope || w.scope === scope)),
  );
  if (kept.length === entries.length) return false;
  writeWatches(rootDir, kept);
  return true;
}

// ── Check ──────────────────────────────────────────────────────────

export interface CheckWatchesOptions {
  scope?: string;
  /** Check every watch regardless of its interval. */
  force?: boolean;
  /** Report without updating the stored baselines. */
  dryRun?: boolean;
  now?: Date;
}

function isDue(entry: WatchEntry, now: number, force: boolean): boolean {
  if (force || !entry.lastCheckedAt) return true;
  const last = Date.parse(entry.lastCheckedAt);
  if (Number.isNaN(last)) return true;
  return now - last >= entry.intervalSeconds * 1000;
}

async function extractedText(filePath: string): Promise<string | null> {
  try {
    if (!fs.existsSync(filePath)) return null;
    const { extractText } = await import('../capabilities/cap-documents.js');
    const stat = fs.statSync(filePath);
    return await extractText({
      path: filePath,
      absolutePath: filePath,
      extension: path.extname(filePath).toLowerCase(),
      size: stat.size,
      modified: stat.mtime,
      created: stat.birthtime,
    });
  } catch {
    return null;
  }
}

/**
 * Which watched pages have changed since the last check.
 *
 * Reads only what is already indexed: a page "changes" when a new capture of
 * it was ingested under a new content hash. Each change carries a section-level
 * summary (`diffSections`) built from the previous version's own archived
 * file, or a note saying why it could not be built.
 */
export async function checkWatches(
  rootDir: string,
  opts: CheckWatchesOptions = {},
): Promise<WatchCheckReport> {
  const { findDocumentRecord, listDocumentVersions } = await import('./document-pipeline.js');
  const entries = listWatches(rootDir);
  const nowDate = opts.now ?? new Date();
  const now = nowDate.getTime();
  const checkedAt = nowDate.toISOString();
  const results: WatchCheck[] = [];
  let changed = 0;
  let skipped = 0;
  let dirty = false;

  for (const entry of entries) {
    if (opts.scope && entry.scope !== opts.scope) continue;
    if (!isDue(entry, now, opts.force === true)) {
      skipped++;
      results.push({ url: entry.url, scope: entry.scope, status: 'not-due', checkedAt });
      continue;
    }

    const record = findDocumentRecord(rootDir, entry.url, entry.scope);
    if (!record) {
      results.push({
        url: entry.url,
        scope: entry.scope,
        status: 'missing',
        checkedAt,
        note: 'nothing indexed under this URL — capture it, or remove the watch',
      });
      // Deliberately NOT stamping lastCheckedAt: a page that is not there yet
      // should be looked at again on the next run, not put to sleep.
      continue;
    }

    const base: WatchCheck = {
      url: entry.url,
      scope: entry.scope,
      status: 'unchanged',
      checkedAt,
      filePath: record.filePath,
      currentHash: record.contentHash,
      ...(entry.lastHash ? { previousHash: entry.lastHash } : {}),
      ...(record.version ? { version: record.version } : {}),
      ...(record.provenance?.title ? { title: record.provenance.title } : {}),
      ...(record.provenance?.capturedAt ? { capturedAt: record.provenance.capturedAt } : {}),
    };

    if (!entry.lastHash) {
      results.push({ ...base, status: 'new' });
    } else if (entry.lastHash === record.contentHash) {
      results.push(base);
    } else {
      changed++;
      const previous = listDocumentVersions(rootDir, entry.url, entry.scope).find(
        (v) => v.contentHash === entry.lastHash,
      );
      const oldText = previous ? await extractedText(previous.filePath) : null;
      const newText = await extractedText(record.filePath);
      const check: WatchCheck = { ...base, status: 'changed' };
      if (oldText !== null && newText !== null) {
        check.diff = diffSections(oldText, newText);
      } else {
        check.note = previous
          ? `previous version's file is gone (${previous.filePath}) — change detected by hash only`
          : 'no archived copy of the previous version — change detected by hash only';
      }
      results.push(check);
    }

    if (!opts.dryRun) {
      if (entry.lastHash !== record.contentHash) entry.lastChangedAt = checkedAt;
      entry.lastHash = record.contentHash;
      entry.lastCheckedAt = checkedAt;
      dirty = true;
    }
  }

  if (dirty && !opts.dryRun) writeWatches(rootDir, entries);
  return { checked: results.length - skipped, changed, skipped, results };
}
