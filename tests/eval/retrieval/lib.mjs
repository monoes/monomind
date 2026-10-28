// Scoring and baseline helpers for the offline graph-vs-ripgrep retrieval check
// (tests/eval/retrieval/run.mjs). Pure functions plus one `rg` wrapper; no
// network, no LLM. Unit-tested in lib.test.ts.
//
// A "ranking" is an ordered, de-duplicated list of repo-relative file paths.
// A question's `expect` lists path substrings that MUST be found (each is one
// relevant item); `acceptable` lists substrings that are also correct but not
// required (they count as relevant for precision, not for recall).
import { execFileSync } from 'node:child_process';

/** Rough answer-token cost: 1 token ~ 4 characters of text. */
export function estimateTokens(text) {
  return Math.ceil(String(text).length / 4);
}

const PATH_RE = /packages\/[\w@.\-/]+?\.(?:tsx?|mjs|cjs|js)\b/g;

/** File paths in order of first appearance, de-duplicated. */
export function extractPaths(text) {
  return [...new Set(String(text).match(PATH_RE) ?? [])];
}

/**
 * Paths inside the blocks whose header line starts with one of `prefixes`
 * (a block runs from its header to the next blank line). Order is kept.
 */
export function sectionPaths(text, prefixes) {
  const out = [];
  let inBlock = false;
  for (const line of String(text).split('\n')) {
    if (line.trim() === '') {
      inBlock = false;
      continue;
    }
    if (!/^\s/.test(line)) inBlock = prefixes.some((p) => line.startsWith(p));
    else if (inBlock) out.push(...(line.match(PATH_RE) ?? []));
  }
  return [...new Set(out)];
}

const STOPWORDS = new Set(
  'the and for are with that this from into where which what who whom how does code file files module function class used uses use find show all any not can has have its our'.split(
    ' ',
  ),
);

/** Search terms of a free-text query: identifiers stay whole, prose is split and de-stopworded. */
export function queryTerms(query) {
  const raw = String(query)
    .split(/[^A-Za-z0-9_$]+/)
    .filter(Boolean);
  const terms = raw.filter((t) => t.length >= 3 && !STOPWORDS.has(t.toLowerCase()));
  return [...new Set(terms.map((t) => t.toLowerCase()))];
}

/**
 * ripgrep baseline: per-term case-insensitive literal match counts summed per
 * file, files ranked by total hits (ties by path). `glob` narrows the files.
 */
export function rgRanking(dir, query, { glob = '*.ts', limit = 10, extraGlobs = [] } = {}) {
  const hits = new Map();
  for (const term of queryTerms(query)) {
    let out = '';
    try {
      out = execFileSync(
        'rg',
        [
          '--count-matches',
          '--no-heading',
          '-i',
          '-F',
          '-g',
          glob,
          ...extraGlobs.flatMap((g) => ['-g', g]),
          '-e',
          term,
          '.',
        ],
        { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26 },
      );
    } catch (e) {
      if (e.status === 1) continue; // rg: no match
      throw e;
    }
    for (const line of out.split('\n')) {
      const i = line.lastIndexOf(':');
      if (i < 0) continue;
      const file = line.slice(0, i).replace(/^\.\//, '');
      hits.set(file, (hits.get(file) ?? 0) + Number(line.slice(i + 1)));
    }
  }
  const ranked = [...hits.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return ranked.slice(0, limit).map(([file, count]) => ({ file, count }));
}

const norm = (s) => s.toLowerCase();
const matches = (file, needle) => norm(file).includes(norm(needle));

/**
 * Score one ranking against a question.
 *  rank            1-based rank of the first relevant file, null when none in the top k
 *  foundAt         per expected item: its best 1-based rank within the top k, or null
 *  precisionAtK    relevant files in the top k / k
 *  precisionReturned relevant / returned (a short, tight answer is not punished for being short)
 *  recallAtK       expected items found in the top k / expected items
 *  rr              1/rank, 0 when not found
 */
export function scoreRanking(ranked, { expect, acceptable = [] }, k = 5) {
  const top = ranked.slice(0, k);
  const relevantNeedles = [...expect, ...acceptable];
  const isRelevant = (f) => relevantNeedles.some((n) => matches(f, n));
  const firstIdx = top.findIndex(isRelevant);
  const foundAt = Object.fromEntries(
    expect.map((n) => {
      const i = top.findIndex((f) => matches(f, n));
      return [n, i === -1 ? null : i + 1];
    }),
  );
  const relevantInTop = top.filter(isRelevant).length;
  return {
    rank: firstIdx === -1 ? null : firstIdx + 1,
    foundAt,
    precisionAtK: relevantInTop / k,
    precisionReturned: top.length ? relevantInTop / top.length : 0,
    recallAtK: expect.filter((n) => foundAt[n] !== null).length / expect.length,
    rr: firstIdx === -1 ? 0 : 1 / (firstIdx + 1),
    returned: ranked.length,
  };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Aggregate per-question results ({score, tokens, ms}) into overall and per-kind summaries. */
export function summarize(results) {
  const one = (rs) => ({
    questions: rs.length,
    foundRate: mean(rs.map((r) => (r.score.rank === null ? 0 : 1))),
    mrr: mean(rs.map((r) => r.score.rr)),
    precisionAtK: mean(rs.map((r) => r.score.precisionAtK)),
    precisionReturned: mean(rs.map((r) => r.score.precisionReturned)),
    recallAtK: mean(rs.map((r) => r.score.recallAtK)),
    tokensMean: mean(rs.map((r) => r.tokens)),
    tokensMedian: median(rs.map((r) => r.tokens)),
    tokensTotal: rs.reduce((a, r) => a + r.tokens, 0),
  });
  const byKind = {};
  for (const kind of new Set(results.map((r) => r.kind)))
    byKind[kind] = one(results.filter((r) => r.kind === kind));
  return { overall: one(results), byKind };
}
