/**
 * Deterministic evaluation corpus.
 *
 * Reproducibility rules this file exists to enforce:
 *  - The corpus is derived from git-tracked files only, so a clean checkout at
 *    a given commit produces exactly the same document set.
 *  - The list is sorted by path, so ordering never depends on filesystem walk
 *    order (which differs between macOS and Linux).
 *  - Every run records a corpusHash over (path, sha256) pairs. Two scoreboard
 *    rows with different corpusHash values are NOT comparable.
 *
 * @module v1/cli/knowledge/eval/corpus
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export interface CorpusDoc {
  /** Repo-relative POSIX path — the stable document id used in the golden set. */
  id: string;
  absPath: string;
  bytes: number;
  sha256: string;
}

export interface Corpus {
  docs: CorpusDoc[];
  corpusHash: string;
  repoRoot: string;
  /** Paths matched by the include rules but dropped, with the reason. */
  excluded: Array<{ id: string; reason: string }>;
  /**
   * Byte-identical documents collapsed to one content unit.
   *
   * This repo ships a verbatim mirror of `.claude/**` inside the CLI package
   * (an npm-packaging requirement), so ~200 documents exist twice. Without
   * this, a retriever that returns the identical twin of the gold document
   * scores a MISS for returning the correct content — which measures path
   * luck, not retrieval. Identical bytes are one document.
   */
  canonicalOf: Map<string, string>;
  /** Number of distinct content units (<= docs.length). */
  contentUnits: number;
  duplicateGroups: number;
  /** AppleDouble `._` resource forks found. Must be zero. */
  appleDoubleCount: number;
}

/** Extensions the document pipeline can actually extract text from and that
 *  carry prose. Source files are deliberately out: the golden set judges
 *  document retrieval, and the code graph is a separate surface. */
const CORPUS_EXTENSIONS = new Set(['.md']);

/** AppleDouble resource forks. Per-SEGMENT anchored, so it catches
 *  `docs/concepts/._memory.md` and not merely a leading dot at the repo root. */
export const APPLEDOUBLE_RE = /(^|\/)\._/;

/** Directories whose contents are generated, vendored, or per-machine state. */
const EXCLUDE_PATTERNS = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)\.monomind\//,
  /(^|\/)coverage\//,
  APPLEDOUBLE_RE,         // exFAT resource-fork turds
];

/** Files too small to contain a retrievable answer. */
const MIN_BYTES = 400;

/** The repository top level. Without this the corpus silently differs
 *  depending on which subdirectory you ran from — and two scoreboard rows
 *  would be incomparable for a reason nobody would think to check. */
export function resolveRepoRoot(start: string): string {
  try {
    return execFileSync('git', ['-C', start, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return path.resolve(start);
  }
}

export function listTrackedFiles(repoRoot: string): string[] {
  const out = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z'], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

export function buildCorpus(startDir: string): Corpus {
  const repoRoot = resolveRepoRoot(startDir);
  const excluded: Array<{ id: string; reason: string }> = [];
  const docs: CorpusDoc[] = [];
  const tracked = listTrackedFiles(repoRoot).sort();

  // Counted from the RAW tracked list, before any exclusion runs.
  //
  // This was a bug, caught by a deliberate-violation test: the count used to be
  // derived from `docs`, which the exclusion pattern had already emptied of
  // `._` files. It was therefore always 0, and the "hard failure" downstream
  // could never fire — a silent filter wearing an assert's name. A guard with
  // no reachable firing condition is an assumption, not a guard.
  const appleDoubleCount = tracked.filter(
    rel => APPLEDOUBLE_RE.test(rel) && CORPUS_EXTENSIONS.has(path.extname(rel).toLowerCase()),
  ).length;

  for (const rel of tracked) {
    if (!CORPUS_EXTENSIONS.has(path.extname(rel).toLowerCase())) continue;
    if (EXCLUDE_PATTERNS.some(re => re.test(rel))) { excluded.push({ id: rel, reason: 'excluded path' }); continue; }
    const abs = path.join(repoRoot, rel);
    let stat: fs.Stats;
    try { stat = fs.statSync(abs); } catch { excluded.push({ id: rel, reason: 'unreadable' }); continue; }
    if (!stat.isFile()) continue;
    if (stat.size < MIN_BYTES) { excluded.push({ id: rel, reason: 'under ' + MIN_BYTES + ' bytes' }); continue; }
    const content = fs.readFileSync(abs);
    docs.push({
      id: rel,
      absPath: abs,
      bytes: stat.size,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
    });
  }

  // Collapse byte-identical documents. Canonical = shortest path, ties broken
  // lexicographically, so the choice is deterministic and never depends on
  // filesystem order.
  const byHash = new Map<string, string[]>();
  for (const d of docs) {
    const arr = byHash.get(d.sha256);
    if (arr) arr.push(d.id); else byHash.set(d.sha256, [d.id]);
  }
  const canonicalOf = new Map<string, string>();
  let duplicateGroups = 0;
  for (const [, ids] of byHash) {
    const canon = [...ids].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
    for (const id of ids) canonicalOf.set(id, canon);
    if (ids.length > 1) duplicateGroups++;
  }

  const h = crypto.createHash('sha256');
  for (const d of docs) h.update(d.id).update('\0').update(d.sha256).update('\n');

  return {
    docs, corpusHash: h.digest('hex').slice(0, 16), repoRoot, excluded,
    canonicalOf, contentUnits: byHash.size, duplicateGroups, appleDoubleCount,
  };
}

export function readDoc(doc: CorpusDoc): string {
  return fs.readFileSync(doc.absPath, 'utf8');
}
