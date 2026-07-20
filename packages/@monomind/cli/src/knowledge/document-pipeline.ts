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
  rootDir = process.cwd(),
  _metadataCache?: DocumentMeta[],
): Promise<IngestResult> {
  const resolved = path.resolve(filePath);
  const ext = path.extname(resolved).toLowerCase();

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
  const chunks: TextChunk[] = await chunkDocument(docId, fullContent);
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
  const rootDir = path.resolve(opts?.rootDir ?? process.cwd());
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

export async function searchKnowledge(
  query: string,
  opts?: {
    scope?: string; limit?: number; minScore?: number; rootDir?: string;
    /** which store(s): project-only, global-only, or both (default). */
    store?: 'project' | 'global' | 'all';
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
    targets.push({ ns: namespace(scope), root: opts?.rootDir ?? process.cwd(), label: scope, boost: PROJECT_SCOPE_BOOST });
  }
  if (store !== 'project') {
    targets.push({ ns: namespace('global'), dbPath: GLOBAL_BRAIN_SENTINEL, root: globalBrainRoot(), label: 'global', boost: 0 });
  }

  const perTarget = await Promise.all(targets.map(async t => {
    const result = await bridge.bridgeSearchEntries({
      query, namespace: t.ns, limit, threshold: minScore, dbPath: t.dbPath,
    }).catch(() => null);
    if (!result?.success || !result.results.length) return [];
    const meta = readMetadata(t.root);
    const hashToFile = new Map<string, string>();
    for (const m of meta) hashToFile.set(m.contentHash, m.filePath);
    return result.results.map((r: any) => {
      const parts = r.key.startsWith('doc:') ? r.key.split(':') : [];
      const hash = parts[1] ?? '';
      const idx = parseInt(parts[2] ?? '0', 10);
      // The src: tag stored at ingest is the chunk's OWN provenance — the
      // hash→file map can misattribute when two documents share identical
      // content, and goes empty when a re-ingested file's hash changed.
      const srcTag = (r.tags ?? []).find((tag: string) => tag.startsWith('src:'));
      return {
        id: r.id,
        filePath: srcTag ? srcTag.slice(4) : hashToFile.get(hash) ?? '',
        text: r.content,
        similarity: r.score + t.boost,
        chunkIndex: isNaN(idx) ? 0 : idx,
        scope: t.label,
      };
    });
  }));

  return perTarget.flat()
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

// ── List / Remove ──────────────────────────────────────────────────

export function listDocuments(rootDir = process.cwd(), scope?: string): DocumentMeta[] {
  const all = readMetadata(rootDir);
  return scope ? all.filter(m => m.scope === scope) : all;
}

export async function removeDocument(
  filePath: string,
  scope = 'shared',
  rootDir = process.cwd(),
): Promise<void> {
  removeMetadataEntry(rootDir, path.resolve(filePath), scope);
  // SQLite cleanup: bridge doesn't expose delete-by-key, so metadata removal is sufficient.
  // Orphaned SQLite entries get swept on next full re-index or TTL expiry.
}

// ── OKF Export ─────────────────────────────────────────────────────

export async function exportToOKF(
  outputDir: string,
  rootDir = process.cwd(),
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
  rootDir = process.cwd(),
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
