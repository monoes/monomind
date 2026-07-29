/**
 * Document Pipeline — wires text extraction, chunking, embedding, and SQLite storage
 * into an end-to-end ingest/search/export pipeline for the Second Brain.
 *
 * @module v1/cli/knowledge/document-pipeline
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import { DOC_EXTENSIONS, extractText } from '../capabilities/cap-documents.js';
// Static import is safe and deliberate: memory-bridge imports only node builtins
// at module scope (everything heavy is lazy), and the project-root rule must not
// be duplicated — two copies of "which directory is this project" is exactly the
// bug this default exists to fix.
import { getProjectRoot } from '../memory/memory-bridge.js';
import type { FileEntry } from '../capabilities/types.js';

interface TextChunk {
  chunkId: string;
  docId: string;
  text: string;
  startChar: number;
  endChar: number;
  chunkIndex: number;
}

const DEFAULT_CHUNK_SIZE = 3200;
const DEFAULT_OVERLAP = 400;

// Inline fallback identical to @monoes/memory's knowledge/document-chunker.ts —
// used only if the dynamic import below fails (package not installed/built).
// Keep in sync if the shared chunker's boundary-snapping logic changes.
const HEADING_LINE_RE = /^#{1,6} /;
const FENCE_LINE_RE = /^\s{0,3}(`{3,}|~{3,})/;
function fenceTogglesInline(text: string): number[] {
  const toggles: number[] = [];
  let lineStart = 0;
  while (lineStart <= text.length) {
    const eol = text.indexOf('\n', lineStart);
    const line = text.slice(lineStart, eol === -1 ? undefined : eol);
    if (FENCE_LINE_RE.test(line)) toggles.push(lineStart);
    if (eol === -1) break;
    lineStart = eol + 1;
  }
  return toggles;
}
function inFenceInline(toggles: number[], pos: number): boolean {
  let lo = 0, hi = toggles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (toggles[mid] <= pos) lo = mid + 1; else hi = mid;
  }
  return (lo & 1) === 1;
}
function lastHeadingBefore(text: string, pos: number, toggles: number[]): string | null {
  let i = text.lastIndexOf('\n#', pos - 1);
  while (i !== -1) {
    const eol = text.indexOf('\n', i + 1);
    const line = text.slice(i + 1, eol === -1 ? undefined : eol);
    if (HEADING_LINE_RE.test(line) && !inFenceInline(toggles, i + 1)) return line.replace(/^#+ /, '').trim();
    i = i > 0 ? text.lastIndexOf('\n#', i - 1) : -1; // fromIndex -1 clamps to 0 — would loop on a match at 0
  }
  const firstEol = text.indexOf('\n');
  const firstLine = firstEol === -1 ? text : text.slice(0, firstEol);
  return HEADING_LINE_RE.test(firstLine) && !inFenceInline(toggles, 0) && firstEol !== -1 && firstEol < pos
    ? firstLine.replace(/^#+ /, '').trim() : null;
}
function chunkDocumentInline(docId: string, text: string): TextChunk[] {
  if (text.includes('\r\n')) text = text.replace(/\r\n/g, '\n');
  if (text.length === 0) return [];
  const toggles = fenceTogglesInline(text);
  const chunks: TextChunk[] = [];
  let startChar = 0;
  let chunkIndex = 0;

  while (startChar < text.length) {
    let endChar = Math.min(startChar + DEFAULT_CHUNK_SIZE, text.length);
    let brokeAtHeading = false;
    if (endChar < text.length) {
      const windowStart = Math.max(startChar, endChar - Math.floor(DEFAULT_CHUNK_SIZE * 0.2));
      const window = text.slice(windowStart, endChar);
      let h = window.lastIndexOf('\n#');
      while (h !== -1) {
        const eol = window.indexOf('\n', h + 1);
        const line = window.slice(h + 1, eol === -1 ? undefined : eol);
        if (HEADING_LINE_RE.test(line) && windowStart + h > startChar && !inFenceInline(toggles, windowStart + h + 1)) break;
        h = h > 0 ? window.lastIndexOf('\n#', h - 1) : -1;
      }
      if (h !== -1 && windowStart + h > startChar) {
        endChar = windowStart + h + 1;
        brokeAtHeading = true;
      } else {
        let lastParagraph = window.lastIndexOf('\n\n');
        while (lastParagraph > 0 && inFenceInline(toggles, windowStart + lastParagraph + 1)) {
          lastParagraph = window.lastIndexOf('\n\n', lastParagraph - 1);
        }
        if (lastParagraph === 0 && inFenceInline(toggles, windowStart + 1)) lastParagraph = -1;
        if (lastParagraph !== -1) endChar = windowStart + lastParagraph + 2;
      }
    }
    let chunkText = text.slice(startChar, endChar);
    const heading = lastHeadingBefore(text, startChar + 1, toggles);
    if (heading && !HEADING_LINE_RE.test(chunkText.trimStart())) chunkText = `§ ${heading}\n${chunkText}`;
    chunks.push({ chunkId: `${docId}:${chunkIndex}`, docId, text: chunkText, startChar, endChar, chunkIndex });
    chunkIndex++;
    if (endChar >= text.length) break;
    startChar += brokeAtHeading ? Math.max(1, endChar - startChar) : Math.max(1, endChar - startChar - DEFAULT_OVERLAP);
  }
  return chunks;
}

async function chunkDocument(docId: string, text: string): Promise<TextChunk[]> {
  try {
    const mod = await import('@monoes/memory' as string);
    return mod.chunkDocument(docId, text, DEFAULT_CHUNK_SIZE, DEFAULT_OVERLAP);
  } catch {
    return chunkDocumentInline(docId, text);
  }
}

// ── Contextual chunk enrichment (item 6a) ─────────────────────────
// Prepend a situating blurb per chunk before embedding: full heading
// path + doc title + doc summary. No LLM, no network.
//
// The chunker's `§ heading` prefix (line 105) provides only the nearest
// leaf heading. This replaces it with doc-level context so the embedding
// model can distinguish "Memory Coordination" in a hooks doc from
// "Memory Coordination" in a concepts doc.
//
// Applied at INGEST TIME (after chunking, before embedding), so:
//  - Works identically regardless of which chunker ran (inline or @monoes/memory)
//  - Works identically for both better-sqlite3 and sql.js (pure string ops)
//  - Zero dependencies, zero network

const SECTION_PREFIX_RE = /^§ [^\n]+\n/;

function extractDocTitle(text: string, filePath: string): string {
  const eol = text.indexOf('\n');
  const first = eol === -1 ? text : text.slice(0, eol);
  return HEADING_LINE_RE.test(first)
    ? first.replace(/^#+ /, '').trim()
    : path.basename(filePath, path.extname(filePath)).replace(/[-_]/g, ' ');
}

function extractDocSummary(text: string): string {
  const lines = text.split('\n');
  let inFence = false;
  const parts: string[] = [];
  for (const line of lines) {
    if (FENCE_LINE_RE.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (HEADING_LINE_RE.test(line)) { if (parts.length > 0) break; continue; }
    const t = line.trim();
    if (!t || /^[|=-]/.test(t)) { if (parts.length > 0) break; continue; }
    parts.push(t.startsWith('>') ? t.replace(/^>\s*/, '') : t);
  }
  return parts.join(' ').slice(0, 150);
}

function buildHeadingHierarchy(
  text: string, toggles: number[],
): Array<{ level: number; text: string; offset: number }> {
  const out: Array<{ level: number; text: string; offset: number }> = [];
  const eol0 = text.indexOf('\n');
  const line0 = eol0 === -1 ? text : text.slice(0, eol0);
  if (HEADING_LINE_RE.test(line0) && !inFenceInline(toggles, 0)) {
    out.push({ level: (line0.match(/^(#{1,6}) /)!)[1].length, text: line0.replace(/^#+ /, '').trim(), offset: 0 });
  }
  let i = text.indexOf('\n#', 0);
  while (i !== -1) {
    const ls = i + 1;
    const e = text.indexOf('\n', ls);
    const line = text.slice(ls, e === -1 ? undefined : e);
    if (HEADING_LINE_RE.test(line) && !inFenceInline(toggles, ls)) {
      out.push({ level: (line.match(/^(#{1,6}) /)!)[1].length, text: line.replace(/^#+ /, '').trim(), offset: ls });
    }
    i = text.indexOf('\n#', ls);
  }
  return out;
}

function headingPathAt(
  hierarchy: Array<{ level: number; text: string; offset: number }>, pos: number,
): string[] {
  const stack: Array<{ level: number; text: string }> = [];
  for (const h of hierarchy) {
    if (h.offset >= pos) break;
    while (stack.length > 0 && stack[stack.length - 1].level >= h.level) stack.pop();
    stack.push(h);
  }
  return stack.map(s => s.text);
}

/**
 * Replace each chunk's `§ heading` prefix with a richer situating blurb:
 *   § <doc title> · <full heading path>
 *   <doc summary for non-first chunks>
 *
 * First chunks that start with their own heading are left untouched (the
 * heading IS the context). The summary line is omitted for the first
 * chunk since it is adjacent to the summary text anyway.
 */
function enrichChunks(chunks: TextChunk[], fullText: string, filePath: string): TextChunk[] {
  if (chunks.length === 0) return chunks;
  const toggles = fenceTogglesInline(fullText);
  const hierarchy = buildHeadingHierarchy(fullText, toggles);
  const title = extractDocTitle(fullText, filePath);
  const summary = extractDocSummary(fullText);

  return chunks.map(c => {
    let text = c.text;

    // First chunk starting with its own heading — the heading IS the context
    if (c.chunkIndex === 0 && HEADING_LINE_RE.test(text.trimStart())) return c;

    // Strip the old § leaf-heading prefix; we replace it with a richer one
    text = text.replace(SECTION_PREFIX_RE, '');

    const hpath = headingPathAt(hierarchy, c.startChar + 1);
    const parts: string[] = [];

    // Title + full heading path
    if (hpath.length > 0 && hpath[0] !== title) {
      parts.push(`§ ${title} · ${hpath.join(' > ')}`);
    } else if (hpath.length > 1) {
      parts.push(`§ ${hpath.join(' > ')}`);
    } else {
      parts.push(`§ ${title}`);
    }

    // Summary for non-first chunks — they are far from the doc intro
    if (c.chunkIndex > 0 && summary) {
      const snip = summary.length > 120 ? summary.slice(0, 117) + '...' : summary;
      parts.push(snip);
    }

    return { ...c, text: parts.join('\n') + '\n' + text };
  });
}

// ── Types ──────────────────────────────────────────────────────────

export interface IngestResult {
  filePath: string;
  chunksIndexed: number;
  scope: string;
  skipped: boolean;
  error?: string;
}

export interface BatchIngestResult {
  filesProcessed: number;
  filesSkipped: number;
  totalChunks: number;
  errors: string[];
  results: IngestResult[];
}

export interface KnowledgeExcerpt {
  /** Memory entry id — pass back to memory_feedback/bridgeApplyFeedback to rate usefulness. */
  id: string;
  filePath: string;
  text: string;
  similarity: number;
  chunkIndex: number;
  scope: string;
  /** True when this chunk belongs to a document version that has since been
   *  re-ingested (its contentHash is no longer the file's current one). Only
   *  ever set when the caller opted into `includeSuperseded`. */
  superseded?: boolean;
}

export interface DocumentMeta {
  filePath: string;
  contentHash: string;
  chunkCount: number;
  indexedAt: string;
  scope: string;
  size: number;
}

// ── Constants ──────────────────────────────────────────────────────

const KNOWLEDGE_NS_PREFIX = 'knowledge:';
const METADATA_FILE = 'doc-metadata.jsonl';
// Global brain constants — canonical definitions live in memory-bridge.ts
// (GLOBAL_BRAIN / GLOBAL_BRAIN_DIR); duplicated here because the bridge is
// imported lazily and these are needed synchronously.
const GLOBAL_BRAIN_SENTINEL = '@global';
const globalBrainRoot = (): string => process.env.MONOMIND_GLOBAL_BRAIN_DIR || path.join(os.homedir(), '.monomind', 'global-brain');
/** scope 'global' routes to the personal cross-project store. */
const isGlobalScope = (scope: string): boolean => scope === 'global';
const effectiveRoot = (scope: string, rootDir: string): string => isGlobalScope(scope) ? globalBrainRoot() : rootDir;
const storeDbPath = (scope: string): string | undefined => isGlobalScope(scope) ? GLOBAL_BRAIN_SENTINEL : undefined;
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', '.monomind', '.claude', '.next', '__pycache__', '.venv', 'vendor']);
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// ── Helpers ────────────────────────────────────────────────────────

function namespace(scope: string): string {
  return `${KNOWLEDGE_NS_PREFIX}${scope}`;
}

function contentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function metadataPath(rootDir: string): string {
  const dir = path.join(rootDir, '.monomind', 'knowledge');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, METADATA_FILE);
}

function readMetadata(rootDir: string): DocumentMeta[] {
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
    } catch { /* torn line */ }
  }
  // chunkCount -1 records are removal tombstones (see removeMetadataEntry)
  const live = [...latest.values()].filter(m => m.chunkCount >= 0);
  // Occasional compaction: append-only + tombstones grow without bound; when
  // the log gets big, rewrite it deduped (atomic rename — a concurrent append
  // in the tiny window loses only its own record and self-heals on re-ingest).
  try {
    if (fs.statSync(file).size > 1024 * 1024) {
      const tmp = `${file}.${process.pid}.compact`;
      fs.writeFileSync(tmp, live.map(r => JSON.stringify(r)).join('\n') + (live.length ? '\n' : ''), 'utf-8');
      fs.renameSync(tmp, file);
    }
  } catch { /* compaction is best-effort */ }
  return live;
}

function appendMetadata(rootDir: string, meta: DocumentMeta): void {
  fs.appendFileSync(metadataPath(rootDir), JSON.stringify(meta) + '\n', 'utf-8');
}

function removeMetadataEntry(rootDir: string, filePath: string, scope: string): void {
  const file = metadataPath(rootDir);
  if (!fs.existsSync(file)) return;
  // Tombstone by APPEND (chunkCount -1) instead of read-filter-rewrite — the
  // rewrite raced concurrent appends and silently dropped them.
  appendMetadata(rootDir, {
    filePath, scope, contentHash: '', chunkCount: -1,
    indexedAt: new Date().toISOString(), size: 0,
  });
}

function toFileEntry(filePath: string): FileEntry {
  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    absolutePath: path.resolve(filePath),
    extension: path.extname(filePath).toLowerCase(),
    size: stat.size,
    modified: stat.mtime,
    created: stat.birthtime,
  };
}

// ── Lazy bridge import ─────────────────────────────────────────────

let _bridge: typeof import('../memory/memory-bridge.js') | null | undefined;
async function getBridge() {
  if (_bridge === null) return null;
  if (_bridge) return _bridge;
  try {
    _bridge = await import('../memory/memory-bridge.js');
    return _bridge;
  } catch {
    _bridge = null;
    return null;
  }
}

// ── Core Pipeline ──────────────────────────────────────────────────

export async function ingestDocument(
  filePath: string,
  scope = 'shared',
  rootDir = getProjectRoot(),
  _metadataCache?: DocumentMeta[],
): Promise<IngestResult> {
  const resolved = path.resolve(filePath);
  const ext = path.extname(resolved).toLowerCase();

  // AppleDouble resource forks (`._name.md`) are binary macOS sidecars, not
  // documents. The directory walk has skipped dotfiles since 3e429194
  // (2026-07-19), but that walk is only ONE of six callers that reach this
  // function — the CLI `doc ingest`, the MCP `knowledge_ingest` tool, the
  // dashboard's live fs.watch and its polling sweep, the eval harness, and
  // `ingestDirectory` all land here, and four of them had no guard at all.
  //
  // Guarding at the boundary covers every caller at once, including callers
  // added later. Guarding at each call site covers only the ones we thought to
  // enumerate — which is how two `._` files reached the live index despite a
  // working guard in the walk.
  //
  // Measured on this repo 2026-07-28: 96 `._` entries in the live index, 91 of
  // them shadowing a real document of the same name and competing with it for
  // top-k slots. That is a direct Recall@5/MRR@10 loss, not wasted storage.
  if (isResourceFork(resolved)) {
    return { filePath: resolved, chunksIndexed: 0, scope, skipped: true, error: 'AppleDouble resource fork' };
  }

  if (!DOC_EXTENSIONS.has(ext)) {
    return { filePath: resolved, chunksIndexed: 0, scope, skipped: true, error: `unsupported extension: ${ext}` };
  }

  if (!fs.existsSync(resolved)) {
    return { filePath: resolved, chunksIndexed: 0, scope, skipped: true, error: 'file not found' };
  }

  const stat = fs.statSync(resolved);
  if (stat.size > MAX_FILE_SIZE) {
    return { filePath: resolved, chunksIndexed: 0, scope, skipped: true, error: 'file too large (>50MB)' };
  }

  rootDir = effectiveRoot(scope, rootDir);
  const meta = _metadataCache ?? readMetadata(rootDir);
  const existing = meta.find(m => m.filePath === resolved && m.scope === scope);
  let fullContent: string;

  try {
    const entry = toFileEntry(resolved);
    fullContent = await extractText(entry);
  } catch (err) {
    return { filePath: resolved, chunksIndexed: 0, scope, skipped: false, error: String(err) };
  }

  if (!fullContent || fullContent.trim().length === 0) {
    return { filePath: resolved, chunksIndexed: 0, scope, skipped: true, error: 'no text extracted' };
  }

  const hash = contentHash(fullContent);

  if (existing && existing.contentHash === hash) {
    return { filePath: resolved, chunksIndexed: existing.chunkCount, scope, skipped: true };
  }

  // Remove old data if re-indexing
  if (existing) {
    removeMetadataEntry(rootDir, resolved, scope);
  }

  const docId = `${scope}:${resolved}`;
  const rawChunks: TextChunk[] = await chunkDocument(docId, fullContent);
  // monolean: [re-enabled] item 2 shipped 768d gte-modernbert-base — capacity handles enrichment
  const chunks = enrichChunks(rawChunks, fullContent, resolved);
  const bridge = await getBridge();
  let indexed = 0;

  for (const chunk of chunks) {
    const key = `doc:${hash}:${chunk.chunkIndex}`;

    if (bridge) {
      try {
        const storeResult = await bridge.bridgeStoreEntry({
          key,
          value: chunk.text,
          namespace: namespace(scope),
          generateEmbeddingFlag: true,
          tags: ['document', ext, `src:${resolved}`],
          upsert: true,
          dbPath: storeDbPath(scope),
        });
        if (storeResult?.success) indexed++;
      } catch (e) {
        if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error(`[ingestDocument] failed to store chunk ${chunk.chunkIndex} of ${resolved}:`, e);
      }
    }
  }

  // Persist metadata — but ONLY when something was actually stored (or the
  // document legitimately produced zero chunks). Recording the content hash
  // after a total store failure (bridge unavailable, every store rejected)
  // made the hash check skip the file on every future ingest: a permanent,
  // silent search miss.
  if (indexed > 0 || chunks.length === 0) {
    appendMetadata(rootDir, {
      filePath: resolved,
      contentHash: hash,
      chunkCount: indexed,
      indexedAt: new Date().toISOString(),
      scope,
      size: stat.size,
    });
  }

  const storeFailed = chunks.length > 0 && indexed === 0;
  return {
    filePath: resolved, chunksIndexed: indexed, scope, skipped: false,
    ...(storeFailed ? { error: bridge ? 'all chunk stores failed' : 'memory bridge unavailable — nothing indexed' } : {}),
  };
}

export async function ingestDirectory(
  dirPath: string,
  scope = 'shared',
  opts?: { rootDir?: string; onProgress?: (file: string, done: number, total: number) => void },
): Promise<BatchIngestResult> {
  const scanDir = path.resolve(dirPath);
  const rootDir = path.resolve(opts?.rootDir ?? getProjectRoot());
  const files: string[] = [];

  function walk(dir: string, depth = 0) {
    if (depth > 10) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      // Skip dotfiles/dot-dirs (incl. exFAT `._*` junk) — except `.monodesign`,
      // whose critique snapshots are markdown worth surfacing in the Second Brain.
      if (entry.name.startsWith('.') && entry.name !== '.monodesign') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) walk(full, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (DOC_EXTENSIONS.has(ext)) files.push(full);
      }
    }
  }

  walk(scanDir);

  const metadataCache = readMetadata(rootDir);
  const result: BatchIngestResult = {
    filesProcessed: 0,
    filesSkipped: 0,
    totalChunks: 0,
    errors: [],
    results: [],
  };

  for (let i = 0; i < files.length; i++) {
    opts?.onProgress?.(files[i], i, files.length);
    const r = await ingestDocument(files[i], scope, rootDir, metadataCache);
    result.results.push(r);

    if (r.skipped) {
      result.filesSkipped++;
    } else {
      result.filesProcessed++;
      result.totalChunks += r.chunksIndexed;
    }

    if (r.error && !r.skipped) {
      result.errors.push(`${r.filePath}: ${r.error}`);
    }
  }

  return result;
}

// ── Search ─────────────────────────────────────────────────────────

/** Small additive boost so project knowledge wins ties against the global
 *  brain — local context is more likely to be what the user means. */
const PROJECT_SCOPE_BOOST = 0.05;

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
export function isSupersededKey(key: string, live: Set<string>, metadataPresent = live.size > 0): boolean {
  if (!key || !key.startsWith('doc:')) return false;
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

export async function searchKnowledge(
  query: string,
  opts?: {
    scope?: string; limit?: number; minScore?: number; rootDir?: string;
    /** which store(s): project-only, global-only, or both (default). */
    store?: 'project' | 'global' | 'all';
    /** Return chunks from superseded document versions too, flagged
     *  `superseded: true`. Default false — see the note above `liveContentHashes`. */
    includeSuperseded?: boolean;
    /** Skip cross-encoder reranking. Default false. */
    skipRerank?: boolean;
  },
): Promise<KnowledgeExcerpt[]> {
  const bridge = await getBridge();
  if (!bridge) return [];

  const scope = opts?.scope ?? 'shared';
  const limit = opts?.limit ?? 10;
  const minScore = opts?.minScore ?? 0.3;
  const store = opts?.store ?? 'all';

  const targets: Array<{ ns: string; dbPath?: string; root: string; label: string; boost: number }> = [];
  if (store !== 'global') {
    targets.push({ ns: namespace(scope), root: opts?.rootDir ?? getProjectRoot(), label: scope, boost: PROJECT_SCOPE_BOOST });
  }
  if (store !== 'project') {
    targets.push({ ns: namespace('global'), dbPath: GLOBAL_BRAIN_SENTINEL, root: globalBrainRoot(), label: 'global', boost: 0 });
  }

  const includeSuperseded = opts?.includeSuperseded === true;

  const perTarget = await Promise.all(targets.map(async t => {
    const meta = readMetadata(t.root);
    const hasMeta = hasKnowledgeMetadata(t.root);
    const live = new Set<string>();
    for (const m of meta) if (m.contentHash) live.add(m.contentHash);
    // Old versions dominate a long-lived store, so a 1:1 fetch would come back
    // nearly empty once they are filtered out. Over-fetch, then trim.
    const fetchLimit = includeSuperseded ? limit : supersededOverfetchLimit(limit, live);
    const result = await bridge.bridgeSearchEntries({
      query, namespace: t.ns, limit: fetchLimit, threshold: minScore, dbPath: t.dbPath,
      skipRerank: opts?.skipRerank,
    }).catch(() => null);
    if (!result?.success || !result.results.length) return [];
    const hashToFile = new Map<string, string>();
    for (const m of meta) hashToFile.set(m.contentHash, m.filePath);
    const kept = includeSuperseded
      ? result.results
      : result.results.filter((r: any) => !isSupersededKey(String(r.key ?? ''), live, hasMeta));
    return kept.slice(0, limit).map((r: any) => {
      const parts = r.key.startsWith('doc:') ? r.key.split(':') : [];
      const hash = parts[1] ?? '';
      const idx = parseInt(parts[2] ?? '0', 10);
      // The src: tag stored at ingest is the chunk's OWN provenance — the
      // hash→file map can misattribute when two documents share identical
      // content, and goes empty when a re-ingested file's hash changed.
      const srcTag = (r.tags ?? []).find((tag: string) => tag.startsWith('src:'));
      const superseded = includeSuperseded && isSupersededKey(String(r.key ?? ''), live, hasMeta);
      return {
        id: r.id,
        filePath: srcTag ? srcTag.slice(4) : hashToFile.get(hash) ?? '',
        text: r.content,
        similarity: r.score + t.boost,
        chunkIndex: isNaN(idx) ? 0 : idx,
        scope: t.label,
        ...(superseded ? { superseded: true } : {}),
      };
    });
  }));

  return perTarget.flat()
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

// ── List / Remove ──────────────────────────────────────────────────

export function listDocuments(rootDir = getProjectRoot(), scope?: string): DocumentMeta[] {
  const all = readMetadata(rootDir);
  return scope ? all.filter(m => m.scope === scope) : all;
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

export interface ReconcileReport {
  /** Indexed documents whose source file is no longer on disk. */
  missing: DocumentMeta[];
  /** Total index entries examined. */
  scanned: number;
  /** False for a dry run — the default. */
  applied: boolean;
  /** Entries actually tombstoned. Always 0 when `applied` is false. */
  removed: number;
  /** Where removed records were archived, when anything was removed. */
  archivePath?: string;
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

  const records = readMetadata(rootDir).filter(m => !opts?.scope || m.scope === opts.scope);
  const missing = records.filter(m => !fs.existsSync(m.filePath));

  if (!apply || missing.length === 0) {
    return { missing, scanned: records.length, applied: apply, removed: 0 };
  }

  // Archive BEFORE removing, inside the operation so no caller can bypass it
  // by forgetting — the same precondition rule the delete path uses.
  const dir = path.join(rootDir, '.monomind', 'knowledge', 'archive');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archivePath = path.join(dir, `reconcile-${stamp}.jsonl`);
  fs.writeFileSync(archivePath, missing.map(m => JSON.stringify(m)).join('\n') + '\n', 'utf-8');

  let removed = 0;
  for (const m of missing) {
    removeMetadataEntry(rootDir, m.filePath, m.scope);
    removed++;
  }

  return { missing, scanned: records.length, applied: true, removed, archivePath };
}

// ── OKF Export ─────────────────────────────────────────────────────

export async function exportToOKF(
  outputDir: string,
  rootDir = getProjectRoot(),
  scope = 'shared',
): Promise<{ exported: number; outputDir: string }> {
  const docs = listDocuments(rootDir, scope);
  fs.mkdirSync(outputDir, { recursive: true });

  let exported = 0;
  const indexEntries: string[] = [];

  for (const doc of docs) {
    // Read original content
    let content = '';
    try {
      if (fs.existsSync(doc.filePath)) {
        const entry = toFileEntry(doc.filePath);
        content = await extractText(entry);
      }
    } catch { continue; }

    if (!content) continue;

    const title = path.basename(doc.filePath, path.extname(doc.filePath));
    const ext = path.extname(doc.filePath).toLowerCase();
    const relativePath = path.relative(rootDir, doc.filePath);
    const slug = title.replace(/[^a-zA-Z0-9._-]+/g, '-').toLowerCase();
    const outFile = path.join(outputDir, `${slug}.md`);

    const yamlEscape = (s: string) => /[:"'\[\]{}#&*!|>%@`]/.test(s) ? `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : s;
    const frontmatter = [
      '---',
      `type: Document`,
      `title: ${yamlEscape(title)}`,
      `description: ${yamlEscape('Extracted from ' + path.basename(doc.filePath))}`,
      `resource: ${yamlEscape(relativePath)}`,
      `tags: ["document", ${yamlEscape(ext.slice(1))}]`,
      `timestamp: ${yamlEscape(doc.indexedAt)}`,
      `contentHash: ${yamlEscape(doc.contentHash)}`,
      `chunkCount: ${doc.chunkCount}`,
      '---',
      '',
    ].join('\n');

    fs.writeFileSync(outFile, frontmatter + content, 'utf-8');
    indexEntries.push(`* [${title}](${slug}.md) - ${path.basename(doc.filePath)} (${doc.chunkCount} chunks)`);
    exported++;
  }

  // Write index.md
  const indexContent = [
    `# Knowledge Bundle`,
    '',
    `Exported from monomind on ${new Date().toISOString().slice(0, 10)}`,
    '',
    ...indexEntries,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outputDir, 'index.md'), indexContent, 'utf-8');

  return { exported, outputDir };
}

// ── OKF Import ─────────────────────────────────────────────────────

export async function importFromOKF(
  bundleDir: string,
  scope = 'shared',
  rootDir = getProjectRoot(),
): Promise<BatchIngestResult> {
  const resolved = path.resolve(bundleDir);
  const files = fs.readdirSync(resolved)
    .filter(f => f.endsWith('.md') && f !== 'index.md' && f !== 'log.md')
    .map(f => path.join(resolved, f));

  const result: BatchIngestResult = {
    filesProcessed: 0, filesSkipped: 0, totalChunks: 0, errors: [], results: [],
  };

  for (const file of files) {
    const r = await ingestDocument(file, scope, rootDir);
    result.results.push(r);
    if (r.skipped) { result.filesSkipped++; }
    else { result.filesProcessed++; result.totalChunks += r.chunksIndexed; }
    if (r.error && !r.skipped) result.errors.push(`${r.filePath}: ${r.error}`);
  }

  return result;
}
