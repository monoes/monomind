import { readdirSync, statSync } from 'fs';
import { join, extname, relative } from 'path';
import type { BuildOptions, ClassifiedFile, FileType } from './types.js';

const DEFAULT_MAX_FILE_SIZE = 500 * 1024; // 500KB

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.monobrain',
  '__pycache__',
  '.pytest_cache',
  'target',
  '.cache',
]);

// Maps file extension to [fileType, language]
const EXTENSION_MAP: Record<string, [FileType, string]> = {
  '.ts':    ['code', 'typescript'],
  '.tsx':   ['code', 'typescript'],
  '.js':    ['code', 'javascript'],
  '.jsx':   ['code', 'javascript'],
  '.py':    ['code', 'python'],
  '.go':    ['code', 'go'],
  '.rs':    ['code', 'rust'],
  '.java':  ['code', 'java'],
  '.c':     ['code', 'c'],
  '.cpp':   ['code', 'cpp'],
  '.h':     ['code', 'c'],
  '.cs':    ['code', 'csharp'],
  '.rb':    ['code', 'ruby'],
  '.php':   ['code', 'php'],
  '.swift': ['code', 'swift'],
  '.kt':    ['code', 'kotlin'],
  '.scala': ['code', 'scala'],
  '.md':    ['document', 'markdown'],
  '.txt':   ['document', 'text'],
  '.rst':   ['document', 'rst'],
};

/**
 * Recursively collects and classifies all files under rootPath, applying
 * exclusion rules for directories, file size limits, and optional language
 * filtering from BuildOptions.
 */
export function collectFiles(
  rootPath: string,
  options: BuildOptions = {},
): ClassifiedFile[] {
  const maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE;
  const codeOnly = options.codeOnly ?? false;
  const languageFilter = options.languages ? new Set(options.languages) : null;
  const excludePatterns = options.excludePatterns ?? [];

  const results: ClassifiedFile[] = [];

  function walkDir(dirPath: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dirPath);
    } catch {
      // Skip unreadable directories
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dirPath, entry);

      // Check against custom exclude patterns (matched against relative path)
      const relPath = relative(rootPath, fullPath);
      if (excludePatterns.some((pat) => relPath.includes(pat))) {
        continue;
      }

      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        // Skip excluded directory names
        if (EXCLUDED_DIRS.has(entry)) continue;
        walkDir(fullPath);
        continue;
      }

      if (!stat.isFile()) continue;

      // Enforce file size limit
      if (stat.size > maxFileSizeBytes) continue;

      const ext = extname(entry).toLowerCase();
      const mapping = EXTENSION_MAP[ext];

      if (!mapping) {
        // Unknown extension — skip rather than emit 'unknown' noise
        continue;
      }

      const [fileType, language] = mapping;

      // Apply codeOnly filter
      if (codeOnly && fileType !== 'code') continue;

      // Apply language filter
      if (languageFilter && !languageFilter.has(language)) continue;

      results.push({
        path: fullPath,
        fileType,
        language,
        sizeBytes: stat.size,
      });
    }
  }

  walkDir(rootPath);
  return results;
}
