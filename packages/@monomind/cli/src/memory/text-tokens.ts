/**
 * Shared BM25 tokeniser — the single definition both production retrieval
 * (`bm25-index.ts`) and the eval harness (`knowledge/eval/metrics.ts`) import.
 *
 * Lives here rather than in `knowledge/eval/` because `eval/` reads as dev-only
 * tooling and a future `!dist/**/eval/**` exclusion in `package.json` would
 * silently break every installed user's memory search. A module under `memory/`
 * is unambiguously production code.
 *
 * Dependency-free: no imports, no side effects.
 *
 * @module v1/cli/memory/text-tokens
 */

export const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'by',
  'for', 'with', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do',
  'does', 'did', 'doing', 'have', 'has', 'had', 'i', 'we', 'you', 'it', 'its',
  'that', 'this', 'these', 'those', 'what', 'which', 'who', 'how', 'when', 'where',
  'why', 'can', 'could', 'should', 'would', 'will', 'my', 'our', 'me', 'us', 'as',
  'so', 'than', 'then', 'there', 'here', 'not', 'no', 'all', 'any', 'some', 'get',
  'got', 'about', 'into', 'over', 'out', 'up', 'down', 'again', 'am', 'they',
]);

/**
 * Lowercase, strip non-alphanumeric, drop single-char tokens and stopwords.
 *
 * This is the tokeniser whose output the 0.697 BM25 baseline was measured on.
 * Any change here changes both the eval scorer AND the production scorer in
 * lockstep — which is the invariant that motivated extracting it.
 */
export function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(t => t.length > 1 && !STOPWORDS.has(t));
}
