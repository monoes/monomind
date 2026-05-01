import { readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import type { PipelinePhase, PipelineContext } from '../types.js';
import { isSupportedExtension } from '../../parsers/loader.js';
import { isSensitiveFile } from '../../security/sensitive-files.js';

const DEFAULT_IGNORE = new Set([
  'node_modules', '.git', 'dist', 'build', '__pycache__',
  '.cache', 'coverage', '.monomind', 'vendor', 'target',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2',
  '.ttf', '.eot', '.mp3', '.mp4', '.zip', '.gz', '.tar', '.pdf',
  '.exe', '.dll', '.so', '.dylib', '.class', '.jar',
]);

const GENERATED_PATTERNS = [/\.min\.(js|css)$/, /\.pb\.go$/, /_generated\.ts$/];

export interface ScanOutput {
  filePaths: string[];
  totalBytes: number;
}

export const scanPhase: PipelinePhase<ScanOutput> = {
  name: 'scan',
  deps: [],
  async execute(ctx) {
    const filePaths: string[] = [];
    let totalBytes = 0;
    const ignoreDirs = new Set([...DEFAULT_IGNORE, ...ctx.options.ignore]);

    function walk(dir: string) {
      let entries: string[];
      try { entries = readdirSync(dir); } catch { return; }

      for (const entry of entries) {
        if (ignoreDirs.has(entry)) continue;
        const fullPath = join(dir, entry);
        let stat: ReturnType<typeof statSync>;
        try { stat = statSync(fullPath); } catch { continue; }

        if (stat.isDirectory()) { walk(fullPath); continue; }

        const ext = extname(entry).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) continue;
        if (GENERATED_PATTERNS.some(r => r.test(entry))) continue;
        if (isSensitiveFile(fullPath)) continue;
        if (ctx.options.codeOnly && !isSupportedExtension(ext)) continue;

        filePaths.push(fullPath);
        totalBytes += stat.size;
      }
    }

    walk(ctx.repoPath);
    const assessment = assessCorpus({ fileCount: filePaths.length, totalBytes });
    if (assessment.level !== 'ok') {
      ctx.onProgress?.({ phase: 'scan', totalFiles: filePaths.length, message: assessment.warning });
    } else {
      ctx.onProgress?.({ phase: 'scan', totalFiles: filePaths.length });
    }
    return { filePaths, totalBytes };
  },
};

export interface CorpusAssessment {
  level: 'ok' | 'info' | 'warn';
  warning: string;
}

const WORDS_PER_BYTE = 0.1;
const CORPUS_LOW_WORDS = 50_000;
const CORPUS_HIGH_WORDS = 300_000;
const FILE_COUNT_HIGH = 200;

export function assessCorpus(opts: { fileCount: number; totalBytes: number }): CorpusAssessment {
  const estimatedWords = opts.totalBytes * WORDS_PER_BYTE;
  if (opts.fileCount > FILE_COUNT_HIGH || estimatedWords > CORPUS_HIGH_WORDS) {
    return {
      level: 'warn',
      warning: `Corpus is large (${opts.fileCount} files, ~${Math.round(estimatedWords / 1000)}K words). Build may take several minutes.`,
    };
  }
  if (estimatedWords < CORPUS_LOW_WORDS && opts.fileCount < 10) {
    return {
      level: 'info',
      warning: `Corpus may be too small (~${Math.round(estimatedWords / 1000)}K words). You may not need a knowledge graph yet.`,
    };
  }
  return { level: 'ok', warning: '' };
}
