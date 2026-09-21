/**
 * The document index — the append-only metadata log that records which
 * documents are indexed, at which version, and whether that is still true.
 *
 * The log (`.monomind/knowledge/doc-metadata.jsonl`) is the pipeline's source
 * of truth. Everything here reads or writes it:
 *
 *  - WRITE: append a version record, tombstone a removed one.
 *  - READ:  the last-wins live view, the full history, and lookups by path,
 *           canonical URL or `<scope>:<path>` docId.
 *  - JUDGE: which content hashes are current, which chunk keys are therefore
 *           superseded, and which indexed files no longer exist on disk.
 *
 * Nothing here touches the vector store. Removal tombstones metadata and lets
 * the superseded filter hide the chunks — mark, don't destroy.
 *
 * Split out of document-pipeline.ts.
 *
 * @module v1/cli/knowledge/document-index
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
// Static import is safe and deliberate: memory-bridge imports only node builtins
// at module scope (everything heavy is lazy), and the project-root rule must not
// be duplicated — two copies of "which directory is this project" is exactly the
// bug this default exists to fix.
import { getProjectRoot } from '../memory/memory-bridge.js';
import type { DocumentMeta, ReconcileReport } from './document-types.js';

export const METADATA_FILE = 'doc-metadata.jsonl';

// ── Metadata log ───────────────────────────────────────────────────

export function metadataPath(rootDir: string): string {
  const dir = path.join(rootDir, '.monomind', 'knowledge');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, METADATA_FILE);
}

/** Every record ever appended, in order, including superseded versions and
 *  removal tombstones. Reads the path directly instead of via `metadataPath`,
 *  which mkdir's. */
export function readMetadataLog(rootDir: string): DocumentMeta[] {
  const file = path.join(rootDir, '.monomind', 'knowledge', METADATA_FILE);
  if (!fs.existsSync(file)) return [];
  const out: DocumentMeta[] = [];
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as DocumentMeta);
    } catch {
      /* torn line */
    }
  }
  return out;
}

export function readMetadata(rootDir: string): DocumentMeta[] {
  const file = metadataPath(rootDir);
  if (!fs.existsSync(file)) return [];
  // Last-wins per (filePath, scope): the file is append-only under concurrent
  // ingests (session-start detached reindex + a manual `doc ingest` can
  // overlap), so duplicates are expected and the newest record is truth.
  // Corrupt lines (torn concurrent writes) are skipped, not fatal.
  const latest = new Map<string, DocumentMeta>();
  for (const l of fs.readFileSync(file, 'utf-8').split('\n')) {
    if (!l.trim()) continue;
    try {
      const m = JSON.parse(l) as DocumentMeta;
      latest.set(`${m.filePath} ${m.scope}`, m);
    } catch {
      /* torn line */
    }
  }
  // chunkCount -1 records are removal tombstones (see removeMetadataEntry)
  const live = [...latest.values()].filter((m) => m.chunkCount >= 0);
  // Occasional compaction: append-only + tombstones grow without bound; when
  // the log gets big, rewrite it deduped (atomic rename — a concurrent append
  // in the tiny window loses only its own record and self-heals on re-ingest).
  try {
    if (fs.statSync(file).size > 1024 * 1024) {
      const tmp = `${file}.${process.pid}.compact`;
      fs.writeFileSync(
        tmp,
        live.map((r) => JSON.stringify(r)).join('\n') + (live.length ? '\n' : ''),
        'utf-8',
      );
      fs.renameSync(tmp, file);
    }
  } catch {
    /* compaction is best-effort */
  }
  return live;
}

export function appendMetadata(rootDir: string, meta: DocumentMeta): void {
  fs.appendFileSync(metadataPath(rootDir), `${JSON.stringify(meta)}\n`, 'utf-8');
}

/**
 * One ingest's live view of the metadata log — the answer to "what is already
 * indexed here", kept current as the ingest itself indexes things.
 *
 * WHY IT IS NOT AN ARRAY. `ingestDirectory` used to read the log once and hand
 * the same frozen snapshot to every file, which made a batch blind to its own
 * writes: two members of one capture envelope both looked new, both got
 * indexed, and a first-ever ingest of one page reported two documents and
 * `versions: 2`. Re-reading the log per file would have fixed that by throwing
 * away the very thing the cache exists for — the log is read once and parsed
 * once, however large it has grown.
 *
 * So the cache stays, and the WRITES go through it: `record` after a version
 * commits, `forget` after a tombstone, mirroring `readMetadata`'s last-wins
 * key. It is keyed by root as well, because a sweep can route captures to
 * several stores (`global`, `profile:<id>`) and each has its own log.
 *
 * Deliberately not shared between ingests: it is a within-one-call view, not a
 * process-wide cache that could go stale behind a concurrent writer.
 */
export interface MetadataCache {
  /** The live record this ingest would supersede, by path or by capture
   *  identity — the rule `ingestDocument` keys dedupe on. */
  find(
    rootDir: string,
    filePath: string,
    scope: string,
    canonicalUrl?: string,
  ): DocumentMeta | undefined;
  /** A version just committed under `rootDir`. */
  record(rootDir: string, meta: DocumentMeta): void;
  /** A record just tombstoned under `rootDir`. */
  forget(rootDir: string, filePath: string, scope: string): void;
}

export function createMetadataCache(): MetadataCache {
  const key = (filePath: string, scope: string | undefined) => `${filePath} ${scope}`;
  const roots = new Map<string, Map<string, DocumentMeta>>();
  const load = (rootDir: string): Map<string, DocumentMeta> => {
    let byKey = roots.get(rootDir);
    if (!byKey) {
      byKey = new Map(readMetadata(rootDir).map((m) => [key(m.filePath, m.scope), m]));
      roots.set(rootDir, byKey);
    }
    return byKey;
  };

  return {
    find(rootDir, filePath, scope, canonicalUrl) {
      const byKey = load(rootDir);
      const samePath = byKey.get(key(filePath, scope));
      if (samePath) return samePath;
      // RCL-06: identity is the PAGE, not the path — a re-capture lands in a
      // new timestamped directory.
      if (!canonicalUrl) return undefined;
      for (const m of byKey.values()) {
        if (m.scope === scope && m.canonicalUrl === canonicalUrl) return m;
      }
      return undefined;
    },
    record(rootDir, meta) {
      load(rootDir).set(key(meta.filePath, meta.scope), meta);
    },
    forget(rootDir, filePath, scope) {
      load(rootDir).delete(key(filePath, scope));
    },
  };
}

export function removeMetadataEntry(rootDir: string, filePath: string, scope: string): void {
  const file = metadataPath(rootDir);
  if (!fs.existsSync(file)) return;
  // Tombstone by APPEND (chunkCount -1) instead of read-filter-rewrite — the
  // rewrite raced concurrent appends and silently dropped them.
  appendMetadata(rootDir, {
    filePath,
    scope,
    contentHash: '',
    chunkCount: -1,
    indexedAt: new Date().toISOString(),
    size: 0,
  });
}

// ── Superseded-version filtering ───────────────────────────────────
//
// Chunk keys are `doc:<contentHash>:<chunkIndex>`. Re-ingesting a changed file
// produces a NEW contentHash, so its chunks land under new keys — the previous
// version's rows are never touched (`removeDocument` only tombstones metadata;
// the bridge exposes no delete-by-prefix). The store therefore accumulates every
// version a document has ever had, and all of them stay searchable.
//
// Measured on this repo's own store (2026-07-26): 9,067 `doc:`-keyed rows in
// `knowledge:shared` spanning 798 distinct content hashes, of which only 139
// are current — 8,542 rows (94.2%) are orphaned older versions.
//
// Nothing is deleted here. The current-hash set from doc-metadata.jsonl is used
// to decide what search RETURNS; `includeSuperseded` puts the old versions back
// (flagged `superseded: true`) for anyone who wants document history.

/** Content hashes of the documents currently indexed under `rootDir`. */
export function liveContentHashes(rootDir: string): Set<string> {
  const live = new Set<string>();
  for (const m of readMetadata(rootDir)) if (m.contentHash) live.add(m.contentHash);
  return live;
}

/** True when a metadata log exists under `rootDir`.
 *
 * An empty live-hash set has two very different causes: the log is missing (we
 * cannot judge what is current) or the log exists and every document has been
 * removed (nothing is current). Collapsing them made `doc remove` of the LAST
 * document a no-op — the tombstoned chunks came straight back in search.
 *
 * Reads the path directly instead of via `metadataPath`, which mkdir's. */
export function hasKnowledgeMetadata(rootDir: string): boolean {
  return fs.existsSync(path.join(rootDir, '.monomind', 'knowledge', METADATA_FILE));
}

/**
 * True when `key` is a document chunk whose version is no longer current.
 * Non-`doc:` keys are never superseded. When no metadata is available nothing
 * is filtered, because "no metadata" must not read as "everything is stale".
 *
 * `metadataPresent` defaults to the old `live.size > 0` heuristic so existing
 * two-argument callers keep their exact behaviour; pass `hasKnowledgeMetadata`
 * to also filter correctly once the last document has been removed.
 */
export function isSupersededKey(
  key: string,
  live: Set<string>,
  metadataPresent = live.size > 0,
): boolean {
  if (!key?.startsWith('doc:')) return false;
  if (!metadataPresent) return false;
  return !live.has(key.split(':')[1] ?? '');
}

/** How many rows to ask the backend for per requested result when superseded
 *  filtering is active — most rows in a long-lived store are old versions, so
 *  a 1:1 fetch would return an almost-empty page. */
const SUPERSEDED_OVERFETCH = 20;
const SUPERSEDED_OVERFETCH_CAP = 300;

export function supersededOverfetchLimit(limit: number, live: Set<string>): number {
  if (live.size === 0) return limit;
  return Math.min(Math.max(limit * SUPERSEDED_OVERFETCH, limit), SUPERSEDED_OVERFETCH_CAP);
}

// ── List / lookup ──────────────────────────────────────────────────

export function listDocuments(rootDir = getProjectRoot(), scope?: string): DocumentMeta[] {
  const all = readMetadata(rootDir);
  return scope ? all.filter((m) => m.scope === scope) : all;
}

/**
 * Every recorded version of one document, oldest first (RCL-06).
 *
 * `target` is either an indexed file path or a capture's `canonicalUrl`. Read
 * from the append-only log rather than the last-wins view, which is how a
 * superseded version stays addressable after its record has been replaced or
 * tombstoned.
 *
 * Best-effort by design: `readMetadata` compacts the log once it passes 1MB
 * and keeps only live records, so history older than a compaction is gone.
 * The `supersedes` pointer on each record is the durable part.
 */
export function listDocumentVersions(
  rootDir = getProjectRoot(),
  target?: string,
  scope?: string,
): DocumentMeta[] {
  const resolved = target ? path.resolve(target) : undefined;
  return readMetadataLog(rootDir)
    .filter((m) => m.chunkCount >= 0)
    .filter((m) => !scope || m.scope === scope)
    .filter(
      (m) =>
        !target || m.filePath === resolved || m.filePath === target || m.canonicalUrl === target,
    )
    .sort((a, b) => (a.version ?? 0) - (b.version ?? 0) || a.indexedAt.localeCompare(b.indexedAt));
}

/**
 * The indexed record for whatever a caller wrote down: a file path, a
 * capture's `canonicalUrl` (fragment ignored), or the `<scope>:<path>` docId.
 *
 * Live records win. A superseded version is only reached through the
 * append-only log, and only when nothing live matches — otherwise citing a
 * re-captured page would resolve against the version it replaced.
 */
export function findDocumentRecord(
  rootDir = getProjectRoot(),
  target = '',
  scope?: string,
): DocumentMeta | undefined {
  const raw = target.trim();
  if (!raw) return undefined;
  // `<scope>:<path>` — but not `https://…`, whose colon is a URL scheme.
  const scoped = /^([a-z][a-z0-9_-]*):(?!\/\/)(.+)$/i.exec(raw);
  const candidates = scoped ? [raw, scoped[2]] : [raw];
  const hash = raw.indexOf('#');
  if (hash > 0) candidates.push(raw.slice(0, hash));
  const resolvedPaths = new Set(candidates.map((c) => path.resolve(c)));
  const wanted = new Set(candidates);
  const scopeFilter = scope ?? (scoped ? scoped[1] : undefined);

  const matches = (m: DocumentMeta): boolean => {
    if (scopeFilter && m.scope !== scopeFilter && !wanted.has(m.filePath)) return false;
    if (wanted.has(m.filePath) || resolvedPaths.has(path.resolve(m.filePath))) return true;
    return !!m.canonicalUrl && wanted.has(m.canonicalUrl);
  };

  const live = readMetadata(rootDir).filter(matches);
  if (live.length) {
    return live.sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0];
  }
  const historical = readMetadataLog(rootDir)
    .filter((m) => m.chunkCount >= 0)
    .filter(matches);
  return historical.sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0];
}

export async function removeDocument(
  filePath: string,
  scope = 'shared',
  rootDir = getProjectRoot(),
): Promise<void> {
  removeMetadataEntry(rootDir, path.resolve(filePath), scope);
  // SQLite cleanup: bridge doesn't expose delete-by-key, so metadata removal is sufficient.
  // Orphaned SQLite entries get swept on next full re-index or TTL expiry.
}

// ── Filesystem reconciliation (item 4b-i) ──────────────────────────

/**
 * True for macOS AppleDouble sidecars (`._name`).
 *
 * Matches on the BASENAME PREFIX only. A legitimate document may contain `._`
 * elsewhere in its name (`v1._2-release.md`), or live under a dot-directory
 * that is deliberately indexed (`.monodesign/` critique snapshots), and
 * neither may be rejected.
 */
export function isResourceFork(filePath: string): boolean {
  return path.basename(filePath).startsWith('._');
}

/**
 * Reconcile the document index against the filesystem: find index entries whose
 * source file no longer exists and, only when explicitly asked, tombstone them.
 *
 * WHY — `removeDocument` only ever tombstoned metadata, and nothing has ever
 * compared the index against the disk, so a deleted file stayed searchable
 * forever. Measured 2026-07-28: 109 of 257 live entries (42.4%) had no file
 * behind them, including `docs/concepts/memory.md`. The Second Brain was
 * answering questions from documents the user had deleted.
 *
 * WHY IT IS THIS CAUTIOUS — "drop the index entry when the file is missing" is
 * a rule with a known catastrophic reading. A missing file is also an unmounted
 * volume, a checked-out branch, a partial clone, or a permissions failure. Two
 * guards were tried against real data and REJECTED; they are recorded here so
 * they are not re-proposed:
 *
 *   - "abort if >50% of entries are missing" — the real, legitimate missing
 *     fraction was 42.4%, so the threshold never fires in the one case we have.
 *     Any threshold that would have blocked this reconcile is fitted to nothing.
 *   - "only reconcile when the parent directory still exists" — 26 of the 109
 *     missing files had no parent directory, because `docs/concepts`,
 *     `docs/adrs` and `docs/commands` were legitimately deleted wholesale. A
 *     deleted directory and an unmounted volume are indistinguishable there.
 *
 * What does discriminate is the ROOT. An intact, readable root carrying a
 * metadata log means the tree is genuinely present, so a missing file is
 * genuinely gone. A missing root means nothing beneath it is knowable and
 * nothing may be removed — hence throw rather than reconcile.
 *
 * Removal tombstones metadata; it does not delete store rows. Chunks stay on
 * disk and fall out of search through the existing superseded filter, which
 * keeps this consistent with the mark-don't-destroy rule and leaves the whole
 * operation reversible from the archive.
 */
export async function reconcileIndex(
  rootDir = getProjectRoot(),
  opts?: { scope?: string; apply?: boolean },
): Promise<ReconcileReport> {
  const apply = opts?.apply === true;

  // Root guard — the unmounted-volume case. Every file below a missing root
  // looks deleted, so this must abort rather than reconcile.
  if (!rootDir || !fs.existsSync(rootDir)) {
    throw new Error(
      `reconcileIndex: project root does not exist: ${rootDir} — refusing to reconcile ` +
        `(an unmounted volume makes every indexed file look deleted)`,
    );
  }
  if (!hasKnowledgeMetadata(rootDir)) {
    throw new Error(
      `reconcileIndex: no knowledge metadata log under ${rootDir} — refusing to reconcile ` +
        `("no metadata" must not read as "everything is stale")`,
    );
  }

  const records = readMetadata(rootDir).filter((m) => !opts?.scope || m.scope === opts.scope);
  const missing = records.filter((m) => !fs.existsSync(m.filePath));

  if (!apply || missing.length === 0) {
    return { missing, scanned: records.length, applied: apply, removed: 0 };
  }

  // Archive BEFORE removing, inside the operation so no caller can bypass it
  // by forgetting — the same precondition rule the delete path uses.
  const dir = path.join(rootDir, '.monomind', 'knowledge', 'archive');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archivePath = path.join(dir, `reconcile-${stamp}.jsonl`);
  fs.writeFileSync(archivePath, `${missing.map((m) => JSON.stringify(m)).join('\n')}\n`, 'utf-8');

  let removed = 0;
  for (const m of missing) {
    removeMetadataEntry(rootDir, m.filePath, m.scope);
    removed++;
  }

  return { missing, scanned: records.length, applied: true, removed, archivePath };
}
