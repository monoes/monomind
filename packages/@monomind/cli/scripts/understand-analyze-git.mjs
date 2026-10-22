// understand-analyze-git.mjs — Incremental mode helpers (ported from
// staleness.ts). File-size sweep: split out of understand-analyze.mjs.

import { execFileSync } from 'node:child_process';

export function getChangedFiles(dir, lastHash) {
  const files = new Set();
  function runGit(args) {
    try {
      const out = execFileSync('git', args, { cwd: dir, encoding: 'utf-8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
      for (const line of out.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // `git status --porcelain` lines look like " M path/to/file" or "?? path"
        // Strip the leading status code if present
        const path = trimmed.length > 3 && trimmed[2] === ' ' ? trimmed.slice(3) : trimmed;
        files.add(path);
      }
    } catch { /* git not available or no diff */ }
  }
  // Committed changes since last run
  runGit(['diff', `${lastHash}..HEAD`, '--name-only']);
  // Uncommitted working tree changes (staged + unstaged + untracked)
  runGit(['status', '--porcelain']);
  return [...files];
}

export function getCurrentCommitHash(dir) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}
