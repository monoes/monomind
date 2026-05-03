import { readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import type { PipelinePhase, PipelineContext } from '../types.js';
import { isSupportedExtension } from '../../parsers/loader.js';

const DEFAULT_IGNORE = new Set([
  'node_modules', '.git', 'dist', 'build', '__pycache__',
  '.cache', 'coverage', '.monomind', 'vendor', 'target',
  '.worktrees', '.claude', '.claude-plugin', '.github', '.githooks',
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
        if (ctx.options.codeOnly && !isSupportedExtension(ext)) continue;

        filePaths.push(fullPath);
        totalBytes += stat.size;
      }
    }

    walk(ctx.repoPath);
    ctx.onProgress?.({ phase: 'scan', totalFiles: filePaths.length });
    return { filePaths, totalBytes };
  },
};
