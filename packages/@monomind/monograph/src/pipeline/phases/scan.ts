import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, type statSync } from 'node:fs';
import { extname, join } from 'node:path';
import micromatch from 'micromatch';
import { isSupportedExtension } from '../../parsers/loader.js';
import { isSensitiveFile } from '../../security/sensitive-files.js';
import type { PipelinePhase } from '../types.js';

const DEFAULT_IGNORE = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '__pycache__',
  '.cache',
  'coverage',
  '.monomind',
  'vendor',
  'target',
  '.worktrees',
  '.claude',
  '.claude-plugin',
  '.github',
  '.githooks',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.vercel',
  '.wrangler',
  '.open-next',
  // Platform asset mirrors `monomind init` writes next to .claude/, the
  // monograph cache and the agent mail dir — never user source (#404).
  '.agents',
  '.gemini',
  '.kimi-code',
  '.opencode',
  '.codex',
  '.monograph',
  '.mail',
  // pi's extension dir, written by `monomind init` — tool-managed, not user source.
  '.pi',
]);

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.mp3',
  '.mp4',
  '.zip',
  '.gz',
  '.tar',
  '.pdf',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.class',
  '.jar',
]);

const GENERATED_PATTERNS = [
  /\.min\.(js|css)$/,
  /\.pb\.go$/,
  /_generated\.ts$/,
  // Monograph's own build output (written to the repo root before #414, and still
  // when a build passes reportPath: 'GRAPH_REPORT.md'). Indexing it feeds a previous build's prose back into the graph as
  // document nodes and edges, compounding on every rebuild.
  /^GRAPH_REPORT\.md$/,
];

/**
 * Files git would consider part of the working tree under `repoPath` (tracked
 * plus untracked-but-not-ignored), relative to `repoPath`, and every ancestor
 * directory of those files. Returns null outside a git work tree or when git
 * is unavailable, so the scan falls back to walking everything.
 */
function listGitVisible(repoPath: string): { files: Set<string>; dirs: Set<string> } | null {
  let out: string;
  try {
    out = execFileSync(
      'git',
      ['-C', repoPath, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    return null;
  }
  const files = new Set<string>();
  const dirs = new Set<string>();
  for (const raw of out.split('\0')) {
    // A trailing slash marks a nested repository/submodule git does not descend into.
    const rel = raw.endsWith('/') ? raw.slice(0, -1) : raw;
    if (!rel) continue;
    files.add(rel);
    for (let i = rel.indexOf('/'); i !== -1; i = rel.indexOf('/', i + 1)) {
      dirs.add(rel.slice(0, i));
    }
  }
  return { files, dirs };
}

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
    if (ctx.options.includeToolAssets) ignoreDirs.delete('.pi');

    // Read .monographignore patterns
    const ignorePatterns: string[] = [];
    const negationPatterns: string[] = [];
    const ignoreFilePath = join(ctx.repoPath, '.monographignore');
    if (existsSync(ignoreFilePath)) {
      const raw = readFileSync(ignoreFilePath, 'utf8');
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        if (trimmed.startsWith('!')) {
          negationPatterns.push(trimmed.slice(1)); // strip the !
        } else {
          ignorePatterns.push(trimmed);
        }
      }
    }

    // Honour .gitignore: inside a git work tree only files git lists are scanned.
    const gitVisible = listGitVisible(ctx.repoPath);
    const relOf = (fullPath: string) => fullPath.slice(ctx.repoPath.length + 1).replace(/\\/g, '/');
    const isRescued = (rel: string) =>
      negationPatterns.length > 0 && micromatch.isMatch(rel, negationPatterns, { dot: true });

    // `gitFiltered` is false below a submodule or nested repo, which git lists
    // as a single entry — everything inside it is walked as before.
    function walk(dir: string, gitFiltered = gitVisible !== null) {
      let dirents: import('fs').Dirent[];
      try {
        dirents = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const dirent of dirents) {
        const entry = dirent.name;
        if (ignoreDirs.has(entry)) continue;
        // Skip macOS AppleDouble resource fork files (._*) — common on ExFAT/network volumes
        if (entry.startsWith('._')) continue;
        // Never follow symlinks — a symlink to an ancestor directory causes infinite
        // recursion (stack overflow), and a symlink to a large external tree would
        // get fully indexed as if it were part of the repo. Matches how most
        // code-indexing tools behave by default.
        if (dirent.isSymbolicLink()) continue;
        const fullPath = join(dir, entry);
        let stat: ReturnType<typeof statSync>;
        try {
          stat = lstatSync(fullPath);
        } catch {
          continue;
        }

        const rel = relOf(fullPath);
        if (stat.isDirectory()) {
          if (!gitVisible || !gitFiltered) walk(fullPath, false);
          else if (gitVisible.files.has(rel)) walk(fullPath, false);
          // Skip wholly gitignored trees (venvs, caches) unless a negation
          // pattern could rescue something inside them.
          else if (gitVisible.dirs.has(rel) || negationPatterns.length > 0) walk(fullPath, true);
          continue;
        }

        if (gitVisible && gitFiltered && !gitVisible.files.has(rel) && !isRescued(rel)) continue;

        if (ignorePatterns.length > 0) {
          const isIgnored = micromatch.isMatch(rel, ignorePatterns, { dot: true });
          const isDirIgnored = micromatch.isMatch(
            rel,
            ignorePatterns.map((p) => (p.endsWith('/') ? `${p}**` : p)),
            { dot: true },
          );
          if ((isIgnored || isDirIgnored) && !isRescued(rel)) continue;
        }

        const ext = extname(entry).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) continue;
        if (GENERATED_PATTERNS.some((r) => r.test(entry))) continue;
        if (isSensitiveFile(fullPath)) continue;
        if (ctx.options.codeOnly && !isSupportedExtension(ext)) continue;

        filePaths.push(fullPath);
        totalBytes += stat.size;
      }
    }

    walk(ctx.repoPath);
    const assessment = assessCorpus({ fileCount: filePaths.length, totalBytes });
    if (assessment.level !== 'ok') {
      ctx.onProgress?.({
        phase: 'scan',
        totalFiles: filePaths.length,
        message: assessment.warning,
      });
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
