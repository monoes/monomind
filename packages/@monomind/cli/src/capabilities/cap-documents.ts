import fs from 'fs';
import { createRequire } from 'node:module';
import type {
  CapabilityModule,
  DirectoryScan,
  FileEntry,
  IndexResult,
  SearchResult,
  HealthCheck,
} from './types.js';

export const DOC_EXTENSIONS = new Set([
  // Plain text
  '.md', '.txt', '.rst', '.tex', '.csv', '.tsv',
  // Microsoft Office
  '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt',
  // OpenDocument (LibreOffice / Google Docs export)
  '.odt', '.ods', '.odp',
  // Other
  '.pdf', '.rtf', '.epub', '.pages',
]);
const MAX_INDEX_FILE_SIZE = 50 * 1024 * 1024;

// In-memory index for T0 (metadata) and T1 (content) — replaced by memory DB in production
const indexedDocs = new Map<string, { path: string; content: string; metadata: Record<string, unknown> }>();

// ── ZIP-based XML text extraction (pptx, odt, odp, ods, epub) ──────
// These formats are all ZIP archives containing XML/HTML with text content.
// We use Node's built-in zlib via fflate (already in tree) or the AdmZip
// pattern — but to keep deps minimal, we shell out to `unzip -p` which is
// available on macOS/Linux, with a pure-JS fallback.

async function extractFromZip(filePath: string, xmlPaths: string[], stripTags: boolean): Promise<string> {
  // C1 hardening: use execFileSync with arg arrays (no shell) so filenames
  // and zip-entry names cannot trigger shell expansion. The previous
  // template-string + JSON.stringify form left $(...), `...`, and ${...}
  // open to evaluation inside the resulting double-quoted shell argument.
  const { execFileSync } = await import('node:child_process');
  const parts: string[] = [];

  for (const xmlPath of xmlPaths) {
    try {
      const raw = execFileSync(
        'unzip',
        ['-p', filePath, xmlPath],
        { maxBuffer: MAX_INDEX_FILE_SIZE, encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      parts.push(raw);
    } catch {
      // file not in archive — skip
    }
  }
  if (parts.length === 0) {
    // Fallback: list all XML/HTML files and extract them
    try {
      const listing = execFileSync(
        'unzip',
        ['-l', filePath],
        { maxBuffer: 1024 * 1024, encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      const candidates = listing.split('\n')
        .map(l => l.trim().split(/\s+/).pop() || '')
        .filter(f => /\.(xml|html|xhtml)$/i.test(f));
      for (const c of candidates.slice(0, 50)) {
        try {
          const raw = execFileSync(
            'unzip',
            ['-p', filePath, c],
            { maxBuffer: MAX_INDEX_FILE_SIZE, encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] },
          );
          parts.push(raw);
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  const joined = parts.join('\n');
  if (!stripTags) return joined;
  return joined
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── RTF text extraction (no dep) ───────────────────────────────────
// Skips destination groups ({\*\...}), extracts visible text, handles
// \'xx hex escapes, \par/\line/\tab, and ignores all other control words.
function extractRtfText(content: string): string {
  let depth = 0;
  let skipDepth = 0;
  let result = '';
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '{') {
      depth++;
      // Check for destination group {\*\...} — skip entirely
      if (i + 2 < content.length && content[i + 1] === '\\' && content[i + 2] === '*') {
        skipDepth = depth;
      }
      i++; continue;
    }
    if (ch === '}') {
      if (depth === skipDepth) skipDepth = 0;
      depth = Math.max(0, depth - 1);
      i++; continue;
    }
    if (skipDepth > 0) { i++; continue; }
    if (ch === '\\') {
      i++;
      if (i >= content.length) break;
      const next = content[i];
      if (next === '\n' || next === '\r') { result += '\n'; i++; continue; }
      // Escaped literal chars
      if (next === '{' || next === '}' || next === '\\') { result += next; i++; continue; }
      // Hex escape \'xx
      if (next === "'" && i + 2 < content.length) {
        const code = parseInt(content.substring(i + 1, i + 3), 16);
        if (!isNaN(code)) result += String.fromCharCode(code);
        i += 3; continue;
      }
      // Control word: letter sequence + optional signed integer + optional trailing space
      let word = '';
      while (i < content.length && /[a-zA-Z]/.test(content[i])) { word += content[i]; i++; }
      while (i < content.length && /[-\d]/.test(content[i])) i++;
      if (i < content.length && content[i] === ' ') i++;
      if (word === 'par' || word === 'line') result += '\n';
      else if (word === 'tab') result += '\t';
      continue;
    }
    result += ch;
    i++;
  }
  return result.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

export async function extractText(file: FileEntry): Promise<string> {
  if (file.size > MAX_INDEX_FILE_SIZE) return '';

  const ext = file.extension;

  // Plain text formats
  if (ext === '.md' || ext === '.txt' || ext === '.rst' || ext === '.tex'
      || ext === '.csv' || ext === '.tsv') {
    return fs.readFileSync(file.absolutePath, 'utf-8');
  }

  // RTF — pure string parsing, no dep
  if (ext === '.rtf') {
    try {
      const content = fs.readFileSync(file.absolutePath, 'utf-8');
      return extractRtfText(content);
    } catch { return ''; }
  }

  // PDF — native Rust extraction via @firecrawl/pdf-inspector
  if (ext === '.pdf') {
    try {
      const { processPdf } = await import('@firecrawl/pdf-inspector');
      const buffer = fs.readFileSync(file.absolutePath);
      const result = processPdf(buffer);
      return result.markdown ?? '';
    } catch {
      return '';
    }
  }

  // DOCX — mammoth
  if (ext === '.docx') {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ path: file.absolutePath });
      return result.value;
    } catch {
      return '';
    }
  }

  // XLSX / XLS — SheetJS
  if (ext === '.xlsx' || ext === '.xls') {
    try {
      // monolean: xlsx is optional — degrade gracefully if missing
      const req = createRequire(import.meta.url);
      const XLSX = req('xlsx');
      const workbook = XLSX.readFile(file.absolutePath, { type: 'file' });
      const parts: string[] = [];
      for (const name of workbook.SheetNames) {
        const sheet = workbook.Sheets[name];
        const text = XLSX.utils.sheet_to_csv(sheet, { FS: '\t', blankrows: false });
        if (text.trim()) parts.push(`[Sheet: ${name}]\n${text}`);
      }
      return parts.join('\n\n');
    } catch {
      return '';
    }
  }

  // PPTX — ZIP with XML slides
  if (ext === '.pptx') {
    try {
      const slidePaths = Array.from({ length: 100 }, (_, i) => `ppt/slides/slide${i + 1}.xml`);
      return await extractFromZip(file.absolutePath, slidePaths, true);
    } catch { return ''; }
  }

  // OpenDocument Text (.odt)
  if (ext === '.odt') {
    try {
      return await extractFromZip(file.absolutePath, ['content.xml'], true);
    } catch { return ''; }
  }

  // OpenDocument Spreadsheet (.ods)
  if (ext === '.ods') {
    try {
      // Try xlsx first (it handles ODS too)
      const req = createRequire(import.meta.url);
      const XLSX = req('xlsx');
      const workbook = XLSX.readFile(file.absolutePath, { type: 'file' });
      const parts: string[] = [];
      for (const name of workbook.SheetNames) {
        const sheet = workbook.Sheets[name];
        const text = XLSX.utils.sheet_to_csv(sheet, { FS: '\t', blankrows: false });
        if (text.trim()) parts.push(`[Sheet: ${name}]\n${text}`);
      }
      return parts.join('\n\n');
    } catch {
      // Fallback to XML extraction
      try { return await extractFromZip(file.absolutePath, ['content.xml'], true); } catch { return ''; }
    }
  }

  // OpenDocument Presentation (.odp)
  if (ext === '.odp') {
    try {
      return await extractFromZip(file.absolutePath, ['content.xml'], true);
    } catch { return ''; }
  }

  // EPUB — ZIP with XHTML chapters
  if (ext === '.epub') {
    try {
      return await extractFromZip(file.absolutePath, [], true);
    } catch { return ''; }
  }

  // .doc / .ppt — legacy binary formats, best-effort via textutil (macOS) or antiword
  if (ext === '.doc' || ext === '.ppt' || ext === '.pages') {
    try {
      const { execFileSync } = await import('node:child_process');
      // C1 hardening: arg-array form (no shell) so filenames containing
      // $(...), `...`, $VAR etc. cannot be evaluated by the shell.
      const text = execFileSync(
        'textutil',
        ['-convert', 'txt', '-stdout', file.absolutePath],
        { maxBuffer: MAX_INDEX_FILE_SIZE, encoding: 'utf-8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      return text.trim();
    } catch {
      return '';
    }
  }

  return '';
}

export const documentsCapability: CapabilityModule = {
  name: 'documents',

  detect(scan: DirectoryScan): number {
    return scan.capabilities.documents.confidence;
  },

  async activate(_rootDir: string): Promise<void> {
    indexedDocs.clear();
  },

  async index(files: FileEntry[]): Promise<IndexResult> {
    let indexed = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const file of files) {
      if (!DOC_EXTENSIONS.has(file.extension)) {
        skipped++;
        continue;
      }

      try {
        const content = await extractText(file);
        indexedDocs.set(file.path, {
          path: file.path,
          content,
          metadata: {
            size: file.size,
            modified: file.modified.toISOString(),
            created: file.created.toISOString(),
            extension: file.extension,
          },
        });
        indexed++;
      } catch (err) {
        errors.push(`${file.path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { indexed, skipped, errors };
  },

  async search(query: string, limit = 20): Promise<SearchResult[]> {
    const queryLower = query.toLowerCase();
    const results: SearchResult[] = [];

    for (const [docPath, doc] of indexedDocs) {
      const contentLower = doc.content.toLowerCase();
      const idx = contentLower.indexOf(queryLower);
      if (idx !== -1) {
        const start = Math.max(0, idx - 40);
        const end = Math.min(doc.content.length, idx + query.length + 40);
        results.push({
          path: docPath,
          score: 1 / (idx + 1),
          snippet: doc.content.slice(start, end).trim(),
          type: 'documents',
          metadata: doc.metadata,
        });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  },

  async healthChecks(): Promise<HealthCheck[]> {
    const checks: HealthCheck[] = [];

    try {
      await import('@firecrawl/pdf-inspector');
      checks.push({ name: 'PDF', status: 'pass', message: '@firecrawl/pdf-inspector available' });
    } catch {
      checks.push({ name: 'PDF', status: 'warn', message: '@firecrawl/pdf-inspector not installed', hint: 'pnpm add @firecrawl/pdf-inspector' });
    }

    try {
      await import('mammoth');
      checks.push({ name: 'DOCX', status: 'pass', message: 'mammoth available' });
    } catch {
      checks.push({ name: 'DOCX', status: 'warn', message: 'mammoth not installed', hint: 'pnpm add mammoth' });
    }

    try {
      const req = createRequire(import.meta.url);
      req.resolve('xlsx');
      checks.push({ name: 'XLSX/XLS/ODS', status: 'pass', message: 'xlsx available' });
    } catch {
      checks.push({ name: 'XLSX/XLS/ODS', status: 'warn', message: 'xlsx not installed', hint: 'pnpm add xlsx' });
    }

    // PPTX/ODT/ODP use unzip (system), RTF/CSV are pure JS — always available
    try {
      const { execFileSync } = await import('node:child_process');
      execFileSync('which', ['unzip'], { encoding: 'utf-8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] });
      checks.push({ name: 'PPTX/ODT/ODP/EPUB', status: 'pass', message: 'unzip available' });
    } catch {
      checks.push({ name: 'PPTX/ODT/ODP/EPUB', status: 'warn', message: 'unzip not found', hint: 'install unzip (apt install unzip / brew install unzip)' });
    }

    return checks;
  },
};
