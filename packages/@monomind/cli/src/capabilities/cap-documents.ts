import fs from 'fs';
import type {
  CapabilityModule,
  DirectoryScan,
  FileEntry,
  IndexResult,
  SearchResult,
  HealthCheck,
} from './types.js';

const DOC_EXTENSIONS = new Set([
  '.pdf',
  '.docx',
  '.doc',
  '.md',
  '.txt',
  '.rtf',
  '.rst',
  '.tex',
  '.odt',
  '.pages',
  '.epub',
]);
const MAX_INDEX_FILE_SIZE = 50 * 1024 * 1024; // 50MB — skip oversized text files

// In-memory index for T0 (metadata) and T1 (content) — replaced by memory DB in production
const indexedDocs = new Map<string, { path: string; content: string; metadata: Record<string, unknown> }>();

async function extractText(file: FileEntry): Promise<string> {
  if (file.size > MAX_INDEX_FILE_SIZE) return '';

  const ext = file.extension;

  if (ext === '.md' || ext === '.txt' || ext === '.rst' || ext === '.tex') {
    return fs.readFileSync(file.absolutePath, 'utf-8');
  }

  if (ext === '.pdf') {
    try {
      // monolean: pdf-parse is an optional dependency — degrade to metadata-only if missing
      const pdfParse = (await import('pdf-parse')).default;
      const buffer = fs.readFileSync(file.absolutePath);
      const data = await pdfParse(buffer);
      return data.text;
    } catch {
      return ''; // pdf-parse not installed or file unreadable
    }
  }

  if (ext === '.docx') {
    try {
      // monolean: mammoth is an optional dependency — degrade to metadata-only if missing
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ path: file.absolutePath });
      return result.value;
    } catch {
      return ''; // mammoth not installed or file unreadable
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
    // monolean: simple substring search for T0/T1 — vector search added when memory integration lands
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
          score: 1 / (idx + 1), // closer to start = higher score
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

    // Check if PDF extraction is available
    try {
      await import('pdf-parse');
      checks.push({ name: 'PDF Extraction', status: 'pass', message: 'pdf-parse available' });
    } catch {
      checks.push({
        name: 'PDF Extraction',
        status: 'warn',
        message: 'pdf-parse not installed',
        hint: 'pnpm add pdf-parse',
      });
    }

    // Check if docx extraction is available
    try {
      await import('mammoth');
      checks.push({ name: 'DOCX Extraction', status: 'pass', message: 'mammoth available' });
    } catch {
      checks.push({
        name: 'DOCX Extraction',
        status: 'warn',
        message: 'mammoth not installed',
        hint: 'pnpm add mammoth',
      });
    }

    return checks;
  },
};
