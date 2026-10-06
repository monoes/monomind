// packages/@monomind/cli/src/orgrt/sandbox-stubs-exclude.ts
// While sandbox stubs sit in a repo root (sandbox-stubs.ts) `git status` would list them as untracked, which
// reads like debris and trips "git status is clean" checks. This keeps a marked block in the repo's
// info/exclude naming the stubs that exist right now, and takes the block out when none do. It reads the
// filesystem, not a count, so concurrent runs cannot leave it stale, and a real file with content is never named.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { CWD_STUBS } from './sandbox-stubs-paths.js';

const BEGIN = '# >>> monomind sandbox stubs (managed, removed when the run ends)';
const END = '# <<< monomind sandbox stubs';

/** A real repository's `.git`: a directory with a HEAD, or a worktree's `gitdir:` file. An empty directory
 *  or one holding only a runtime's stub (`config.worktree`) is not one, and git itself walks past it. */
function hasRepo(dir: string): boolean {
  const dot = join(dir, '.git');
  try {
    return statSync(dot).isDirectory()
      ? existsSync(join(dot, 'HEAD'))
      : /^gitdir:/m.test(readFileSync(dot, 'utf8'));
  } catch {
    return false;
  }
}

/** The nearest directory at or above `dir` that is a git work tree. */
export function repoRootOf(dir: string): string | null {
  for (let d = dir; ; d = dirname(d)) {
    if (hasRepo(d)) return d;
    if (dirname(d) === d) return null;
  }
}

/** Where git reads exclude patterns for this work tree (the common dir's, for a linked worktree). */
function excludeFileOf(root: string): string | null {
  try {
    const dot = join(root, '.git');
    if (statSync(dot).isDirectory()) return join(dot, 'info', 'exclude');
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dot, 'utf8'));
    if (!m) return null;
    const gitdir = isAbsolute(m[1].trim()) ? m[1].trim() : resolve(root, m[1].trim());
    const common = join(gitdir, 'commondir');
    const base = existsSync(common) ? resolve(gitdir, readFileSync(common, 'utf8').trim()) : gitdir;
    return join(base, 'info', 'exclude');
  } catch {
    return null;
  }
}

/** An empty file or directory: what a stub looks like. Anything with content is the user's. */
function isStub(p: string): boolean {
  try {
    const st = lstatSync(p);
    return st.isDirectory() ? readdirSync(p).length === 0 : st.isFile() && st.size === 0;
  } catch {
    return false;
  }
}

/** `text` without any managed block. */
function withoutBlock(text: string): string {
  let out = text;
  for (let i = out.indexOf(BEGIN); i !== -1; i = out.indexOf(BEGIN)) {
    const end = out.indexOf(END, i);
    if (end === -1) return out.slice(0, i);
    const after = out.indexOf('\n', end);
    out = out.slice(0, i) + (after === -1 ? '' : out.slice(after + 1));
  }
  return out;
}

/** Rewrites the managed block of `root`'s exclude file to match the stubs that exist now. Best effort. */
export function syncStubExcludes(root: string): void {
  const file = excludeFileOf(root);
  if (!file) return;
  try {
    const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const kept = withoutBlock(current);
    const names = CWD_STUBS.filter((rel) => isStub(join(root, rel)));
    const next = names.length
      ? `${kept}${kept === '' || kept.endsWith('\n') ? '' : '\n'}${BEGIN}\n${names.map((n) => `/${n}`).join('\n')}\n${END}\n`
      : kept;
    if (next === current) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, next);
  } catch {
    /* a read-only .git: the stubs just show in git status, as before */
  }
}
