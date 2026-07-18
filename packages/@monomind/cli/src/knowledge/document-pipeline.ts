/**
 * Document Pipeline — wires text extraction, chunking, embedding, and LanceDB storage
 * into an end-to-end ingest/search/export pipeline for the Second Brain.
 *
 * @module v1/cli/knowledge/document-pipeline
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
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
function lastHeadingBefore(text: string, pos: number): string | null {
  let i = text.lastIndexOf('\n#', pos - 1);
  while (i !== -1) {
    const eol = text.indexOf('\n', i + 1);
    const line = text.slice(i + 1, eol === -1 ? undefined : eol);
    if (HEADING_LINE_RE.test(line)) return line.replace(/^#+ /, '').trim();
    i = text.lastIndexOf('\n#', i - 1);
  }
  const firstEol = text.indexOf('\n');
  const firstLine = firstEol === -1 ? text : text.slice(0, firstEol);
  return HEADING_LINE_RE.test(firstLine) && firstEol !== -1 && firstEol < pos
    ? firstLine.replace(/^#+ /, '').trim() : null;
}
function chunkDocumentInline(docId: string, text: string): TextChunk[] {
  if (text.length === 0) return [];
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
        if (HEADING_LINE_RE.test(line) && windowStart + h > startChar) break;
        h = window.lastIndexOf('\n#', h - 1);
      }
      if (h !== -1 && windowStart + h > startChar) {
        endChar = windowStart + h + 1;
        brokeAtHeading = true;
      } else {
        const lastParagraph = window.lastIndexOf('\n\n');
        if (lastParagraph !== -1) endChar = windowStart + lastParagraph + 2;
      }
    }
    let chunkText = text.slice(startChar, endChar);
    const heading = lastHeadingBefore(text, startChar + 1);
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
  return fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function appendMetadata(rootDir: string, meta: DocumentMeta): void {
  fs.appendFileSync(metadataPath(rootDir), JSON.stringify(meta) + '\n', 'utf-8');
}

function removeMetadataEntry(rootDir: string, filePath: string, scope: string): void {
  const file = metadataPath(rootDir);
  if (!fs.existsSync(file)) return;
  const records = readMetadata(rootDir).filter(m => !(m.filePath === filePath && m.scope === scope));
  fs.writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''), 'utf-8');
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
        });
        if (storeResult?.success) indexed++;
      } catch (e) {
        if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error(`[ingestDocument] failed to store chunk ${chunk.chunkIndex} of ${resolved}:`, e);
      }
    }
  }

  // Persist metadata
  appendMetadata(rootDir, {
    filePath: resolved,
    contentHash: hash,
    chunkCount: chunks.length,
    indexedAt: new Date().toISOString(),
    scope,
    size: stat.size,
  });

  return { filePath: resolved, chunksIndexed: indexed, scope, skipped: false };
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
      if (entry.name.startsWith('.') || entry.name.startsWith('._')) continue;
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

export async function searchKnowledge(
  query: string,
  opts?: { scope?: string; limit?: number; minScore?: number; rootDir?: string },
): Promise<KnowledgeExcerpt[]> {
  const bridge = await getBridge();
  if (!bridge) return [];

  const scope = opts?.scope ?? 'shared';
  const limit = opts?.limit ?? 10;
  const minScore = opts?.minScore ?? 0.3;

  const result = await bridge.bridgeSearchEntries({
    query,
    namespace: namespace(scope),
    limit,
    threshold: minScore,
  });

  if (!result?.success || !result.results.length) return [];

  const meta = readMetadata(opts?.rootDir ?? process.cwd());
  const hashToFile = new Map<string, string>();
  for (const m of meta) {
    hashToFile.set(m.contentHash, m.filePath);
  }

  return result.results.map(r => {
    const parts = r.key.startsWith('doc:') ? r.key.split(':') : [];
    const hash = parts[1] ?? '';
    const idx = parseInt(parts[2] ?? '0', 10);
    return {
      filePath: hashToFile.get(hash) ?? '',
      text: r.content,
      similarity: r.score,
      chunkIndex: isNaN(idx) ? 0 : idx,
      scope,
    };
  });
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
  // LanceDB cleanup: bridge doesn't expose delete-by-key, so metadata removal is sufficient.
  // Orphaned LanceDB entries get swept on next full re-index or TTL expiry.
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
